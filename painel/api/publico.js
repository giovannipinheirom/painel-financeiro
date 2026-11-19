// Painel do cliente — aberto, sem login, mas só com o token secreto da empresa.
// GET ?token=...&rel=...  devolve a empresa, as últimas 12 versões e o painel escolhido (ou o mais recente)
import { rota, db, HttpError } from './_lib.js';

const TOKEN_OK = /^[a-z0-9]{24}$/;
const ID_OK = /^[a-z0-9]{6,40}$/;

export default rota(async (req, res) => {
  if (req.method !== 'GET') throw new HttpError(405, 'Método não permitido.');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const { token, rel } = req.query;
  if (!TOKEN_OK.test(token || '')) throw new HttpError(404, 'Link inválido.');
  if (rel != null && !ID_OK.test(rel)) throw new HttpError(400, 'Versão inválida.');
  const sql = await db();
  const [e] = await sql`select id, nome, cnpj from empresas where token = ${token}`;
  if (!e) throw new HttpError(404, 'Este link não está mais ativo. Peça um novo ao seu consultor.');
  const versoes = await sql`select id, arquivo, enviado_em, ano, ultimo from relatorios
                             where empresa_id = ${e.id} order by enviado_em desc limit 12`;
  const escolhido = rel && versoes.some(v => v.id === rel) ? rel : versoes[0]?.id;
  let relatorio = null;
  if (escolhido) {
    const [r] = await sql`select id, arquivo, enviado_em, modelo from relatorios where id = ${escolhido} and empresa_id = ${e.id}`;
    if (r) relatorio = { id: r.id, arquivo: r.arquivo, enviadoEm: r.enviado_em, modelo: r.modelo };
  }
  res.json({
    empresa: { nome: e.nome, cnpj: e.cnpj },
    versoes: versoes.map(v => ({ id: v.id, arquivo: v.arquivo, enviadoEm: v.enviado_em, ano: v.ano, ultimo: v.ultimo })),
    relatorio,
  });
});
