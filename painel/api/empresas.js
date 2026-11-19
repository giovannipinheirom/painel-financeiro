// Empresas (só o consultor).
// GET            lista com o último envio de cada uma
// GET ?id=       uma empresa
// POST           cria {nome, cnpj, contato, cor}
// PUT ?id=       edita {nome, cnpj, contato, cor} ou {novoLink:true}
// DELETE ?id=    apaga a empresa e todos os envios
import { rota, db, exigirAdmin, corpo, texto, novoId, ID_OK, HttpError, CORES } from './_lib.js';

const campos = b => {
  const nome = texto(b.nome, 80);
  if (!nome) throw new HttpError(400, 'Informe o nome da empresa.');
  return { nome, cnpj: texto(b.cnpj, 20), contato: texto(b.contato, 80), cor: CORES.includes(b.cor) ? b.cor : CORES[0] };
};

async function buscar(sql, id) {
  const linhas = await sql`
    select e.id, e.nome, e.cnpj, e.contato, e.cor, e.token, e.criado_em,
           r.id as rel_id, r.arquivo, r.enviado_em, r.resumo
      from empresas e
      left join lateral (
        select id, arquivo, enviado_em, resumo from relatorios
         where empresa_id = e.id order by enviado_em desc limit 1
      ) r on true
     where ${id ? sql`e.id = ${id}` : sql`true`}
     order by lower(e.nome)`;
  return linhas.map(l => ({
    id: l.id, nome: l.nome, cnpj: l.cnpj, contato: l.contato, cor: l.cor, token: l.token, criadoEm: l.criado_em,
    ultimo: l.rel_id ? { relId: l.rel_id, arquivo: l.arquivo, enviadoEm: l.enviado_em, ...(l.resumo || {}) } : null,
  }));
}

export default rota(async (req, res) => {
  exigirAdmin(req);
  const sql = await db();
  const id = req.query.id;
  if (id != null && !ID_OK.test(id)) throw new HttpError(400, 'Id inválido.');

  if (req.method === 'GET') {
    const lista = await buscar(sql, id);
    if (id) { if (!lista[0]) throw new HttpError(404, 'Empresa não encontrada.'); return res.json(lista[0]); }
    return res.json(lista);
  }
  if (req.method === 'POST') {
    const c = campos(corpo(req));
    const novo = novoId(12);
    await sql`insert into empresas (id, nome, cnpj, contato, cor, token)
              values (${novo}, ${c.nome}, ${c.cnpj}, ${c.contato}, ${c.cor}, ${novoId(24)})`;
    return res.status(201).json((await buscar(sql, novo))[0]);
  }
  if (!id) throw new HttpError(400, 'Falta o id da empresa.');
  if (req.method === 'PUT') {
    const b = corpo(req);
    const r = b.novoLink
      ? await sql`update empresas set token = ${novoId(24)} where id = ${id}`
      : await (c => sql`update empresas set nome=${c.nome}, cnpj=${c.cnpj}, contato=${c.contato}, cor=${c.cor} where id=${id}`)(campos(b));
    if (!r.count) throw new HttpError(404, 'Empresa não encontrada.');
    return res.json((await buscar(sql, id))[0]);
  }
  if (req.method === 'DELETE') {
    await sql`delete from empresas where id = ${id}`;
    return res.json({ ok: true });
  }
  throw new HttpError(405, 'Método não permitido.');
});
