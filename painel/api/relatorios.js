// Envios de planilha (só o consultor).
// GET ?empresa=  histórico (sem os dados pesados)
// GET ?id=       um envio completo (com o modelo do painel)
// POST           {empresaId, arquivo, modelo}  — a planilha é lida no navegador; aqui chega só o resultado
// DELETE ?id=    apaga um envio
import { rota, db, exigirAdmin, corpo, texto, novoId, ID_OK, HttpError } from './_lib.js';

const MAX = 1_000_000; // ~1 MB de dados por envio

function validarModelo(m) {
  const ok = m && typeof m === 'object' && Array.isArray(m.rows) && m.rows.length > 0 && m.rows.length < 400
    && Number.isInteger(m.ultimo) && m.ultimo >= 1 && m.ultimo <= 12
    && Number.isInteger(m.ano) && m.ano > 1990 && m.ano < 2200
    && ['rb', 'rl', 'fat'].every(k => Array.isArray(m[k]) && m[k].length === 12);
  if (!ok) throw new HttpError(400, 'Os dados da planilha vieram incompletos. Envie de novo.');
}
const n = v => (typeof v === 'number' && isFinite(v) ? v : 0);

export default rota(async (req, res) => {
  exigirAdmin(req);
  const sql = await db();
  const { id, empresa } = req.query;
  for (const v of [id, empresa]) if (v != null && !ID_OK.test(v)) throw new HttpError(400, 'Id inválido.');

  if (req.method === 'GET') {
    if (id) {
      const [r] = await sql`select id, empresa_id, arquivo, enviado_em, ano, ultimo, modelo from relatorios where id = ${id}`;
      if (!r) throw new HttpError(404, 'Envio não encontrado.');
      return res.json({ id: r.id, empresaId: r.empresa_id, arquivo: r.arquivo, enviadoEm: r.enviado_em, ano: r.ano, ultimo: r.ultimo, modelo: r.modelo });
    }
    if (!empresa) throw new HttpError(400, 'Informe a empresa.');
    const linhas = await sql`select id, arquivo, enviado_em, ano, ultimo, resumo from relatorios
                              where empresa_id = ${empresa} order by enviado_em desc limit 50`;
    return res.json(linhas.map(r => ({ id: r.id, arquivo: r.arquivo, enviadoEm: r.enviado_em, ano: r.ano, ultimo: r.ultimo, resumo: r.resumo })));
  }
  if (req.method === 'POST') {
    const b = corpo(req);
    if (!ID_OK.test(b.empresaId || '')) throw new HttpError(400, 'Empresa inválida.');
    const m = b.modelo;
    validarModelo(m);
    if (JSON.stringify(m).length > MAX) throw new HttpError(413, 'A planilha gerou dados demais. Confira se a DRE FINANCEIRO não tem linhas sobrando.');
    const i = m.ultimo - 1;
    const resumo = { ano: m.ano, mes: m.ultimo, rb: n(m.rb[i]), rl: n(m.rl[i]), fat: n(m.fat[i]) };
    const [emp] = await sql`select id from empresas where id = ${b.empresaId}`;
    if (!emp) throw new HttpError(404, 'Empresa não encontrada.');
    const novo = novoId(12);
    const [r] = await sql`insert into relatorios (id, empresa_id, arquivo, ano, ultimo, resumo, modelo)
      values (${novo}, ${b.empresaId}, ${texto(b.arquivo, 160) || 'planilha'}, ${m.ano}, ${m.ultimo}, ${sql.json(resumo)}, ${sql.json(m)})
      returning id, arquivo, enviado_em, ano, ultimo, resumo`;
    return res.status(201).json({ id: r.id, arquivo: r.arquivo, enviadoEm: r.enviado_em, ano: r.ano, ultimo: r.ultimo, resumo: r.resumo });
  }
  if (req.method === 'DELETE') {
    if (!id) throw new HttpError(400, 'Falta o id do envio.');
    await sql`delete from relatorios where id = ${id}`;
    return res.json({ ok: true });
  }
  throw new HttpError(405, 'Método não permitido.');
});
