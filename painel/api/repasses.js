// Repasses a fornecedores (só o consultor).
// GET  ?empresa=                       repasses para o painel + prazo
// POST {empresaId, arquivo, itens:[]}  substitui todos os repasses da empresa pelos da planilha
// PUT  ?empresa=  {prazo}              prazo em dias úteis
// A planilha é lida no navegador; aqui chegam só nome, valor, datas, banco pagador e situação
// (CPF, agência, conta e PIX dos fornecedores não são enviados nem guardados).
import { rota, db, exigirAdmin, corpo, texto, novoId, ID_OK, HttpError, repassesDaEmpresa } from './_lib.js';

const DATA_OK = /^\d{4}-\d{2}-\d{2}$/;
const data = v => {
  if (v == null || v === '') return null;
  const t = String(v);
  if (!DATA_OK.test(t)) return undefined;
  const d = new Date(t + 'T00:00:00Z');
  return isNaN(d) || d.toISOString().slice(0, 10) !== t ? undefined : t;
};

export default rota(async (req, res) => {
  exigirAdmin(req);
  const sql = await db();
  const empresa = req.query.empresa;
  if (empresa != null && !ID_OK.test(empresa)) throw new HttpError(400, 'Empresa inválida.');
  const buscar = async id => {
    const [e] = await sql`select id, repasse_prazo, repasses_em, repasses_arquivo from empresas where id = ${id}`;
    if (!e) throw new HttpError(404, 'Empresa não encontrada.');
    return e;
  };

  if (req.method === 'GET') {
    if (!empresa) throw new HttpError(400, 'Informe a empresa.');
    return res.json(await repassesDaEmpresa(sql, await buscar(empresa)));
  }
  if (req.method === 'PUT') {
    if (!empresa) throw new HttpError(400, 'Informe a empresa.');
    const prazo = Math.round(Number(corpo(req).prazo));
    if (!(prazo >= 1 && prazo <= 60)) throw new HttpError(400, 'Prazo entre 1 e 60 dias úteis.');
    const r = await sql`update empresas set repasse_prazo = ${prazo} where id = ${empresa}`;
    if (!r.count) throw new HttpError(404, 'Empresa não encontrada.');
    return res.json({ prazo });
  }
  if (req.method === 'POST') {
    const b = corpo(req);
    if (!ID_OK.test(b.empresaId || '')) throw new HttpError(400, 'Empresa inválida.');
    const lista = Array.isArray(b.itens) ? b.itens : [];
    if (!lista.length) throw new HttpError(400, 'Nenhum repasse encontrado na planilha.');
    if (lista.length > 50000) throw new HttpError(400, 'Planilha grande demais (máx. 50 mil linhas).');
    const linhas = lista.map((i, n) => {
      const valor = Number(i.v), s = data(i.s), p = data(i.p);
      if (!isFinite(valor) || Math.abs(valor) > 1e10 || !s || p === undefined) throw new HttpError(400, `Linha ${n + 1} da planilha com valor ou data inválidos.`);
      return { id: novoId(14), empresa_id: b.empresaId, fornecedor: texto(i.f, 120) || '(sem nome)', valor: Math.round(valor * 100) / 100,
        solicitado: s, pago: !!i.ok, pago_em: p, cancelado: !!i.x, banco: texto(i.b, 30) || null, conta: texto(i.c, 30) || null };
    });
    const e = await buscar(b.empresaId);
    await sql.begin(async t => {
      await t`delete from repasses where empresa_id = ${e.id}`;
      for (let k = 0; k < linhas.length; k += 1000)
        await t`insert into repasses ${t(linhas.slice(k, k + 1000), 'id', 'empresa_id', 'fornecedor', 'valor', 'solicitado', 'pago', 'pago_em', 'cancelado', 'banco', 'conta')}`;
      await t`update empresas set repasses_em = now(), repasses_arquivo = ${texto(b.arquivo, 120) || null} where id = ${e.id}`;
    });
    return res.status(201).json(await repassesDaEmpresa(sql, await buscar(e.id)));
  }
  throw new HttpError(405, 'Método não permitido.');
});
