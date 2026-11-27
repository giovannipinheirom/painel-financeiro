// Painel a partir dos extratos bancários (só o consultor).
// Os arquivos são lidos no navegador; aqui chegam só os lançamentos (data, texto, valor) e as configurações.
// GET    ?empresa=                         tudo o que o painel precisa (lançamentos, regras, de-para, saldos, meses, carteira)
// POST   ?empresa=&acao=lancamentos        {itens:[{c,b,d,p,v,m?}], saldos:[{conta,d,s,o}], manualPrevalece?}
// POST   ?empresa=&acao=config             {regras:[{b,o,p,c}], depara:[{c,k}]}  (substitui tudo)
// POST   ?empresa=&acao=regra              {b, p, c}  nova regra no topo da lista do banco
// PUT    ?empresa=&acao=manual             {chaves:[], classe}  classificação manual (vazio = volta para a regra)
// PUT    ?empresa=&acao=depara             {classe, categoria}
// PUT    ?empresa=&acao=mes                {mes:'AAAA-MM', faturamento, rendimento}
// PUT    ?empresa=&acao=saldo              {conta, d, s}   (s vazio = apaga)
// POST   ?empresa=&acao=carteira           {banco, itens:[{n,c,venc,v}]}  substitui a carteira daquele banco
// DELETE ?empresa=&acao=tudo               apaga lançamentos, regras, saldos e carteira da empresa
import { rota, db, exigirAdmin, corpo, texto, ID_OK, HttpError } from './_lib.js';

const DATA_OK = /^\d{4}-\d{2}-\d{2}$/, MES_OK = /^\d{4}-(0[1-9]|1[0-2])$/, BANCO_OK = /^[a-z0-9_]{2,20}$/;
const num = (v, nome) => { const n = Number(v); if (!isFinite(n) || Math.abs(n) > 1e11) throw new HttpError(400, `${nome} inválido.`); return Math.round(n * 100) / 100; };
const data = v => { const t = String(v || ''); if (!DATA_OK.test(t) || isNaN(new Date(t + 'T00:00:00Z'))) throw new HttpError(400, 'Data inválida.'); return t; };

