// PDF anexado a uma conta a pagar.
// GET    ?conta=[&token=]   abre o PDF (consultor, ou o cliente logado no painel daquela empresa)
// POST   ?conta=  {nome, dados}   envia/substitui (dados = PDF em base64, até 3 MB) · só o consultor
// DELETE ?conta=                   remove · só o consultor
import { rota, db, exigirAdmin, ehAdmin, clienteLogado, corpo, texto, ID_OK, HttpError } from './_lib.js';

const MAX = 3 * 1024 * 1024;

export default rota(async (req, res) => {
  const sql = await db();
  const conta = req.query.conta;
  if (!ID_OK.test(conta || '')) throw new HttpError(400, 'Conta inválida.');

  if (req.method === 'GET') {
    const [a] = await sql`select a.nome, a.dados, e.id as eid, e.token, e.senha_hash
                            from conta_anexos a join contas_pagar c on c.id = a.conta_id join empresas e on e.id = c.empresa_id
                           where a.conta_id = ${conta}`;
    const pode = ehAdmin(req) || (a && req.query.token && req.query.token === a.token && clienteLogado(req, a.eid, a.senha_hash));
    if (!a || !pode) throw new HttpError(404, 'Anexo não encontrado.');
    const nome = a.nome.replace(/[^\w.\- ]+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nome}"; filename*=UTF-8''${encodeURIComponent(a.nome)}`);
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.statusCode = 200;
    return res.end(Buffer.from(a.dados));
  }
  exigirAdmin(req);
  if (req.method === 'POST') {
    const b = corpo(req);
    const dados = Buffer.from(String(b.dados || ''), 'base64');
    if (!dados.length) throw new HttpError(400, 'Arquivo vazio.');
    if (dados.length > MAX) throw new HttpError(400, 'O PDF pode ter no máximo 3 MB.');
    if (dados.subarray(0, 5).toString('latin1') !== '%PDF-') throw new HttpError(400, 'O arquivo precisa ser um PDF.');
    let nome = texto(b.nome, 120) || 'documento.pdf';
    if (!/\.pdf$/i.test(nome)) nome += '.pdf';
    const [c] = await sql`select id from contas_pagar where id = ${conta}`;
    if (!c) throw new HttpError(404, 'Conta não encontrada.');
    await sql`insert into conta_anexos (conta_id, nome, tamanho, dados) values (${conta}, ${nome}, ${dados.length}, ${dados})
              on conflict (conta_id) do update set nome = excluded.nome, tamanho = excluded.tamanho, dados = excluded.dados, criado_em = now()`;
    return res.status(201).json({ anexo: nome });
  }
  if (req.method === 'DELETE') {
    await sql`delete from conta_anexos where conta_id = ${conta}`;
    return res.json({ ok: true });
  }
  throw new HttpError(405, 'Método não permitido.');
});
