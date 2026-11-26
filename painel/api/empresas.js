// Empresas (só o consultor).
// GET            lista com o último envio de cada uma
// GET ?id=       uma empresa
// POST           cria {nome, cnpj, contato, cor, senha, posicao}
// PUT ?id=       edita {nome, cnpj, contato, cor, posicao, senha?} ou {novoLink:true}
// DELETE ?id=    apaga a empresa e todos os envios
import { rota, db, exigirAdmin, corpo, texto, novoId, ID_OK, HttpError, CORES, hashSenha } from './_lib.js';

const campos = b => {
  const nome = texto(b.nome, 80);
  if (!nome) throw new HttpError(400, 'Informe o nome da empresa.');
  const senha = b.senha == null ? '' : String(b.senha).trim();
  if (senha && senha.length < 4) throw new HttpError(400, 'A senha do cliente precisa ter pelo menos 4 caracteres.');
  if (senha.length > 64) throw new HttpError(400, 'Senha longa demais (máx. 64 caracteres).');
  return {
    nome, cnpj: texto(b.cnpj, 20), contato: texto(b.contato, 80),
    cor: CORES.includes(b.cor) ? b.cor : CORES[0],
    posicao: b.posicao !== false,
    contas: b.contas === true,
    contratos: b.contratos === true,
    repasses: b.repasses === true,
    senhaHash: senha ? hashSenha(senha) : null,
  };
};

async function buscar(sql, id) {
  const linhas = await sql`
    select e.id, e.nome, e.cnpj, e.contato, e.cor, e.token, e.criado_em,
           e.senha_hash is not null as tem_senha, e.senha_em, e.posicao_clientes, e.contas_pagar, e.contratos,
           e.repasses, e.repasse_prazo, e.repasses_em,
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
    temSenha: l.tem_senha, senhaEm: l.senha_em, posicao: l.posicao_clientes, contas: l.contas_pagar, contratos: l.contratos,
    repasses: l.repasses, repassePrazo: l.repasse_prazo, repassesEm: l.repasses_em,
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
    await sql`insert into empresas (id, nome, cnpj, contato, cor, token, posicao_clientes, contas_pagar, contratos, repasses, senha_hash, senha_em)
              values (${novo}, ${c.nome}, ${c.cnpj}, ${c.contato}, ${c.cor}, ${novoId(24)}, ${c.posicao}, ${c.contas}, ${c.contratos}, ${c.repasses},
                      ${c.senhaHash}, ${c.senhaHash ? sql`now()` : null})`;
    return res.status(201).json((await buscar(sql, novo))[0]);
  }
  if (!id) throw new HttpError(400, 'Falta o id da empresa.');
  if (req.method === 'PUT') {
    const b = corpo(req);
    let r;
    if (b.novoLink) {
      r = await sql`update empresas set token = ${novoId(24)} where id = ${id}`;
    } else {
      const c = campos(b);
      r = c.senhaHash
        ? await sql`update empresas set nome=${c.nome}, cnpj=${c.cnpj}, contato=${c.contato}, cor=${c.cor},
                    posicao_clientes=${c.posicao}, contas_pagar=${c.contas}, contratos=${c.contratos}, repasses=${c.repasses}, senha_hash=${c.senhaHash}, senha_em=now() where id=${id}`
        : await sql`update empresas set nome=${c.nome}, cnpj=${c.cnpj}, contato=${c.contato}, cor=${c.cor},
                    posicao_clientes=${c.posicao}, contas_pagar=${c.contas}, contratos=${c.contratos}, repasses=${c.repasses} where id=${id}`;
    }
    if (!r.count) throw new HttpError(404, 'Empresa não encontrada.');
    return res.json((await buscar(sql, id))[0]);
  }
  if (req.method === 'DELETE') {
    await sql`delete from empresas where id = ${id}`;
    return res.json({ ok: true });
  }
  throw new HttpError(405, 'Método não permitido.');
});
