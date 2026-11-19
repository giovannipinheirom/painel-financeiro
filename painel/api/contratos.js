// Contratos e parcelas (só o consultor).
// GET    ?empresa=             contratos da empresa com todas as parcelas
// POST   {empresaId, nome}     cria contrato
// POST   {contratoId, itens:[{vencimento, valor}]}   adiciona parcelas
// PUT    ?id=        {nome}                 renomeia contrato
// PUT    ?parcela=   {vencimento, valor}    edita parcela
// DELETE ?id=  | ?parcela=                  apaga contrato (e parcelas) ou uma parcela
import { rota, db, exigirAdmin, corpo, texto, novoId, ID_OK, HttpError, contratosDaEmpresa } from './_lib.js';

const DATA_OK = /^\d{4}-\d{2}-\d{2}$/;
function parcela(b) {
  const valor = Number(b.valor);
  if (!isFinite(valor) || valor < 0 || valor > 1e11) throw new HttpError(400, 'Valor de parcela inválido.');
  const v = String(b.vencimento || '');
  const d = new Date(v + 'T00:00:00Z');
  if (!DATA_OK.test(v) || isNaN(d) || d.toISOString().slice(0, 10) !== v) throw new HttpError(400, 'Data de parcela inválida.');
  return { valor: Math.round(valor * 100) / 100, vencimento: v };
}

export default rota(async (req, res) => {
  exigirAdmin(req);
  const sql = await db();
  const { id, empresa, parcela: pid } = req.query;
  for (const v of [id, empresa, pid]) if (v != null && !ID_OK.test(v)) throw new HttpError(400, 'Id inválido.');

  if (req.method === 'GET') {
    if (!empresa) throw new HttpError(400, 'Informe a empresa.');
    return res.json(await contratosDaEmpresa(sql, empresa));
  }
  if (req.method === 'POST') {
    const b = corpo(req);
    if (b.contratoId) {
      if (!ID_OK.test(b.contratoId)) throw new HttpError(400, 'Contrato inválido.');
      const lista = Array.isArray(b.itens) ? b.itens : [];
      if (!lista.length || lista.length > 360) throw new HttpError(400, 'Envie de 1 a 360 parcelas por vez.');
      const itens = lista.map(parcela);
      const [c] = await sql`select id from contratos where id = ${b.contratoId}`;
      if (!c) throw new HttpError(404, 'Contrato não encontrado.');
      const linhas = itens.map(i => ({ id: novoId(12), contrato_id: c.id, ...i }));
      const r = await sql`insert into contrato_parcelas ${sql(linhas, 'id', 'contrato_id', 'vencimento', 'valor')}
                          returning id, to_char(vencimento, 'YYYY-MM-DD') as vencimento, valor::float8 as valor`;
      return res.status(201).json(r);
    }
    if (!ID_OK.test(b.empresaId || '')) throw new HttpError(400, 'Empresa inválida.');
    const nome = texto(b.nome, 120);
    if (!nome) throw new HttpError(400, 'Dê um nome ao contrato.');
    const [emp] = await sql`select id from empresas where id = ${b.empresaId}`;
    if (!emp) throw new HttpError(404, 'Empresa não encontrada.');
    const [r] = await sql`insert into contratos (id, empresa_id, nome) values (${novoId(12)}, ${emp.id}, ${nome}) returning id, nome`;
    return res.status(201).json({ ...r, parcelas: [] });
  }
  if (req.method === 'PUT') {
    const b = corpo(req);
    if (pid) {
      const i = parcela(b);
      const [r] = await sql`update contrato_parcelas set vencimento=${i.vencimento}, valor=${i.valor} where id=${pid}
                            returning id, to_char(vencimento, 'YYYY-MM-DD') as vencimento, valor::float8 as valor`;
      if (!r) throw new HttpError(404, 'Parcela não encontrada.');
      return res.json(r);
    }
    if (!id) throw new HttpError(400, 'Falta o id.');
    const nome = texto(b.nome, 120);
    if (!nome) throw new HttpError(400, 'Dê um nome ao contrato.');
    const [r] = await sql`update contratos set nome=${nome} where id=${id} returning id, nome`;
    if (!r) throw new HttpError(404, 'Contrato não encontrado.');
    return res.json(r);
  }
  if (req.method === 'DELETE') {
    if (pid) await sql`delete from contrato_parcelas where id = ${pid}`;
    else if (id) await sql`delete from contratos where id = ${id}`;
    else throw new HttpError(400, 'Falta o id.');
    return res.json({ ok: true });
  }
  throw new HttpError(405, 'Método não permitido.');
});
