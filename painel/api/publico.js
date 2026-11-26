// Painel do cliente: abre pelo token secreto da empresa + a senha que o consultor definiu.
// GET    ?token=&rel=   dados do painel (precisa estar logado como cliente)
// POST   {token, senha} entra e devolve os dados
// DELETE ?token=        sai
import { rota, db, corpo, HttpError, contratosDaEmpresa, repassesDaEmpresa, confereSenha, abrirSessaoCliente, fecharSessaoCliente, clienteLogado } from './_lib.js';

const TOKEN_OK = /^[a-z0-9]{24}$/;
const ID_OK = /^[a-z0-9]{6,40}$/;
const MES_OK = /^\d{4}-(0[1-9]|1[0-2])$/;

// contas a pagar de um mês (AAAA-MM); sem mês, o mês atual no horário de Brasília
async function contasDoMes(sql, e, mes) {
  if (!e.contas_pagar) return null;
  if (!MES_OK.test(mes || '')) mes = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 7);
  const ini = mes + '-01';
  const itens = await sql`select c.id, c.recebedor, c.valor::float8 as valor, to_char(c.vencimento, 'YYYY-MM-DD') as vencimento, a.nome as anexo
                            from contas_pagar c left join conta_anexos a on a.conta_id = c.id
                           where c.empresa_id = ${e.id}
                             and c.vencimento >= ${ini}::date and c.vencimento < (${ini}::date + interval '1 month')
                           order by c.vencimento, lower(c.recebedor) limit 1000`;
  if (e.contratos) {
    // parcelas de contratos entram sozinhas no calendário
    const ps = await sql`select * from (
        select p.id, c.nome, p.valor::float8 as valor, to_char(p.vencimento, 'YYYY-MM-DD') as vencimento, p.vencimento as v,
               row_number() over (partition by p.contrato_id order by p.vencimento, p.id) as n,
               count(*) over (partition by p.contrato_id) as tot
          from contrato_parcelas p join contratos c on c.id = p.contrato_id
         where c.empresa_id = ${e.id}) x
       where v >= ${ini}::date and v < (${ini}::date + interval '1 month')`;
    for (const p of ps) itens.push({ id: p.id, recebedor: `${p.nome} · parcela ${p.n}/${p.tot}`, valor: p.valor, vencimento: p.vencimento, tipo: 'contrato' });
  }
  return { mes, itens };
}

async function dados(sql, e, rel, mes) {
  // consultas independentes começam já e rodam ao mesmo tempo que a do relatório
  const extras = Promise.all([
    contasDoMes(sql, e, mes),
    e.repasses ? repassesDaEmpresa(sql, e) : null,
    e.contratos ? contratosDaEmpresa(sql, e.id) : null,
  ]);
  extras.catch(() => {}); // se a consulta abaixo falhar primeiro, o erro dela é o que vale
  const versoes = await sql`select id, arquivo, enviado_em, ano, ultimo from relatorios
                             where empresa_id = ${e.id} order by enviado_em desc limit 12`;
  const escolhido = rel && versoes.some(v => v.id === rel) ? rel : versoes[0]?.id;
  let relatorio = null;
  if (escolhido) {
    const [r] = await sql`select id, arquivo, enviado_em, modelo from relatorios where id = ${escolhido} and empresa_id = ${e.id}`;
    if (r) relatorio = { id: r.id, arquivo: r.arquivo, enviadoEm: r.enviado_em, modelo: r.modelo };
  }
  const [contas, repasses, contratos] = await extras;
  return {
    empresa: { nome: e.nome, cnpj: e.cnpj, posicao: e.posicao_clientes },
    contas,
    repasses,
    contratos: contratos ? contratos.map(c => ({ nome: c.nome, parcelas: c.parcelas.map(p => ({ vencimento: p.vencimento, valor: p.valor })) })) : null,
    versoes: versoes.map(v => ({ id: v.id, arquivo: v.arquivo, enviadoEm: v.enviado_em, ano: v.ano, ultimo: v.ultimo })),
    relatorio,
  };
}

function erro(res, status, msg, extra) { res.status(status).json({ erro: msg, ...extra }); }

export default rota(async (req, res) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const b = req.method === 'POST' ? corpo(req) : {};
  const token = req.method === 'POST' ? b.token : req.query.token;
  const rel = req.query.rel;
  const mes = req.method === 'POST' ? b.mes : req.query.mes;
  if (!TOKEN_OK.test(token || '')) throw new HttpError(404, 'Link inválido.');
  if (rel != null && !ID_OK.test(rel)) throw new HttpError(400, 'Versão inválida.');

  const sql = await db();
  const [e] = await sql`select id, nome, cnpj, senha_hash, posicao_clientes, contas_pagar, contratos, repasses, repasse_prazo, repasses_em, repasses_arquivo from empresas where token = ${token}`;
  if (!e) throw new HttpError(404, 'Este link não está mais ativo. Peça um novo ao seu consultor.');
  const nome = { empresa: { nome: e.nome } };

  if (req.method === 'DELETE') { fecharSessaoCliente(req, res, e.id); return res.json({ ok: true }); }
  if (!e.senha_hash) return erro(res, 403, 'O painel ainda não foi liberado. Fale com o seu consultor.', { bloqueado: true, ...nome });

  if (req.method === 'POST') {
    if (!confereSenha(b.senha, e.senha_hash)) {
      await new Promise(r => setTimeout(r, 800)); // atrasa tentativas de adivinhar
      return erro(res, 401, 'Senha incorreta.', { precisaSenha: true, ...nome });
    }
    abrirSessaoCliente(req, res, e.id, e.senha_hash);
    return res.json(await dados(sql, e, null, mes));
  }
  if (req.method === 'GET') {
    if (!clienteLogado(req, e.id, e.senha_hash)) return erro(res, 401, 'Digite a senha para abrir o painel.', { precisaSenha: true, ...nome });
    if (req.query.so === 'contas') return res.json({ contas: await contasDoMes(sql, e, mes) });
    return res.json(await dados(sql, e, rel, mes));
  }
  throw new HttpError(405, 'Método não permitido.');
});