export default rota(async (req, res) => {
  exigirAdmin(req);
  const sql = await db();
  const emp = req.query.empresa, acao = req.query.acao || '';
  if (!ID_OK.test(emp || '')) throw new HttpError(400, 'Empresa inválida.');
  const [e] = await sql`select id from empresas where id = ${emp}`;
  if (!e) throw new HttpError(404, 'Empresa não encontrada.');

  if (req.method === 'GET') {
    const [lanc, regras, depara, saldos, meses, carteira] = await Promise.all([
      sql`select chave as c, banco as b, to_char(data,'YYYY-MM-DD') as d, partes as p, valor::float8 as v, manual as m
            from ext_lanc where empresa_id = ${emp} order by data, banco, chave`,
      sql`select banco as b, ordem as o, padrao as p, classe as c from ext_regra where empresa_id = ${emp} order by banco, ordem`,
      sql`select classe as c, categoria as k from ext_depara where empresa_id = ${emp} order by classe`,
      sql`select conta, to_char(data,'YYYY-MM-DD') as d, saldo::float8 as s, origem as o from ext_saldo where empresa_id = ${emp} order by conta, data`,
      sql`select mes as m, faturamento::float8 as f, rendimento::float8 as r from ext_mes where empresa_id = ${emp} order by mes`,
      sql`select banco as b, nome as n, classe as c, to_char(vencimento,'YYYY-MM-DD') as venc, valor::float8 as v from ext_carteira where empresa_id = ${emp}`,
    ]);
    return res.json({ lanc, regras, depara, saldos, meses, carteira });
  }
  const b = req.method === 'DELETE' ? {} : corpo(req);

  if (req.method === 'POST' && acao === 'lancamentos') {
    const itens = Array.isArray(b.itens) ? b.itens : [];
    if (itens.length > 60000) throw new HttpError(400, 'Lançamentos demais de uma vez (máx. 60 mil).');
    const linhas = itens.map(i => {
      if (!BANCO_OK.test(i.b || '')) throw new HttpError(400, 'Banco inválido.');
      const chave = String(i.c || '').slice(0, 600); if (!chave) throw new HttpError(400, 'Lançamento sem chave.');
      return { empresa_id: emp, chave, banco: i.b, data: data(i.d), partes: texto(i.p, 500), valor: num(i.v, 'Valor'), manual: texto(i.m, 80) || null };
    });
    let novos = 0;
    for (let k = 0; k < linhas.length; k += 1000) {
      const lote = linhas.slice(k, k + 1000);
      const r = b.manualPrevalece
        ? await sql`insert into ext_lanc ${sql(lote)} on conflict (empresa_id, chave) do update set manual = coalesce(excluded.manual, ext_lanc.manual) returning (xmax = 0) as novo`
        : await sql`insert into ext_lanc ${sql(lote)} on conflict (empresa_id, chave) do nothing returning 1 as novo`;
      novos += r.filter(x => x.novo === true || x.novo === 1).length;
    }
    const saldos = (Array.isArray(b.saldos) ? b.saldos : []).map(s => ({ empresa_id: emp, conta: String(s.conta || '').slice(0, 30), data: data(s.d), saldo: num(s.s, 'Saldo'), origem: texto(s.o, 30) || null }))
      .filter(s => BANCO_OK.test(s.conta));
    for (let k = 0; k < saldos.length; k += 1000)
      await sql`insert into ext_saldo ${sql(saldos.slice(k, k + 1000))} on conflict (empresa_id, conta, data) do update set saldo = excluded.saldo, origem = excluded.origem`;
    return res.json({ recebidos: linhas.length, novos, repetidos: linhas.length - novos, saldos: saldos.length });
  }
  if (req.method === 'POST' && acao === 'config') {
    const regras = (Array.isArray(b.regras) ? b.regras : []).map(r => ({ empresa_id: emp, banco: String(r.b), ordem: Math.round(Number(r.o)), padrao: texto(r.p, 200), classe: texto(r.c, 80) }))
      .filter(r => BANCO_OK.test(r.banco) && Number.isFinite(r.ordem) && r.padrao && r.classe);
    const depara = (Array.isArray(b.depara) ? b.depara : []).map(d => ({ empresa_id: emp, classe: texto(d.c, 80), categoria: texto(d.k, 80) })).filter(d => d.classe && d.categoria);
    const vistos = new Set(); const dp = depara.filter(d => !vistos.has(d.classe) && vistos.add(d.classe));
    await sql.begin(async t => {
      await t`delete from ext_regra where empresa_id = ${emp}`;
      await t`delete from ext_depara where empresa_id = ${emp}`;
      for (let k = 0; k < regras.length; k += 1000) await t`insert into ext_regra ${t(regras.slice(k, k + 1000))} on conflict do nothing`;
      if (dp.length) await t`insert into ext_depara ${t(dp)}`;
    });
    return res.json({ regras: regras.length, depara: dp.length });
  }
  if (req.method === 'POST' && acao === 'regra') {
    if (!BANCO_OK.test(b.b || '')) throw new HttpError(400, 'Banco inválido.');
    const padrao = texto(b.p, 200), classe = texto(b.c, 80);
    if (!padrao || !classe) throw new HttpError(400, 'Informe a palavra-chave e a classificação.');
    const [m] = await sql`select coalesce(min(ordem), 1) as o from ext_regra where empresa_id = ${emp} and banco = ${b.b}`;
    await sql`insert into ext_regra (empresa_id, banco, ordem, padrao, classe) values (${emp}, ${b.b}, ${m.o - 1}, ${padrao}, ${classe})`;
    return res.status(201).json({ ok: true });
  }
  if (req.method === 'PUT' && acao === 'manual') {
    const chaves = (Array.isArray(b.chaves) ? b.chaves : []).map(String).slice(0, 5000);
    const classe = texto(b.classe, 80) || null;
    const r = await sql`update ext_lanc set manual = ${classe} where empresa_id = ${emp} and chave = any(${chaves})`;
    return res.json({ alterados: r.count });
  }
  if (req.method === 'PUT' && acao === 'depara') {
    const classe = texto(b.classe, 80), categoria = texto(b.categoria, 80);
    if (!classe || !categoria) throw new HttpError(400, 'Informe a classificação e a linha da DRE.');
    await sql`insert into ext_depara (empresa_id, classe, categoria) values (${emp}, ${classe}, ${categoria})
              on conflict (empresa_id, classe) do update set categoria = excluded.categoria`;
    return res.json({ ok: true });
  }
  if (req.method === 'PUT' && acao === 'mes') {
    if (!MES_OK.test(b.mes || '')) throw new HttpError(400, 'Mês inválido.');
    const f = b.faturamento === '' || b.faturamento == null ? null : num(b.faturamento, 'Faturamento');
    const r = b.rendimento === '' || b.rendimento == null ? null : num(b.rendimento, 'Rendimento');
    await sql`insert into ext_mes (empresa_id, mes, faturamento, rendimento) values (${emp}, ${b.mes}, ${f}, ${r})
              on conflict (empresa_id, mes) do update set faturamento = excluded.faturamento, rendimento = excluded.rendimento`;
    return res.json({ ok: true });
  }
  if (req.method === 'PUT' && acao === 'saldo') {
    const conta = String(b.conta || ''); if (!BANCO_OK.test(conta)) throw new HttpError(400, 'Conta inválida.');
    const d = data(b.d);
    if (b.s === '' || b.s == null) await sql`delete from ext_saldo where empresa_id = ${emp} and conta = ${conta} and data = ${d}`;
    else await sql`insert into ext_saldo (empresa_id, conta, data, saldo, origem) values (${emp}, ${conta}, ${d}, ${num(b.s, 'Saldo')}, 'manual')
                   on conflict (empresa_id, conta, data) do update set saldo = excluded.saldo, origem = 'manual'`;
    return res.json({ ok: true });
  }
  if (req.method === 'POST' && acao === 'carteira') {
    if (!BANCO_OK.test(b.banco || '')) throw new HttpError(400, 'Banco inválido.');
    const itens = (Array.isArray(b.itens) ? b.itens : []).slice(0, 20000).map(i => ({
      empresa_id: emp, banco: b.banco, nome: texto(i.n, 160) || '(sem nome)', classe: texto(i.c, 60) || null,
      vencimento: i.venc && DATA_OK.test(i.venc) ? i.venc : null, valor: num(i.v, 'Valor') }));
    await sql.begin(async t => {
      await t`delete from ext_carteira where empresa_id = ${emp} and banco = ${b.banco}`;
      for (let k = 0; k < itens.length; k += 1000) await t`insert into ext_carteira ${t(itens.slice(k, k + 1000))}`;
    });
    return res.json({ itens: itens.length });
  }
  if (req.method === 'DELETE' && acao === 'tudo') {
    await sql.begin(async t => {
      for (const tab of ['ext_lanc', 'ext_regra', 'ext_depara', 'ext_saldo', 'ext_mes', 'ext_carteira']) await t`delete from ${t(tab)} where empresa_id = ${emp}`;
    });
    return res.json({ ok: true });
  }
  throw new HttpError(405, 'Ação não permitida.');
});
