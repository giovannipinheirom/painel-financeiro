// GET: está logado?  POST {senha}: entra.  DELETE: sai.
import { rota, corpo, senhaConfere, abrirSessao, fecharSessao, ehAdmin, HttpError } from './_lib.js';

export default rota(async (req, res) => {
  if (req.method === 'GET') return res.json({ admin: ehAdmin(req) });
  if (req.method === 'DELETE') { fecharSessao(req, res); return res.json({ ok: true }); }
  if (req.method === 'POST') {
    const { senha } = corpo(req);
    if (!senhaConfere(senha)) {
      await new Promise(r => setTimeout(r, 800)); // atrasa tentativas de adivinhar a senha
      throw new HttpError(401, 'Senha incorreta.');
    }
    abrirSessao(req, res);
    return res.json({ admin: true });
  }
  throw new HttpError(405, 'Método não permitido.');
});
