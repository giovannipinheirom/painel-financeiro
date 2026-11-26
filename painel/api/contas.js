// Contas a pagar (só o consultor alimenta).
// GET ?empresa=        contas dos últimos 90 dias em diante
// POST                 {empresaId, itens:[{recebedor, valor, vencimento}]}  (ou um item solto no corpo)
// PUT ?id=             {recebedor, valor, vencimento}
// DELETE ?id=          apaga
import { rota, db, exigirAdmin, corpo, texto, novoId, ID_OK, HttpError } from './_lib.js';

const DATA_OK = /^\d{4}-\d{2}-\d{2}$/;

function item(b) {
  const recebedor = texto(b.recebedor, 120);
  if (!recebedor) throw new HttpError(400, 'Informe o nome do recebedor.');
  const valor = Number(b.valor);
  if (!isFinite(valor) || valor < 0 || valor > 1e11) throw new HttpError(400, `Valor inválido para "${recebedor}".`);
  const v = String(b.vencimento || '');
  const d = new Date(v + 'T00:00:00Z');
  if (!DATA_OK.test(v) || isNaN(d) || d.toISOString().slice(0, 10) !== v) throw new HttpError(400, `Data inválida para "${recebedor}".`);
  return { recebedor, valor: Math.round(valor * 100) / 100, vencimento: v };
}

export default rota(async (req, res) => {
  exigirAdmin(req);
  const sql = await db();
  const { id, empresa } = req.query;
  for (const v of [id, empresa]) if (v != null && !ID_OK.test(v)) throw new HttpError(400, 'Id inválido.');

  if (req.method === 'GET') {
    if (!empresa) throw new HttpError(400, 'Informe a empresa.');
    const linhas = await sql`select c.id, c.recebedor, c.valor::float8 as valor, to_char(c.vencimento, 'YYYY-MM-DD') as vencimento, a.nome as anexo
                               from contas_pagar c left join conta_anexos a on a.conta_id = c.id
                              where c.empresa_id = ${empresa} and c.vencimento >= current_date - 90
                              order by c.vencimento, lower(c.recebedor) limit 1000`;
    return res.json(linhas);
  }
  if (req.method === 'POST') {
    const b = corpo(req);
    if (!ID_OK.test(b.empresaId || '')) throw new HttpError(400, 'Empresa inválida.');
    const lista = Array.isArray(b.itens) ? b.itens : [b];
    if (!lista.length) throw new HttpError(400, 'Nenhuma conta para salvar.');
    if (lista.length > 300) throw new HttpError(400, 'Cole no máximo 300 contas de uma vez.');
    const itens = lista.map(item);
    const [emp] = await sql`select id from empresas where id = ${b.empresaId}`;
    if (!emp) throw new HttpError(404, 'Empresa não encontrada.');
    const linhas = itens.map(i => ({ id: novoId(12), empresa_id: b.empresaId, ...i }));
    const r = await sql`insert into contas_pagar ${sql(linhas, 'id', 'empresa_id', 'recebedor', 'valor', 'vencimento')}
                        returning id, recebedor, valor::float8 as valor, to_char(vencimento, 'YYYY-MM-DD') as vencimento`;
    return res.status(201).json(r);
  }
  if (!id) throw new HttpError(400, 'Falta o id da conta.');
  if (req.method === 'PUT') {
    const i = item(corpo(req));
    const [r] = await sql`update contas_pagar set recebedor=${i.recebedor}, valor=${i.valor}, vencimento=${i.vencimento}
                           where id=${id} returning id, recebedor, valor::float8 as valor, to_char(vencimento, 'YYYY-MM-DD') as vencimento`;
    if (!r) throw new HttpError(404, 'Conta não encontrada.');
    return res.json(r);
  }
  if (req.method === 'DELETE') {
    await sql`delete from contas_pagar where id = ${id}`;
    return res.json({ ok: true });
  }
  throw new HttpError(405, 'Método não permitido.');
});
