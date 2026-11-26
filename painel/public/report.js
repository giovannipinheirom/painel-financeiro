/* Código compartilhado: leitura da planilha (SheetJS) e montagem do painel (Chart.js).
   Usado pela página do consultor (index.html) e pela do cliente (cliente.html). */
let EMP_NOME = '';
let REPORT_EL = null;
let REPORT_OPTS = { posicao:false, extra:0 };   // extra: páginas acrescentadas depois (calendário)   // posicao: inclui a página "Posição de clientes"

/* =====================================================================
   1. LEITURA DA PLANILHA
   ===================================================================== */
const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const MESES_LONGO = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()
  .replace(/^\s*\(\s*[=\-+−]\s*\)\s*/,'').replace(/[^a-z0-9%]+/g,' ').trim();
const num = v => (typeof v === 'number' && isFinite(v)) ? v : null;
const range = (a,b) => { const r=[]; for(let i=a;i<=b;i++) r.push(i); return r; };
const sumIdx = (arr, idx) => idx.reduce((s,i)=>s+(arr[i]||0),0);

function sheetGrid(wb, name){
  const key = wb.SheetNames.find(n => norm(n) === norm(name));
  if(!key) return null;
  return XLSX.utils.sheet_to_json(wb.Sheets[key], {header:1, raw:true, defval:null, blankrows:true});
}

// nomes mais legíveis para linhas em CAIXA ALTA
const NOMES = { 'tarifa':'Tarifas bancárias','consorcio':'Consórcio','emprestimo':'Empréstimos','iof':'IOF',
  'financiamento de veiculos':'Financiamento de veículos','financiamento imobiliario':'Financiamento imobiliário' };
function prettyLabel(raw){
  let s = String(raw).trim();
  const n = norm(s);
  if (NOMES[n]) return NOMES[n];
  if (s === s.toUpperCase() && /[A-Z]/.test(s)) s = s.charAt(0) + s.slice(1).toLowerCase();
  return s.replace(/^\(\s*-\s*\)/,'(−)');
}

function parseDRE(g){
  if(!g) throw new Error('Não encontrei a aba "DRE FINANCEIRO".');
  let hr=-1, cols=null, labelCol=0;
  for(let r=0;r<Math.min(g.length,40) && hr<0;r++){
    const row=g[r]||[]; const c={};
    row.forEach((v,i)=>{ const k=MESES.findIndex(m=>norm(m)===norm(v)); if(k>=0 && !(k in c)) c[k]=i; });
    if(Object.keys(c).length>=12){ hr=r; cols=c; labelCol=Math.max(0,row.findIndex(v=>typeof v==='string'&&v.trim()&&!MESES.some(m=>norm(m)===norm(v)))); }
  }
  if(hr<0) throw new Error('Na aba DRE FINANCEIRO não achei a linha de cabeçalho com Jan…Dez.');
  const rows=[]; let parent=null, inFin=false;
  for(let r=hr+1;r<g.length;r++){
    const row=g[r]||[]; const raw=row[labelCol];
    if(typeof raw!=='string' || !raw.trim()) continue;
    const key=norm(raw);
    const vals=MESES.map((_,k)=>num(row[cols[k]])||0);
    const isTotal=/^\s*\(\s*=\s*\)/.test(raw);
    let type;
    if(key==='resultado liquido') type='final';
    else if(isTotal || key==='receita bruta') type='tot';
    else if(key==='faturamento bruto') type='plain';
    else if(inFin || (raw===raw.toUpperCase() && /[A-Z]/.test(raw)) || /^\s{2,}/.test(raw)) type='sub2';
    else type='sub';
    if(isTotal) inFin=false;
    if(key==='despesas financeiras') inFin=true;
    const item={key, label:prettyLabel(raw), type, vals, parent: type==='sub2'?parent:null};
    if(type!=='sub2') parent=item;
    rows.push(item);
    if(type==='final') break;
  }
  const by = k => rows.find(r=>r.key===k);
  const need = ['receita bruta','resultado liquido'];
  for(const k of need) if(!by(k)) throw new Error(`Na DRE FINANCEIRO não achei a linha "${k}".`);
  return {rows, by};
}

function parseBase(g){
  if(!g) throw new Error('Não encontrei a aba "Base Dash".');
  const map={}; let cols=range(1,12);
  g.forEach((row,r)=>{
    row=row||[]; const k=norm(row[0]);
    if(k==='mes' && MESES.every((m,i)=>norm(row[i+1])===norm(m))) cols=range(1,12);
    if(k && !(k in map)) map[k]={r, row};
  });
  const series = k => { const e=map[k]; return e? cols.map(c=>num(e.row[c])) : null; };
  const scalar = (k,c=1) => map[k]? map[k].row[c] : null;
  // carteira
  const cart={};
  const ci=g.findIndex(row=>norm((row||[])[0]).startsWith('carteira de clientes'));
  if(ci>=0){
    const h=g[ci].map(norm); const iR=h.indexOf('recebido'), iA=h.indexOf('em aberto'), iV=h.indexOf('vencido');
    for(let r=ci+1;r<g.length;r++){
      const row=g[r]||[]; const k=norm(row[0]);
      if(!k || k==='total') break;
      cart[String(row[0]).trim()]=[num(row[iR])||0, num(row[iA])||0, num(row[iV])||0];
    }
  }
  // nomes reais dos bancos (opcional): bloco "Mapeamento bancos" com  linha do painel | banco de verdade
  const bancos={};
  for(let r=0;r<g.length;r++){ const row=g[r]||[]; const c=row.findIndex(v=>norm(v).startsWith('mapeamento bancos'));
    if(c<0) continue;
    for(let k=r+1;k<g.length;k++){ const rr=g[k]||[]; const chave=norm(rr[c]); if(!chave) break;
      const slot = chave==='bb conta'?'bb' : chave.startsWith('rende facil')?'rende' : chave==='sicredi conta'?'sic' : chave.startsWith('aplicacao sicredi')?'aplSic' : chave==='stone'?'stone' : chave==='cora'?'cora' : null;
      if(slot) bancos[slot]=nomeBanco(rr[c+1]); }
    break;
  }
  return {series, scalar, cart, bancos};
}
// "Itaú – conta corrente (sem saldo)" -> "Itaú"; "não usado" -> null
function nomeBanco(v){
  const t=String(v??'').trim(), n=norm(t);
  if(!t || /\bnao (usad|tem|utiliz)/.test(n)) return null;
  return t.split(/\s+[–—-]\s+|\s*\(/)[0].trim() || null;
}

function anoDaPlanilha(wb){
  for(const name of ['DASH','DRE FINANCEIRO','FECHAMENTO MÊS']){
    const g=sheetGrid(wb,name); if(!g) continue;
    for(const row of g.slice(0,120)) for(const v of (row||[])){
      if(typeof v==='string'){ const m=v.match(/\b\d{2}\/\d{2}\/(20\d{2})\b/)||v.match(/RESULTADO\s+(20\d{2})/i); if(m) return +m[1]; }
    }
  }
  return new Date().getFullYear();
}
function dataLancamentos(wb){
  const g=sheetGrid(wb,'DASH'); if(!g) return null;
  for(const row of g.slice(0,10)) for(const v of (row||[])) if(typeof v==='string'){ const m=v.match(/\b(\d{2}\/\d{2}\/20\d{2})\b/); if(m) return m[1]; }
  return null;
}

function buildModel(wb){
  const dre=parseDRE(sheetGrid(wb,'DRE FINANCEIRO'));
  const base=parseBase(sheetGrid(wb,'Base Dash'));
  const z=()=>Array(12).fill(0);
  const v = k => (dre.by(k)||{vals:z()}).vals;
  const s = (k, fill=0) => (base.series(k)||Array(12).fill(null)).map(x=>x==null?fill:x);
  const sN = k => base.series(k)||Array(12).fill(null);
  // saídas = deduções + custos + todas as linhas de despesa entre margem e resultado operacional (sem dividendos)
  const iMC=dre.rows.findIndex(r=>r.key==='margem de contribuicao'), iRO=dre.rows.findIndex(r=>r.key==='resultado operacional');
  const despesas = dre.rows.slice(iMC+1, iRO<0?undefined:iRO).filter(r=>r.type==='sub');
  const saidasCats = [dre.by('deducoes impostos')||dre.by('deducoes'), dre.by('custos'), ...despesas].filter(Boolean);
  const saidas = MESES.map((_,i)=>-saidasCats.reduce((a,r)=>a+r.vals[i],0));
  const fin = dre.by('despesas financeiras');
  const finKids = fin? dre.rows.filter(r=>r.parent===fin) : [];

  let ultimo = num(base.scalar('ultimo mes com lancamentos',1));
  if(!ultimo){ const rb=v('receita bruta'); ultimo=rb.reduce((a,x,i)=>x?i+1:a,1); }
  let sel = num(base.scalar('mes selecionado dash',2)) || ultimo;

  return {
    dre, ano: anoDaPlanilha(wb), ate: dataLancamentos(wb), ultimo, sel,
    fat:v('faturamento bruto'), rb:v('receita bruta'), rl:v('resultado liquido'), fin: fin?fin.vals:z(),
    saidas, saidasCats: [...saidasCats, dre.by('distribuicao de dividendos')].filter(Boolean), finKids,
    contas:{ bb:sN('bb conta'), stone:sN('stone'), sic:sN('sicredi conta'), cora:sN('cora'), rende:sN('rende facil bb'), aplSic:sN('aplicacao sicredi') },
    apl:{ aplic:s('aplicacoes totais'), resg:s('resgates totais'), rendBB:s('bb rendimento'), rendSic:s('sicredi rendimento'), imp:s('impostos totais') },
    cart: base.cart, bancos: base.bancos,
  };
}

/* =====================================================================
   2. PERÍODOS
   ===================================================================== */
function periodo(model, mode, m){
  const q=Math.ceil(m/3), mi=m-1;
  if(mode==='mensal') return {
    idx:[mi], prev: m>1?[mi-1]:null, end:mi, prevEnd: m>1?mi-1:null,
    titulo:`${MESES_LONGO[mi][0].toUpperCase()+MESES_LONGO[mi].slice(1)} ${model.ano}`,
    secao:`Resultado do mês`, secaoSub:MESES_LONGO[mi], vs: m>1?MESES[mi-1].toLowerCase():null,
    buckets: range(0,mi).map(i=>({label:MESES[i], idx:[i]})), cur: mi };
  if(mode==='trimestral'){
    const ini=(q-1)*3, parcial = m < q*3;
    return {
      idx:range(ini,mi), prev: q>1?range(ini-3,ini-1):null, end:mi, prevEnd: q>1?ini-1:null,
      titulo:`${q}º trimestre ${model.ano}${parcial?` (até ${MESES[mi].toLowerCase()})`:''}`,
      secao:'Resultado do trimestre', secaoSub:`T${q}${parcial?' parcial: '+range(ini,mi).map(i=>MESES[i]).join('–'):' · '+MESES[ini]+'–'+MESES[mi]}`,
      vs: q>1?`T${q-1}`:null,
      buckets: range(1,q).map(t=>{ const a=(t-1)*3, b=Math.min(t*3-1,mi); return {label: `T${t}`+(t===q&&parcial?'*':''), idx:range(a,b)}; }), cur:q-1, parcial };
  }
  return {
    idx:range(0,mi), prev:null, end:mi, prevEnd: mi>0?0:null,
    titulo:`Acumulado ${model.ano} (jan–${MESES[mi].toLowerCase()})`,
    secao:'Resultado do ano', secaoSub:`acumulado Jan–${MESES[mi]}`, vs:null, vsSaldo: mi>0?'fim de jan':null,
    buckets: range(0,mi).map(i=>({label:MESES[i], idx:[i]})), cur: mi };
}

/* =====================================================================
   3. FORMATAÇÃO
   ===================================================================== */
const brl = (v,d=2) => (v<0?'-':'')+'R$ '+Math.abs(v).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d});
const int = v => Math.round(Math.abs(v)).toLocaleString('pt-BR');
const sig = v => (v>=0?'+':'−')+int(v);
const pct = (v,d=1) => (isFinite(v)?(v*100):0).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d})+'%';
const kfmt = v => (Math.abs(v)>=1000? (v/1000).toLocaleString('pt-BR',{maximumFractionDigits:0})+'k' : Math.round(v).toLocaleString('pt-BR'));
const curto = v => { const a=Math.abs(v), s=v<0?'−':''; return a>=1e6? `${s}R$ ${(a/1e6).toLocaleString('pt-BR',{maximumFractionDigits:2})} mi` : a>=1e3? `${s}R$ ${(a/1e3).toLocaleString('pt-BR',{maximumFractionDigits:1})} mil` : `${s}R$ ${a.toLocaleString('pt-BR',{maximumFractionDigits:0})}`; };
const delta = (v, label, goodUp=true) => label==null? '' : `<span class="${(v>=0)===goodUp?'up':'dn'}">${v>=0?'▲':'▼'} ${sig(v)}</span> vs ${label}`;
const esc = s => String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

const C = {bb:'#E3BE00',sic:'#3E8E41',sicL:'#8CC08E',stone:'#21B573',cora:'#D85FB8',fat:'#566BAF',rec:'#902884',sai:'#E07A2E',pos:'#2E9E5B',neg:'#D64545',navy:'#3A2459',gold:'#E0A100',roxo:'#902884',azul:'#566BAF',aberto:'#E0A100',vencido:'#C0392B',recebido:'#566BAF'};
const BANK_COLORS = {bb:C.bb, stone:C.stone, sicredi:C.sic, cora:C.cora};
const bankColor = name => BANK_COLORS[norm(name).split(' ')[0]] || '#7C8796';
const FIN_COLORS = ['#902884','#B5487A','#D9661F','#E0A100','#3D7FD1','#2E9E5B','#7C8796','#A04A1A'];

/* =====================================================================
   4. MONTAGEM DO RELATÓRIO
   ===================================================================== */
let charts=[];
function header(title, sub){
  return `<header class="ph"><div class="logo"><img class="rico" src="/img/icone.png" alt=""><div class="ttl"><h1>${title}</h1><p><b class="cli">${esc(EMP_NOME)}</b> · ${sub}</p></div></div>
  <div class="brand"><img class="rmarca" src="/img/marca.png" alt="inova com valor"><span>Evolução Financeira</span></div></header>`;
}
const footer = (p,n,txt) => `<footer class="pf"><span>${txt}</span><span>${p} / ${n}</span></footer>`;

function render(model, mode, m){
  charts.forEach(c=>c.destroy()); charts=[];
  const P = periodo(model, mode, m);
  const S = a => sumIdx(a, P.idx), SP = a => P.prev? sumIdx(a,P.prev) : null;
  const nMeses = P.idx.length;
  const rb=S(model.rb), fat=S(model.fat), sai=S(model.saidas), rl=S(model.rl), fin=-S(model.fin);
  const ct = model.contas;
  const bal = (arr,i) => i==null? null : (arr[i] ?? 0);
  const saldoTotal = i => i==null? null : ['bb','stone','sic','cora','rende','aplSic'].reduce((a,k)=>a+(ct[k][i]??0),0);
  const footTxt = `Evolução Financeira ${model.ano} · ${esc(EMP_NOME)}${model.ate?` · lançamentos até ${model.ate}`:''}`;
  // investimentos = consórcio e financiamentos (ficam dentro de "despesas financeiras" na DRE)
  const ehInvest = r => /consorcio|financiamento/.test(r.key);
  const invRows = model.finKids.filter(ehInvest);
  const invTem = invRows.some(r=>r.vals.slice(0,m).some(v=>Math.abs(v)>0.5));
  // o que esta planilha tem de fato (contas vazias, carteira vazia etc. ficam de fora)
  const tem = arr => Array.isArray(arr) && arr.some(v=>v!=null && Math.abs(v)>0.005);
  const nb = model.bancos||{}, mapeado = Object.keys(nb).length>0;
  const N1 = nb.bb || nb.rende || 'BB', N2 = nb.sic || nb.aplSic || 'Sicredi', NS = nb.stone || 'Stone', NC = nb.cora || 'Cora';
  const A1 = mapeado ? 'aplicação' : 'Rende Fácil';
  const tG1 = tem(ct.bb)||tem(ct.rende), tG2 = tem(ct.sic)||tem(ct.aplSic);
  const temContas = ['bb','rende','sic','aplSic','stone','cora'].some(k=>tem(ct[k]));
  const ap0 = model.apl||{};
  const temApl = ['aplic','resg','rendBB','rendSic','imp'].some(k=>tem(ap0[k])) || tem(ct.rende) || tem(ct.aplSic);
  const cartNames0 = Object.keys(model.cart||{});
  const temCart = cartNames0.some(b=>model.cart[b].some(v=>Math.abs(v)>0.005));
  const temPos = REPORT_OPTS.posicao && temCart;
  const NP = 4 + (temContas ? 1 : 0) + (temApl ? 1 : 0) + (temPos ? 1 : 0) + (invTem ? 1 : 0) + (REPORT_OPTS.extra||0);
  let PG = 0;

  /* ---------- página 1 ---------- */
  const isAnual = mode==='anual';
  const media = v => `média mensal: ${curto(v/nMeses)}`;
  const dlt = (cur, prev, good=true) => isAnual ? media(cur) : (prev==null ? '' : delta(cur-prev, P.vs, good));
  const marg = rb? rl/rb : 0, margPrev = P.prev && SP(model.rb) ? SP(model.rl)/SP(model.rb) : null;
  const sT=saldoTotal(P.end), sTp=saldoTotal(P.prevEnd);
  const kRes = [
    ['Faturamento bruto', brl(fat), dlt(fat, SP(model.fat)), C.fat],
    ['Receita bruta', brl(rb), dlt(rb, SP(model.rb)), C.rec],
    ['Saídas', brl(sai), dlt(sai, SP(model.saidas), false), C.sai],
    ['Resultado líquido', `<span class="${rl<0?'neg':''}">${brl(rl)}</span>`, dlt(rl, SP(model.rl)), C.navy],
    ['Margem líquida', `<span class="${marg<0?'neg':''}">${pct(marg)}</span>`, isAnual? 'margem acumulada no ano' : (margPrev==null?'':`${P.vs}: ${pct(margPrev)}`), '#B5487A'],
    mode==='mensal'
      ? ['Saldo total', brl(sT), (sTp==null?'':delta(sT-sTp,P.vs))+'<br>contas + aplicações', '#4A5160']
      : ['Despesas financeiras', brl(fin), dlt(fin, P.prev? -SP(model.fin):null, false), C.roxo],
  ];
  const bancos = [
    [`${N1} · conta`, ct.bb, C.bb], [`${N1} · ${A1}`, ct.rende, C.bb],
    [`${N2} · conta`, ct.sic, C.sic], [`${N2} · aplicação`, ct.aplSic, C.sic],
    [NS, ct.stone, C.stone], [NC, ct.cora, C.cora],
  ].filter(b=>tem(b[1]));
  const gB = n => n>=5 ? 'g6' : n===4 ? 'g4' : 'g3';
  const vsSaldo = P.vs || P.vsSaldo;
  const cartNames = Object.keys(model.cart);
  const cartTot = b => model.cart[b].reduce((a,x)=>a+x,0);
  const cartAll = cartNames.reduce((a,b)=>a+cartTot(b),0) || 1;
  const colT = j => cartNames.reduce((a,b)=>a+model.cart[b][j],0);
  const kC = [['Recebido',colT(0),C.recebido],['Em aberto',colT(1),C.aberto],['Vencido',colT(2),C.vencido]];

  // destaques automáticos
  const notes=[];
  const rbP=SP(model.rb), rlP=SP(model.rl);
  const bucketVals = arr => P.buckets.map(b=>sumIdx(arr,b.idx));
  if(isAnual){
    const mv=bucketVals(model.rb); const best=mv.indexOf(Math.max(...mv));
    notes.push([C.rec, `<b>Receita bruta acumulada de ${curto(rb)}</b> em ${nMeses} meses (média de ${curto(rb/nMeses)}/mês). Melhor mês: <b>${P.buckets[best].label}</b>, com ${curto(mv[best])}.`]);
    const rv=bucketVals(model.rl); const pos=rv.filter(x=>x>0).length;
    notes.push([rl<0?C.neg:C.pos, `<b>Resultado acumulado de ${curto(rl)}</b> (margem ${pct(marg)}). ${pos} de ${nMeses} meses fecharam positivos.`]);
  } else {
    if(rbP!=null && rbP) notes.push([C.rec, `<b>Receita bruta ${rb>=rbP?'subiu':'caiu'} ${pct(Math.abs(rb/rbP-1),0)}</b> em relação a ${P.vs}${P.parcial?' (trimestre ainda parcial)':''}, ficando em ${curto(rb)}.`]);
    else notes.push([C.rec, `<b>Receita bruta de ${curto(rb)}</b> no período.`]);
    const ytd = sumIdx(model.rl, range(0,m-1));
    notes.push([rl<0?C.neg:C.pos, `<b>Resultado líquido de ${curto(rl)}</b> (margem ${pct(marg)})${rlP!=null?`, contra ${curto(rlP)} em ${P.vs}`:''}. No ano, o acumulado está em <b>${curto(ytd)}</b>.`]);
  }
  if(model.finKids.length){
    const kids=model.finKids.map(k=>[k.label,-S(k.vals)]).sort((a,b)=>b[1]-a[1]);
    notes.push([C.roxo, `<b>Despesas financeiras de ${curto(fin)}</b> (${pct(rb?fin/rb:0)} da receita). Maiores itens: ${kids.slice(0,2).map(([l,v])=>`${l.toLowerCase()} (${curto(v)})`).join(' e ')}.`]);
  }
  notes.push([C.navy, `<b>Saldo total de ${curto(sT)}</b>${sTp!=null?` (${sig(sT-sTp)} vs ${vsSaldo})`:''}, ${pct(saldoTotal(P.end)? (bal(ct.rende,P.end)+bal(ct.aplSic,P.end))/sT : 0)} aplicado.${temCart ? ` Carteira com <b>${pct(colT(0)/cartAll)} recebido</b>${colT(1)?`; ${curto(colT(1))} em aberto`:''}${colT(2)?` e ${curto(colT(2))} vencidos`:''}.` : ''}`]);

  let html = `<section class="page">
    ${header(`Evolução Financeira — ${P.titulo}`, `${model.ate?`Lançamentos até ${model.ate} · `:''}${mode==='mensal'?'comparativos contra o mês anterior':mode==='trimestral'?'comparativos contra o trimestre anterior':'valores acumulados no ano'}`)}
    <div><div class="sec">${P.secao} <span>· ${P.secaoSub}</span></div>
      <div class="grid g6">${kRes.map(([l,v,d,c])=>`<div class="kpi big" style="--c:${c}"><div class="l">${l}</div><div class="v">${v}</div><div class="d">${d||'&nbsp;'}</div></div>`).join('')}</div></div>
    ${!bancos.length ? '' : `<div><div class="sec">Conta corrente e aplicações <span>· saldo em fim de ${MESES[P.end].toLowerCase()} · total ${brl(sT)}</span></div>
      <div class="grid ${gB(bancos.length)}">${bancos.map(([l,arr,c])=>{ const v=bal(arr,P.end), p=bal(arr,P.prevEnd); const d=p==null?null:v-p;
        return `<div class="kpi" style="--c:${c}"><div class="l">${l}</div><div class="v">${brl(v)}</div><div class="d">${d==null?'&nbsp;':Math.round(d)===0?'<span style="color:#9AA3AF">= sem variação</span>':delta(d,vsSaldo)}</div><div class="bar"><i style="width:${Math.max(sT?v/sT*100:0,0.6)}%"></i></div></div>`;}).join('')}</div></div>`}
    ${!temCart ? '' : `<div><div class="sec">Carteira de clientes <span>· acumulado do ano</span></div>
      <div class="grid g3">${kC.map(([l,v,c])=>{const p=v/cartAll; return `<div class="kpi big" style="--c:${c}"><div class="l">${l}</div><div class="v">${brl(v)}</div><div class="d">${pct(p, p>0&&p<0.01?2:1)} da carteira total</div><div class="bar"><i style="width:${Math.max(p*100,0.8)}%"></i></div></div>`;}).join('')}</div></div>`}
    <div><div class="sec">Destaques</div><div class="hl">${notes.slice(0,4).map(([c,t])=>`<div class="note" style="--c:${c}">${t}</div>`).join('')}</div></div>
    ${footer(++PG,NP,footTxt)}
  </section>`;

  /* ---------- página: resultado sem investimentos (logo depois do resumo) ---------- */
  if(invTem){
    const invS = idx => -invRows.reduce((t,r)=>t+sumIdx(r.vals, idx),0);
    const inv = invS(P.idx), semInv = rl + inv;
    const invYTD = invS(range(0,m-1)), rlYTD = sumIdx(model.rl, range(0,m-1));
    const margSem = rb ? semInv/rb : 0;
    const box = (t,v,d,c,cls='') => `<div class="eqc ${cls}" style="--c:${c}"><div class="l">${t}</div><div class="v ${v<0?'neg':''}">${brl(v)}</div><div class="d">${d}</div></div>`;
    html += `<section class="page inv-page">${header('Resultado sem investimentos', `${P.secaoSub} · visão gerencial`)}
      <div class="explica"><div class="exi">?</div><div><b>O que esta página mostra?</b> Na DRE, as parcelas de <b>consórcio e financiamentos</b> entram como despesa financeira.
        Só que elas pagam bens que continuam sendo da empresa (veículos, imóveis, cartas de consórcio): é dinheiro que sai do caixa, mas vira patrimônio.
        Aqui separamos essas parcelas para mostrar <b>quanto a operação da empresa realmente gerou</b>. O resultado oficial continua sendo o da DRE.</div></div>
      <div><div class="sec">${P.secao} <span>· ${P.secaoSub}</span></div>
        <div class="eq">
          ${box('Resultado líquido (real)', rl, 'o que sobrou de fato, como está na DRE', rl<0?C.neg:C.pos)}
          <div class="eqop">+</div>
          ${box('Investimentos', inv, 'consórcio e financiamentos pagos no período', C.roxo)}
          <div class="eqop">=</div>
          ${box('Resultado sem investimentos', semInv, `margem de ${pct(margSem)} sobre a receita (real: ${pct(marg)})`, C.navy, 'destaque')}
        </div></div>
      ${mode!=='anual' ? `<div class="note" style="--c:${C.roxo}">No ano (jan–${MESES[m-1].toLowerCase()}): resultado real de <b>${curto(rlYTD)}</b>, com <b>${curto(invYTD)}</b> investidos em consórcio e financiamentos. Sem esses investimentos, o resultado seria <b>${curto(rlYTD+invYTD)}</b>.</div>` : ''}
      <div class="grid g2b fill">
        <div class="card"><h3>Resultado real × sem investimentos</h3><div class="sub">R$ ${mode==='trimestral'?'por trimestre':'por mês'} · a diferença entre as barras é o que foi investido</div><div class="cv"><canvas id="c_inv"></canvas></div></div>
        <div class="card"><h3>Onde foram os investimentos</h3><div class="sub">${P.secaoSub} · total ${brl(inv)}</div><div class="cv"><canvas id="c_invtipo"></canvas></div></div>
      </div>${footer(++PG,NP,footTxt)}</section>`;
  }

  /* ---------- página 2 ---------- */
  const unidade = mode==='trimestral'?'por trimestre':'por mês';
  const parcialNota = P.parcial? ' · * trimestre parcial' : '';
  html += `<section class="page">${header('Desempenho', `Faturamento, receita, saídas e resultado ${unidade} · ${model.ano}${parcialNota}`)}
    <div class="grid g2 fill">
      <div class="card"><h3>Faturamento × Receita</h3><div class="sub">R$ ${unidade}</div><div class="cv"><canvas id="c_fatrec"></canvas></div></div>
      <div class="card"><h3>Resultado líquido ${mode==='trimestral'?'trimestral':'mensal'}</h3><div class="sub">Barras: resultado do período · linha: acumulado no ano</div><div class="cv"><canvas id="c_res"></canvas></div></div>
      <div class="card"><h3>Receita × Saídas</h3><div class="sub">R$ ${unidade}</div><div class="cv"><canvas id="c_recsai"></canvas></div></div>
      <div class="card"><h3>Evolução de caixa</h3><div class="sub">Saldo no fim de cada ${mode==='trimestral'?'trimestre':'mês'} · em contas + aplicado</div><div class="cv"><canvas id="c_caixa"></canvas></div></div>
    </div>${footer(++PG,NP,footTxt)}</section>`;

  /* ---------- página 3: DRE ---------- */
  let cols, curCol, extra='';
  if(mode==='mensal'){ cols = MESES.map((l,i)=>({l, idx: i<m?[i]:null})); curCol=m-1; }
  else { cols = range(1,4).map(t=>{ const a=(t-1)*3, b=Math.min(t*3-1,m-1); return {l:`T${t}`+(b<t*3-1&&b>=a?'*':''), idx: a<=m-1? range(a,b):null}; }); curCol = mode==='trimestral'? Math.ceil(m/3)-1 : -1; }
  const ytdIdx = range(0,m-1);
  const rbYTD = sumIdx(model.rb, ytdIdx);
  const visRows = model.dre.rows.filter(r => r.type!=='sub' && r.type!=='sub2' || r.vals.slice(0,m).some(x=>Math.abs(x)>0.005));
  const cell = (v,cls='') => { if(v==null) return `<td class="zero ${cls}">–</td>`; const r=Math.round(v); if(r===0) return `<td class="zero ${cls}">–</td>`; return `<td class="${r<0?'neg ':''}${cls}">${r<0?'('+int(r)+')':int(r)}</td>`; };
  let th = '<tr><th>R$</th>'+cols.map((c,i)=>`<th class="${i===curCol?'cur':''}">${c.l}</th>`).join('')+`<th>${mode==='mensal'?'Total':'Ano'}</th><th>% Receita</th>${isAnual?'<th>Média mensal</th>':''}</tr>`;
  let tb = visRows.map(r=>{
    const tot=sumIdx(r.vals,ytdIdx);
    return `<tr class="${r.type}"><td>${esc(r.label)}</td>`+cols.map((c,i)=>cell(c.idx?sumIdx(r.vals,c.idx):null, i===curCol?'cur':'')).join('')+cell(tot,'t')+
      (r.type==='plain'?'<td class="pct"></td>':`<td class="pct ${tot<0?'neg':''}">${tot<0?'('+pct(-tot/rbYTD)+')':pct(tot/rbYTD)}</td>`)+
      (isAnual? cell(tot/m) : '')+'</tr>';
  }).join('');
  const ocultas = model.dre.rows.length - visRows.length;
  html += `<section class="page">${header(`DRE — ${mode==='mensal'?'mensal':mode==='trimestral'?'por trimestre':'anual'} ${model.ano}`, `Valores em R$ · negativos entre parênteses · ${mode==='anual'?'acumulado':'período de referência destacado'} até ${MESES[m-1].toLowerCase()}`)}
    <div class="dre"><table>${th}${tb}</table></div>
    <div class="dnote">Total/Ano = acumulado de jan a ${MESES[m-1].toLowerCase()}. Linhas em itálico detalham as despesas financeiras.${ocultas?` ${ocultas} linha(s) sem valores no período foram ocultadas.`:''}${cols.some(c=>c.l.endsWith('*'))?' * trimestre parcial.':''}</div>
    ${footer(++PG,NP,footTxt)}</section>`;

  /* ---------- página 4 ---------- */
  html += `<section class="page">${header(temCart ? 'Carteira, saídas e despesas financeiras' : 'Saídas e despesas financeiras', temCart ? `Saídas e despesas financeiras: ${P.secaoSub} · carteira: acumulado do ano` : `${P.secaoSub} · para onde foi o dinheiro`)}
    <div class="grid ${temCart?'g2b':'g2'} fill">
      ${temCart ? `<div class="card"><h3>Títulos por banco</h3><div class="sub">Participação no total de títulos do ano</div><div class="cv"><canvas id="c_tit"></canvas></div></div>` : ''}
      <div class="card"><h3>Saídas por categoria</h3><div class="sub">${P.secaoSub} (R$)</div><div class="cv"><canvas id="c_cat"></canvas></div></div>
      ${temCart ? `<div class="card"><h3>Posição da carteira por banco</h3><div class="sub">% recebido, em aberto e vencido</div><div class="cv"><canvas id="c_pos"></canvas></div></div>` : ''}
      <div class="card"><h3>Despesas financeiras por tipo</h3><div class="sub">${P.secaoSub} · total ${brl(fin)}</div><div class="cv"><canvas id="c_fin"></canvas></div></div>
    </div>${footer(++PG,NP,footTxt)}</section>`;

  /* ---------- página 5 ---------- */
  const temCC = ['bb','sic','stone','cora'].some(k=>tem(ct[k]));
  if(temContas) html += `<section class="page">${header('Caixa por banco', `Saldos no fim de cada ${mode==='trimestral'?'trimestre':'mês'} em conta corrente e aplicações`)}
    <div class="grid g2 fill">
      ${tG1 ? `<div class="card"><h3>${esc(N1)} — ${tem(ct.bb)&&tem(ct.rende) ? `caixa (conta + ${A1})` : tem(ct.rende) ? A1 : 'conta corrente'}</h3><div class="sub">R$</div><div class="cv"><canvas id="c_bb"></canvas></div></div>` : ''}
      ${tG2 ? `<div class="card"><h3>${esc(N2)} — ${tem(ct.sic)&&tem(ct.aplSic) ? 'caixa (conta + aplicação)' : tem(ct.aplSic) ? 'aplicação' : 'conta corrente'}</h3><div class="sub">R$</div><div class="cv"><canvas id="c_sic"></canvas></div></div>` : ''}
      ${tG1 && tG2 ? `<div class="card"><h3>${esc(N1)} × ${esc(N2)} — caixa total</h3><div class="sub">R$</div><div class="cv"><canvas id="c_bbsic"></canvas></div></div>` : ''}
      ${temCC ? `<div class="card"><h3>Saldo em conta corrente por banco</h3><div class="sub">R$ (sem aplicações)</div><div class="cv"><canvas id="c_contas"></canvas></div></div>` : ''}
    </div>${footer(++PG,NP,footTxt)}</section>`;

  /* ---------- página 6 ---------- */
  if(temApl) html += `<section class="page">${header('Aplicações financeiras', `Movimentação, rendimentos e saldos aplicados ${unidade}`)}
    <div class="grid g2 fill">
      <div class="card"><h3>Aplicações × Resgates</h3><div class="sub">Movimentação ${unidade} (R$)</div><div class="cv"><canvas id="c_apres"></canvas></div></div>
      <div class="card"><h3>Rendimento × Impostos</h3><div class="sub">R$ ${unidade} · IR + IOF</div><div class="cv"><canvas id="c_rend"></canvas></div></div>
      <div class="card"><h3>Rendimentos por banco</h3><div class="sub">R$ ${unidade}</div><div class="cv"><canvas id="c_rendbk"></canvas></div></div>
      <div class="card"><h3>Saldo das aplicações</h3><div class="sub">R$ no fim de cada ${mode==='trimestral'?'trimestre':'mês'}</div><div class="cv"><canvas id="c_apl"></canvas></div></div>
    </div>${footer(++PG,NP,footTxt)}</section>`;

  /* ---------- página 7: posição de clientes (opcional por empresa) ---------- */
  const bancosPos = ['BB','Cora','Stone','Sicredi'].filter(b=>model.cart[b]).concat(cartNames.filter(b=>!['BB','Cora','Stone','Sicredi'].includes(b)));
  if(temPos){
    const pr = bancosPos.map(b=>{ const [rec,ab,ve]=model.cart[b]; return {b, rec, ab, ve, ar:ab+ve}; });
    const tAb=pr.reduce((a,x)=>a+x.ab,0), tVe=pr.reduce((a,x)=>a+x.ve,0), tRec=pr.reduce((a,x)=>a+x.rec,0), tAr=tAb+tVe;
    const maior = pr.slice().sort((a,b)=>b.ar-a.ar)[0];
    const kP = [
      ['Total a receber', brl(tAr), `em aberto + vencido · ${pr.length} banco(s)`, C.roxo],
      ['A vencer (em aberto)', brl(tAb), `${pct(tAr?tAb/tAr:0)} do a receber`, C.aberto],
      ['Vencido', `<span class="${tVe>0?'neg':''}">${brl(tVe)}</span>`, `${pct(tAr?tVe/tAr:0)} do a receber`, C.vencido],
      ['Maior saldo a receber', maior&&maior.ar>0? esc(maior.b) : '—', maior&&maior.ar>0? `${brl(maior.ar)} · ${pct(tAr?maior.ar/tAr:0)} do total` : 'nada a receber', C.azul],
    ];
    const linha = (x,cls='') => `<tr class="${cls}"><td>${esc(x.b)}</td><td>${int(x.rec)}</td><td>${int(x.ab)}</td><td class="${x.ve>0.5?'neg':''}">${int(x.ve)}</td><td class="t">${int(x.ar)}</td><td class="pct">${pct(tAr?x.ar/tAr:0)}</td></tr>`;
    html += `<section class="page">${header('Posição de clientes', 'Títulos do ano por banco · a receber = em aberto (a vencer) + vencido')}
      <div><div class="sec">Quanto falta receber <span>· acumulado do ano</span></div>
        <div class="grid g4">${kP.map(([l,v,d,c])=>`<div class="kpi big" style="--c:${c}"><div class="l">${l}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join('')}</div></div>
      <div class="grid g2b fill">
        <div class="card"><h3>A receber por banco</h3><div class="sub">R$ · em aberto (a vencer) + vencido</div><div class="cv"><canvas id="c_receber"></canvas></div></div>
        <div class="card"><h3>Posição por banco</h3><div class="sub">R$ · títulos do ano</div>
          <div class="ptab"><table><tr><th>Banco</th><th>Recebido</th><th>Em aberto</th><th>Vencido</th><th>A receber</th><th>% do total</th></tr>
            ${pr.map(x=>linha(x)).join('')}${linha({b:'Total',rec:tRec,ab:tAb,ve:tVe,ar:tAr},'final')}</table></div></div>
      </div>${footer(++PG,NP,footTxt)}</section>`;
  }

  REPORT_EL.innerHTML = html;

  /* ---------- gráficos ---------- */
  const B = P.buckets, L = B.map(b=>b.label);
  const agg = arr => B.map(b=>sumIdx(arr,b.idx));
  const endOf = arr => B.map(b=>arr[b.idx[b.idx.length-1]] ?? 0);
  const rlB = agg(model.rl); const acc=[]; rlB.reduce((s,v,i)=>(acc[i]=s+v),0);
  const emContas = endOf(ct.bb).map((v,i)=>v+endOf(ct.stone)[i]+endOf(ct.sic)[i]+endOf(ct.cora)[i]);
  const rende=endOf(ct.rende), aplSic=endOf(ct.aplSic), aplicado=rende.map((v,i)=>v+aplSic[i]);
  const saldoTot = aplicado.map((v,i)=>v+emContas[i]);
  const curIdx = B.length-1;

  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.size = 10.5; Chart.defaults.color = '#86868b';
  Chart.defaults.animation = false; Chart.defaults.devicePixelRatio = Math.max(2, window.devicePixelRatio||1); Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.plugins.legend.position = 'bottom';
  Object.assign(Chart.defaults.plugins.legend.labels,{boxWidth:10,boxHeight:10,padding:12});
  Chart.defaults.elements.bar.borderRadius = 4; Chart.defaults.elements.line.borderWidth = 2.5; Chart.defaults.elements.point.radius = 3;
  Chart.defaults.datasets.bar.maxBarThickness = mode==='trimestral'? 46 : 26;

  const yK = (extra={}) => ({ grid:{color:c=>c.tick&&c.tick.value===0?'#9AA3AF':'#EEF1F5'}, border:{display:false}, ticks:{callback:v=>kfmt(v)}, ...extra });
  const xC = { grid:{display:false}, border:{color:'#D5DBE3'} };
  const mk = (id,cfg) => charts.push(new Chart(document.getElementById(id), cfg));
  const line = (label,data,color,extra={}) => ({type:'line',label,data,borderColor:color,backgroundColor:color,pointBackgroundColor:'#fff',pointBorderWidth:2,tension:.25,...extra});
  const bar  = (label,data,color,extra={}) => ({type:'bar',label,data,backgroundColor:color,...extra});
  const fade = (color) => data => data.map((_,i)=> i===curIdx || mode==='anual' ? color : color+'99');

  mk('c_fatrec',{type: mode==='trimestral'?'bar':'line',data:{labels:L,datasets:[
    mode==='trimestral'? bar('Faturamento bruto',agg(model.fat),C.fat) : line('Faturamento bruto',agg(model.fat),C.fat),
    mode==='trimestral'? bar('Receita bruta',agg(model.rb),C.rec) : line('Receita bruta',agg(model.rb),C.rec)]},
    options:{scales:{x:xC,y:yK({beginAtZero:true})}}});
  mk('c_res',{data:{labels:L,datasets:[
    line('Acumulado no ano',acc,C.gold,{order:0}),
    bar('Resultado',rlB,rlB.map(v=>v>=0?C.pos:C.neg),{order:1})]},
    options:{plugins:{legend:{labels:{generateLabels:()=>[
      {text:'Resultado positivo',fillStyle:C.pos,strokeStyle:C.pos},{text:'Resultado negativo',fillStyle:C.neg,strokeStyle:C.neg},{text:'Acumulado no ano',fillStyle:C.gold,strokeStyle:C.gold}]}}},
      scales:{x:xC,y:yK({grace:'8%'})}}});
  mk('c_recsai',{type:'bar',data:{labels:L,datasets:[bar('Receita bruta',agg(model.rb),C.rec),bar('Saídas',agg(model.saidas),C.sai)]},options:{scales:{x:xC,y:yK({beginAtZero:true})}}});
  mk('c_caixa',{data:{labels:L,datasets:[
    line('Saldo total',saldoTot,C.gold,{order:0}),
    bar('Aplicado',aplicado,C.sic,{stack:'s',order:1}),
    bar('Em contas',emContas,C.fat,{stack:'s',order:1})]},
    options:{scales:{x:{...xC,stacked:true},y:yK({stacked:true,min:0})}}});

  const cn = ['BB','Cora','Stone','Sicredi'].filter(b=>model.cart[b]).concat(cartNames.filter(b=>!['BB','Cora','Stone','Sicredi'].includes(b)));
  const cartMi = cartAll/1e6;
  if(temCart){
  mk('c_tit',{type:'doughnut',data:{labels:cn,datasets:[{data:cn.map(b=>+(cartTot(b)/cartAll*100).toFixed(1)),backgroundColor:cn.map(bankColor),borderColor:'#fff',borderWidth:2}]},
    options:{cutout:'62%',plugins:{legend:{position:'right',labels:{generateLabels:ch=>cn.map((b,i)=>({text:`${b}  ${pct(cartTot(b)/cartAll)}`,fillStyle:bankColor(b),strokeStyle:bankColor(b),index:i}))}},tooltip:{enabled:false}}},
    plugins:[{id:'lbl',afterDatasetDraw(ch){const {ctx}=ch;const meta=ch.getDatasetMeta(0);ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';
      meta.data.forEach((a,i)=>{const v=ch.data.datasets[0].data[i];if(v<5)return;const p=a.tooltipPosition();ctx.font='600 11px '+Chart.defaults.font.family;ctx.fillStyle='#fff';ctx.fillText(Math.round(v)+'%',p.x,p.y);});
      const c=meta.data[0];if(!c){ctx.restore();return;}ctx.fillStyle='#1B2433';ctx.font='700 15px '+Chart.defaults.font.family;ctx.fillText(curto(cartAll),c.x,c.y-6);ctx.font='500 9.5px '+Chart.defaults.font.family;ctx.fillStyle='#6B7686';ctx.fillText('em títulos no ano',c.x,c.y+10);ctx.restore();}}]});
  mk('c_pos',{type:'bar',data:{labels:cn,datasets:[['Recebido',C.recebido],['Em aberto',C.aberto],['Vencido',C.vencido]].map(([n,c],j)=>bar(n,cn.map(b=>model.cart[b][j]/(cartTot(b)||1)*100),c,{stack:'p'}))},
    options:{indexAxis:'y',elements:{bar:{borderRadius:0}},datasets:{bar:{maxBarThickness:20}},scales:{x:{stacked:true,max:100,grid:{color:'#EEF1F5'},border:{display:false},ticks:{callback:v=>v+'%'}},y:{stacked:true,grid:{display:false}}}}});
  }

  const hbar = (id, items, color) => {
    const tot = items.reduce((a,x)=>a+Math.max(x[1],0),0)||1;
    mk(id,{type:'bar',data:{labels:items.map(x=>x[0]),datasets:[bar('R$',items.map(x=>x[1]),color,{maxBarThickness:22})]},
      options:{indexAxis:'y',layout:{padding:{right:92}},plugins:{legend:{display:false}},scales:{x:{grid:{color:'#EEF1F5'},border:{display:false},beginAtZero:true,ticks:{callback:v=>kfmt(v)}},y:{grid:{display:false},border:{color:'#D5DBE3'},ticks:{color:'#1B2433',font:{size:10}}}}},
      plugins:[{id:'v',afterDatasetDraw(ch){const {ctx}=ch;ctx.save();ctx.textBaseline='middle';const ff=Chart.defaults.font.family;
        ch.getDatasetMeta(0).data.forEach((b,i)=>{const v=items[i][1];const t='R$ '+kfmt(v);ctx.font='600 10px '+ff;ctx.fillStyle='#1B2433';ctx.fillText(t,Math.max(b.x,b.base)+6,b.y);const w=ctx.measureText(t).width;ctx.font='500 9px '+ff;ctx.fillStyle='#8A93A0';ctx.fillText(pct(Math.max(v,0)/tot),Math.max(b.x,b.base)+12+w,b.y);});ctx.restore();}}]});
  };
  const cats = model.saidasCats.map(r=>[r.label.replace(/^\(−\)\s*/,''), -S(r.vals)]).filter(x=>Math.abs(x[1])>0.5).sort((a,b)=>b[1]-a[1]);
  hbar('c_cat', cats, C.sai);
  const fk = model.finKids.map(r=>[r.label, -S(r.vals)]).filter(x=>Math.abs(x[1])>0.5).sort((a,b)=>b[1]-a[1]);
  hbar('c_fin', fk, C.roxo);
  if(invTem){
    const invB = B.map(b=>-invRows.reduce((t,r)=>t+sumIdx(r.vals,b.idx),0));
    const realB = agg(model.rl), semB = realB.map((v,i)=>v+invB[i]);
    mk('c_inv',{type:'bar',data:{labels:L,datasets:[
      bar('Resultado real', realB, realB.map(v=>v>=0?C.pos:C.neg)),
      bar('Sem investimentos', semB, C.navy)]},
      options:{plugins:{legend:{labels:{generateLabels:()=>[
        {text:'Resultado real',fillStyle:C.pos,strokeStyle:C.pos},{text:'Resultado sem investimentos',fillStyle:C.navy,strokeStyle:C.navy}]}},
        tooltip:{callbacks:{afterBody:it=>{ const i=it[0].dataIndex; return 'Investido: '+brl(invB[i]); }}}},
        scales:{x:xC,y:yK({grace:'8%'})}}});
    hbar('c_invtipo', invRows.map(r=>[r.label, -S(r.vals)]).filter(x=>Math.abs(x[1])>0.5).sort((a,b)=>b[1]-a[1]), C.roxo);
  }

  const so = ds => ds.filter(d=>d.data.some(v=>v!=null && Math.abs(v)>0.005));
  const mkSe = (id,cfg) => { if(document.getElementById(id)) mk(id,cfg); };
  const cBB=endOf(ct.bb), cSic=endOf(ct.sic);
  mkSe('c_bb',{data:{labels:L,datasets:[line('Total '+N1,rende.map((v,i)=>v+cBB[i]),'#7A6500',{order:0}),...so([bar(mapeado?N1+' · aplicação':'Rende Fácil',rende,C.bb,{stack:'b',order:1}),bar('Conta '+N1,cBB,'#F3DD6B',{stack:'b',order:1})])]},options:{scales:{x:{...xC,stacked:true},y:yK({stacked:true,beginAtZero:true})}}});
  mkSe('c_sic',{data:{labels:L,datasets:[line('Total '+N2,aplSic.map((v,i)=>v+cSic[i]),'#1D4D20',{order:0}),...so([bar('Aplicação',aplSic,C.sic,{stack:'b',order:1}),bar('Conta '+N2,cSic,C.sicL,{stack:'b',order:1})])]},options:{scales:{x:{...xC,stacked:true},y:yK({stacked:true,beginAtZero:true})}}});
  mkSe('c_bbsic',{type:'line',data:{labels:L,datasets:[line(N1,rende.map((v,i)=>v+cBB[i]),C.bb),line(N2,aplSic.map((v,i)=>v+cSic[i]),C.sic)]},options:{scales:{x:xC,y:yK({beginAtZero:true})}}});
  mkSe('c_contas',{type:'line',data:{labels:L,datasets:so([line(N1,cBB,C.bb),line(N2,cSic,C.sic),line(NS,endOf(ct.stone),C.stone),line(NC,endOf(ct.cora),C.cora)])},
    options:{scales:{x:xC,y:yK({ticks:{callback:v=>(v/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})+'k'}})}}});

  const ap=model.apl, rendBB=agg(ap.rendBB), rendSic=agg(ap.rendSic), rendBr=rendBB.map((v,i)=>v+rendSic[i]), imp=agg(ap.imp);
  mkSe('c_apres',{type:'bar',data:{labels:L,datasets:[bar('Aplicações',agg(ap.aplic),C.fat),bar('Resgates',agg(ap.resg),C.sai)]},options:{scales:{x:xC,y:yK({beginAtZero:true})}}});
  const plain = {grid:{color:'#EEF1F5'},border:{display:false},beginAtZero:true,ticks:{callback:v=>v.toLocaleString('pt-BR')}};
  mkSe('c_rend',{data:{labels:L,datasets:[line('Rendimento líquido',rendBr.map((v,i)=>v-imp[i]),C.gold,{order:0}),bar('Rendimento bruto',rendBr,C.rec,{order:1}),bar('Impostos (IR + IOF)',imp,C.neg,{order:1})]},options:{scales:{x:xC,y:plain}}});
  mkSe('c_rendbk',{type:'bar',data:{labels:L,datasets:so([bar(N2,rendSic,C.sic,{stack:'r'}),bar(N1,rendBB,C.bb,{stack:'r'})])},options:{scales:{x:{...xC,stacked:true},y:{...plain,stacked:true}}}});
  mkSe('c_apl',{type:'line',data:{labels:L,datasets:[line('Total aplicado',aplicado,C.navy,{borderWidth:3}),...so([line(mapeado?N2+' · aplicação':'Aplicação Sicredi',aplSic,C.sic),line(mapeado?N1+' · aplicação':'Rende Fácil BB',rende,C.bb)])]},options:{scales:{x:xC,y:yK({beginAtZero:true})}}});

  if(temPos && document.getElementById('c_receber')){
    const ab = bancosPos.map(b=>model.cart[b][1]), ve = bancosPos.map(b=>model.cart[b][2]);
    mk('c_receber',{type:'bar',data:{labels:bancosPos,datasets:[bar('Em aberto (a vencer)',ab,C.aberto,{stack:'r'}),bar('Vencido',ve,C.vencido,{stack:'r'})]},
      options:{indexAxis:'y',layout:{padding:{right:86}},elements:{bar:{borderRadius:0}},datasets:{bar:{maxBarThickness:34}},
        scales:{x:{stacked:true,beginAtZero:true,grid:{color:'#EEF1F5'},border:{display:false},ticks:{callback:v=>kfmt(v)}},
                y:{stacked:true,grid:{display:false},border:{color:'#D5DBE3'},ticks:{color:'#241A33',font:{size:11,weight:'600'}}}}},
      plugins:[{id:'tot',afterDatasetsDraw(ch){ const {ctx}=ch; const m0=ch.getDatasetMeta(0), m1=ch.getDatasetMeta(1);
        ctx.save(); ctx.textBaseline='middle'; ctx.font='700 11px '+Chart.defaults.font.family; ctx.fillStyle='#241A33';
        bancosPos.forEach((b,i)=>{ const e0=m0.data[i], e1=m1.data[i]; if(!e0) return; const x=Math.max(e0.x, e1&&!m1.hidden?e1.x:0, e0.base);
          ctx.fillText(curto(ab[i]+ve[i]), x+6, e0.y); }); ctx.restore(); }}]});
  }
  window.__ready = true;
}

/* =====================================================================
   5. MODELO <-> BANCO (o painel é guardado já processado, em JSON)
   ===================================================================== */
function serializeModel(m){
  const rows=m.dre.rows;
  return { v:1, rows: rows.map(r=>({key:r.key,label:r.label,type:r.type,vals:r.vals,p:r.parent?rows.indexOf(r.parent):-1})),
    ano:m.ano, ate:m.ate, ultimo:m.ultimo, sel:m.sel, fat:m.fat, rb:m.rb, rl:m.rl, fin:m.fin, saidas:m.saidas,
    saidasCats:m.saidasCats.map(r=>rows.indexOf(r)), finKids:m.finKids.map(r=>rows.indexOf(r)), contas:m.contas, apl:m.apl, cart:m.cart, bancos:m.bancos||{} };
}
function hydrateModel(s){
  const rows=s.rows.map(r=>({key:r.key,label:r.label,type:r.type,vals:r.vals,parent:null}));
  s.rows.forEach((r,i)=>{ if(r.p>=0) rows[i].parent=rows[r.p]; });
  return { ...s, dre:{rows, by:k=>rows.find(r=>r.key===k)}, saidasCats:(s.saidasCats||[]).map(i=>rows[i]).filter(Boolean), finKids:(s.finKids||[]).map(i=>rows[i]).filter(Boolean) };
}

/* utilidades de tela usadas pelas duas páginas */
const $ = id => document.getElementById(id);
const dataBR = iso => { if(!iso) return ''; const d=new Date(iso); return d.toLocaleDateString('pt-BR')+' às '+d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}); };
const diaBR = iso => iso? new Date(iso).toLocaleDateString('pt-BR') : '';
let _toastT; function toast(msg){ const t=$('toast'); if(!t) return; t.textContent=msg; t.classList.add('show'); clearTimeout(_toastT); _toastT=setTimeout(()=>t.classList.remove('show'),3200); }
function setEmpty(t, s){ const el=$('empty'); if(t==null){ el.hidden=true; return; } el.hidden=false; el.innerHTML=''; const b=document.createElement('b'); b.textContent=t; el.append(b, document.createTextNode(s||'')); }
function libsOk(){ return typeof XLSX!=='undefined' && typeof Chart!=='undefined'; }


/* =====================================================================
   6. CALENDÁRIO DE CONTAS A PAGAR (estilo agenda do Teams)
   ===================================================================== */
const DIAS_SEM = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const isoDe = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const hojeISO = () => isoDe(new Date());
const mesAtual = () => hojeISO().slice(0,7);
function mesMais(mes, n){ let [a,m]=mes.split('-').map(Number); m+=n; while(m>12){m-=12;a++;} while(m<1){m+=12;a--;} return a+'-'+String(m).padStart(2,'0'); }
const nomeMes = mes => { const [a,m]=mes.split('-').map(Number); return MESES_LONGO[m-1][0].toUpperCase()+MESES_LONGO[m-1].slice(1)+' '+a; };
const dataCurta = iso => iso.slice(8,10)+'/'+iso.slice(5,7);

function calendarioHTML(itens, mes){
  const [a,m] = mes.split('-').map(Number);
  const hoje = hojeISO();
  const doMes = (itens||[]).filter(x=>x.vencimento.startsWith(mes)).sort((x,y)=>x.vencimento.localeCompare(y.vencimento)||y.valor-x.valor);
  const porDia = {}; doMes.forEach(x=>{ (porDia[+x.vencimento.slice(8)] ||= []).push(x); });
  const soma = l => l.reduce((t,x)=>t+x.valor,0);
  const total = soma(doMes);
  const passadas = doMes.filter(x=>x.vencimento<hoje);
  const d0=new Date(); const ini=new Date(d0.getFullYear(),d0.getMonth(),d0.getDate()-d0.getDay()), fim=new Date(ini.getFullYear(),ini.getMonth(),ini.getDate()+6);
  const semana = doMes.filter(x=>x.vencimento>=isoDe(ini) && x.vencimento<=isoDe(fim));
  const proxima = doMes.find(x=>x.vencimento>=hoje);
  const ehMesAtual = mes===hoje.slice(0,7);
  const kpis = [
    ['Total do mês', brl(total), `${doMes.length} conta(s) a pagar`, C.roxo],
    ehMesAtual ? ['Vencem nesta semana', brl(soma(semana)), `${semana.length} conta(s) · ${dataCurta(isoDe(ini))} a ${dataCurta(isoDe(fim))}`, C.aberto]
               : ['Maior conta do mês', doMes.length? brl(Math.max(...doMes.map(x=>x.valor))) : '—', doMes.length? esc(doMes.slice().sort((x,y)=>y.valor-x.valor)[0].recebedor) : 'nenhuma conta', C.aberto],
    ['Já venceram', brl(soma(passadas)), `${passadas.length} conta(s) com data antes de hoje`, '#7C8796'],
    ['Próximo vencimento', proxima? dataCurta(proxima.vencimento) : '—', proxima? `${esc(proxima.recebedor)} · ${brl(proxima.valor)}` : 'nada a vencer neste mês', C.azul],
  ];
  const MAXC = 3;
  const primeiro = new Date(a,m-1,1).getDay(), nd = new Date(a,m,0).getDate();
  let cels = '';
  for(let i=0;i<primeiro;i++) cels += '<div class="cd fora"></div>';
  for(let d=1; d<=nd; d++){
    const iso = mes+'-'+String(d).padStart(2,'0'), l = porDia[d]||[];
    const cls = ['cd', iso<hoje?'pass':'', iso===hoje?'hoje':'', (new Date(a,m-1,d).getDay()%6===0)?'fds':''].join(' ');
    cels += `<div class="${cls}"><div class="cdh"><span class="dn">${d}</span>${l.length?`<span class="dt">${curto(soma(l))}</span>`:''}</div>`
      + l.slice(0,MAXC).map(x=>`<div class="ev2${x.tipo==='contrato'?' ctr':x.tipo==='repasse'?' rep':''}" title="${esc(x.recebedor)} · ${brl(x.valor)}"><b>${esc(x.recebedor)}</b><span>${brl(x.valor)}</span></div>`).join('')
      + (l.length>MAXC?`<div class="mais">+${l.length-MAXC} conta(s) · ${curto(soma(l.slice(MAXC)))}</div>`:'') + '</div>';
  }
  const resto = (7 - (primeiro+nd)%7) % 7;
  for(let i=0;i<resto;i++) cels += '<div class="cd fora"></div>';
  const agenda = Object.keys(porDia).map(Number).sort((x,y)=>x-y).map(d=>{
    const iso = mes+'-'+String(d).padStart(2,'0'), l = porDia[d];
    return `<div class="ag ${iso<hoje?'pass':''} ${iso===hoje?'hoje':''}"><div class="agd"><b>${d}</b><span>${DIAS_SEM[new Date(a,m-1,d).getDay()]}</span></div><div class="agl">`
      + l.map(x=>`<div class="ev2${x.tipo==='contrato'?' ctr':x.tipo==='repasse'?' rep':''}"><b>${esc(x.recebedor)}</b><span>${brl(x.valor)}</span></div>`).join('') + '</div></div>';
  }).join('') || '<div class="nodata">Nenhuma conta neste mês.</div>';
  const n = (REPORT_EL ? REPORT_EL.querySelectorAll('.page:not(.cal-page)').length : 0) + 1;
  return `<section class="page cal-page">${header(`Contas a pagar — ${nomeMes(mes)}`, 'Vencimentos do mês · boletos cadastrados pelo consultor')}
    <div class="grid g4">${kpis.map(([l,v,d,c])=>`<div class="kpi big" style="--c:${c}"><div class="l">${l}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join('')}</div>
    <div class="calnav"><button type="button" data-cal="-1" aria-label="Mês anterior">‹</button><b>${nomeMes(mes)}</b><button type="button" data-cal="1" aria-label="Próximo mês">›</button>${ehMesAtual?'':'<button type="button" data-cal="0" class="hojeb">Hoje</button>'}</div>
    <div class="cal"><div class="calh">${DIAS_SEM.map(d=>`<div>${d}</div>`).join('')}</div><div class="calg">${cels}</div></div>
    <div class="agenda">${agenda}</div>
    ${footer(n, n, `Contas a pagar · ${esc(EMP_NOME)}`)}</section>`;
}
function anexarCalendario(itens, mes){
  if(!REPORT_EL) return;
  const velho = REPORT_EL.querySelector('.cal-page');
  const div = document.createElement('div'); div.innerHTML = calendarioHTML(itens, mes);
  const novo = div.firstElementChild;
  if(velho){ if(velho.classList.contains('tv-cur')){ novo.classList.add('tv-cur'); } velho.replaceWith(novo); }
  else REPORT_EL.append(novo);
  renumerarPaginas();
  return novo;
}
function renumerarPaginas(){
  if(!REPORT_EL) return;
  const ps = REPORT_EL.querySelectorAll('.page');
  ps.forEach((p,i)=>{ const sp = p.querySelector('footer.pf span:last-child'); if(sp) sp.textContent = (i+1)+' / '+ps.length; });
}

/* =====================================================================
   7. CONTRATOS: parcelas a pagar e previsão
   ===================================================================== */
const CTR_CORES = ['#902884','#566BAF','#E07A2E','#2E9E5B','#B5487A','#0F7C86','#7A6500','#3A2459'];
let CTR_CHARTS = [];
// numera as parcelas e transforma em itens do calendário (usado na tela do consultor)
function parcelasNoCalendario(contratos){
  const out=[];
  (contratos||[]).forEach(c=>{ const ps=c.parcelas.slice().sort((a,b)=>a.vencimento.localeCompare(b.vencimento));
    ps.forEach((p,i)=>out.push({ id:p.id, recebedor:`${c.nome} · parcela ${i+1}/${ps.length}`, valor:p.valor, vencimento:p.vencimento, tipo:'contrato' })); });
  return out;
}
function resumoContratos(contratos){
  const hoje = hojeISO(), mes = hoje.slice(0,7);
  const lista = (contratos||[]).map((c,k)=>{
    const ps = c.parcelas.slice().sort((a,b)=>a.vencimento.localeCompare(b.vencimento));
    const fut = ps.filter(p=>p.vencimento>=hoje);
    const pagasL = ps.filter(p=>p.vencimento<hoje);
    return { nome:c.nome, cor:CTR_CORES[k%CTR_CORES.length], total:ps.length, faltam:fut.length, pagas:pagasL.length,
      saldo:fut.reduce((t,p)=>t+p.valor,0), pago:pagasL.reduce((t,p)=>t+p.valor,0),
      inicio:ps[0]||null, prox:fut[0]||null, ultima:ps[ps.length-1]||null,
      doMes:ps.filter(p=>p.vencimento.startsWith(mes)).reduce((t,p)=>t+p.valor,0), fut };
  });
  return { lista, hoje, mes };
}
function contratosHTML(contratos){
  const { lista, mes } = resumoContratos(contratos);
  const ativos = lista.filter(c=>c.faltam>0);
  const saldo = ativos.reduce((t,c)=>t+c.saldo,0);
  const doMes = lista.reduce((t,c)=>t+c.doMes,0);
  const fim = ativos.map(c=>c.ultima.vencimento).sort().pop();
  const prox = ativos.map(c=>c.prox).sort((a,b)=>a.vencimento.localeCompare(b.vencimento))[0];
  const pago = lista.reduce((t,c)=>t+c.pago,0), nPagas = lista.reduce((t,c)=>t+c.pagas,0);
  const pctPago = pago+saldo>0 ? Math.round(pago/(pago+saldo)*100) : 0;
  const kpis = [
    ['Já pago', brl(pago), nPagas? `${nPagas} parcela(s) · ${pctPago}% do total dos contratos` : 'nenhuma parcela paga ainda', C.pos],
    ['Falta pagar', brl(saldo), fim? `${ativos.reduce((t,c)=>t+c.faltam,0)} parcela(s) · tudo quitado em ${nomeMes(fim.slice(0,7))}` : 'sem parcelas futuras', C.roxo],
    [`Parcelas de ${MESES_LONGO[+mes.slice(5)-1]}`, brl(doMes), 'soma das parcelas que vencem neste mês', C.aberto],
    ['Próxima parcela', prox? dataCurta(prox.vencimento) : '—', prox? brl(prox.valor) : 'nenhuma a vencer', C.azul],
  ];
  const linhas = lista.map(c=>`<tr><td><span class="bolinha" style="background:${c.cor}"></span>${esc(c.nome)}</td>
      <td>${c.prox? dataCurta(c.prox.vencimento)+'<small class="sub2">'+brl(c.prox.valor)+'</small>' : '<span class="ok">quitado</span>'}</td>
      <td>${c.inicio? MESES[+c.inicio.vencimento.slice(5,7)-1]+'/'+c.inicio.vencimento.slice(2,4)+'<small class="sub2">até '+MESES[+c.ultima.vencimento.slice(5,7)-1]+'/'+c.ultima.vencimento.slice(2,4)+'</small>' : '—'}</td>
      <td>${c.pagas} de ${c.total}<div class="mini"><i style="width:${c.total? (c.pagas/c.total*100).toFixed(1):0}%;background:${c.cor}"></i></div></td>
      <td class="t">${brl(c.pago,0)}</td><td class="t">${brl(c.saldo,0)}</td></tr>`).join('');
  return `<section class="page ctr-page">${header('Contratos e parcelas', 'Quanto já foi pago e previsão das parcelas a pagar · atualiza sozinha conforme as datas passam')}
    <div class="grid g4">${kpis.map(([l,v,d,c])=>`<div class="kpi big" style="--c:${c}"><div class="l">${l}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join('')}</div>
    <div class="grid g2b fill">
      <div class="card"><h3>Previsão de pagamentos</h3><div class="sub">Barras: parcelas de cada mês, por contrato · linha: quanto ainda falta pagar</div><div class="cv"><canvas id="c_ctr"></canvas></div></div>
      <div class="card"><h3>Situação de cada contrato</h3><div class="sub">início, fim, quanto já foi pago e quanto falta</div>
        <div class="ptab"><table><tr><th>Contrato</th><th>Próxima</th><th>Período</th><th>Pagas</th><th>Já pago</th><th>Falta</th></tr>${linhas || '<tr><td colspan="6">Nenhum contrato cadastrado.</td></tr>'}</table></div></div>
    </div>
    ${footer(0, 0, `Contratos · ${esc(EMP_NOME)}`)}</section>`;
}
function anexarContratos(contratos){
  CTR_CHARTS.forEach(c=>c.destroy()); CTR_CHARTS=[];
  if(!REPORT_EL) return;
  const velho = REPORT_EL.querySelector('.ctr-page');
  if(!contratos){ if(velho) velho.remove(); renumerarPaginas(); return; }
  const div = document.createElement('div'); div.innerHTML = contratosHTML(contratos);
  const novo = div.firstElementChild;
  if(velho){ if(velho.classList.contains('tv-cur')) novo.classList.add('tv-cur'); velho.replaceWith(novo); }
  else { const cal = REPORT_EL.querySelector('.cal-page'); cal ? cal.before(novo) : REPORT_EL.append(novo); }
  renumerarPaginas();
  if(typeof Chart==='undefined') return;
  // previsão mês a mês, do mês atual até a última parcela (até 36 meses)
  const { lista, mes } = resumoContratos(contratos);
  const ultimo = lista.flatMap(c=>c.fut.map(p=>p.vencimento.slice(0,7))).sort().pop();
  if(!ultimo) return;
  const meses=[]; for(let x=mes; x<=ultimo && meses.length<36; x=mesMais(x,1)) meses.push(x);
  const rot = meses.map(x=>MESES[+x.slice(5)-1]+'/'+x.slice(2,4));
  const ds = lista.filter(c=>c.faltam>0).map(c=>({ type:'bar', label:c.nome, stack:'p', backgroundColor:c.cor, order:1,
    data: meses.map(x=>c.fut.filter(p=>p.vencimento.startsWith(x)).reduce((t,p)=>t+p.valor,0)) }));
  const tot = meses.map((_,i)=>ds.reduce((t,d)=>t+d.data[i],0));
  const totalFut = lista.reduce((t,c)=>t+c.saldo,0);
  let acc=0; const saldo = tot.map(v=>{ acc+=v; return Math.max(totalFut-acc,0); });
  CTR_CHARTS.push(new Chart(novo.querySelector('#c_ctr'), { data:{ labels:rot, datasets:[
      { type:'line', label:'Falta pagar depois do mês', data:saldo, yAxisID:'y2', borderColor:C.navy, backgroundColor:C.navy, pointBackgroundColor:'#fff', pointBorderWidth:2, tension:.25, order:0 },
      ...ds ]},
    options:{ maintainAspectRatio:false, animation:false, plugins:{ legend:{position:'bottom'}, tooltip:{ callbacks:{ label:it=>`${it.dataset.label}: ${brl(it.parsed.y)}` } } },
      scales:{ x:{stacked:true, grid:{display:false}}, y:{stacked:true, beginAtZero:true, ticks:{callback:v=>kfmt(v)}, title:{display:true,text:'parcelas no mês'}},
               y2:{position:'right', beginAtZero:true, grid:{display:false}, ticks:{callback:v=>kfmt(v)}, title:{display:true,text:'falta pagar'}} } } }));
}

/* =====================================================================
   8. BARRA LATERAL (consultor e cliente)
   ===================================================================== */
const IC = (d, extra='') => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
const ICON = {
  side:  IC('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>'),
  home:  IC('<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/>'),
  plus:  IC('<path d="M12 5v14M5 12h14"/>'),
  search:IC('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
  upload:IC('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>'),
  cal:   IC('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  doc:   IC('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'),
  link:  IC('<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>'),
  chart: IC('<path d="M4 20V4M4 20h16"/><path d="m7 15 4-4 3 3 5-6"/>'),
  bars:  IC('<path d="M4 20h16"/><rect x="5.5" y="11" width="3" height="7" rx=".8"/><rect x="10.5" y="6" width="3" height="12" rx=".8"/><rect x="15.5" y="13" width="3" height="5" rx=".8"/>'),
  table: IC('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10"/>'),
  pie:   IC('<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>'),
  bank:  IC('<path d="M3 9.5 12 4l9 5.5"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3.5 20h17"/>'),
  coin:  IC('<ellipse cx="12" cy="7" rx="7" ry="3"/><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7"/><path d="M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/>'),
  users: IC('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.3 2.4 3.6 5.2"/>'),
  sign:  IC('<path d="M4 20h16"/><path d="M14.5 4.5 19 9 9 19H4.5v-4.5z"/>'),
  spark: IC('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>'),
  tv:    IC('<rect x="3" y="5" width="18" height="12.5" rx="2.5"/><path d="M8.5 21h7"/>'),
  pdf:   IC('<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19.5h14"/>'),
  out:   IC('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 8l-4 4 4 4M6 12h10"/>'),
  alert: IC('<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4M12 17v.5"/>'),
  check: IC('<path d="m5 12.5 4.5 4.5L19 7"/>'),
};
// ícone de cada página do painel, pelo título
function iconeDaPagina(t){
  const n = norm(t);
  if(/sem investimentos/.test(n)) return ICON.spark;
  if(/desempenho/.test(n)) return ICON.chart;
  if(/dre|demonstrativo/.test(n)) return ICON.table;
  if(/carteira|saidas/.test(n)) return ICON.pie;
  if(/caixa|banco/.test(n)) return ICON.bank;
  if(/aplica/.test(n)) return ICON.coin;
  if(/repasse|fornecedor/.test(n)) return ICON.upload;
  if(/posicao|clientes/.test(n)) return ICON.users;
  if(/contrato/.test(n)) return ICON.sign;
  if(/contas a pagar|calend/.test(n)) return ICON.cal;
  return ICON.bars;
}
// índice das páginas do painel na barra lateral, com destaque da página visível
let IDX_OBS = null, IDX_NAV = null;
function montarIndice(nav){
  IDX_NAV = nav || IDX_NAV; if(!IDX_NAV || !REPORT_EL) return;
  const ps = [...REPORT_EL.querySelectorAll('.page')];
  if(IDX_OBS) IDX_OBS.disconnect();
  IDX_NAV.innerHTML = ps.length ? '' : '<div class="sbvazio">As páginas aparecem aqui quando houver dados.</div>';
  ps.forEach((p,i)=>{
    p.id = p.id || 'pg-'+i;
    const h = p.querySelector('.ttl h1'); let t = h ? h.textContent.replace(/\s+—.*$/,'') : 'Página '+(i+1);
    if(/^evolucao financeira$/.test(norm(t))) t = 'Resumo do período';
    const a = document.createElement('a'); a.className='sbi'; a.href='#'+p.id; a.dataset.alvo=p.id;
    a.innerHTML = `${iconeDaPagina(t)}<span>${esc(t)}</span>`;
    a.onclick = ev => { ev.preventDefault(); p.scrollIntoView({behavior:'smooth', block:'start'}); fecharLateralMobile(); };
    IDX_NAV.append(a);
  });
  if(!ps.length || typeof IntersectionObserver==='undefined') return;
  IDX_OBS = new IntersectionObserver(ents=>{
    ents.forEach(e=>{ if(e.isIntersecting) IDX_NAV.querySelectorAll('.sbi').forEach(a=>a.classList.toggle('on', a.dataset.alvo===e.target.id)); });
  }, { rootMargin:'-35% 0px -60% 0px' });
  ps.forEach(p=>IDX_OBS.observe(p));
}
// refaz o índice sempre que as páginas do painel mudam
let idxT = null;
function vigiarPaginas(nav){
  IDX_NAV = nav;
  new MutationObserver(()=>{ clearTimeout(idxT); idxT=setTimeout(()=>montarIndice(), 60); }).observe(REPORT_EL, { childList:true });
}
// abrir/fechar: no computador esconde a barra; no celular abre por cima
const LS_SIDE = 'painel.lateral';
function alternarLateral(){
  if(matchMedia('(max-width: 900px)').matches){ document.body.classList.toggle('side-open'); return; }
  const off = document.body.classList.toggle('side-off');
  try{ localStorage.setItem(LS_SIDE, off ? '0' : '1'); }catch(e){}
}
function fecharLateralMobile(){ document.body.classList.remove('side-open'); }
function prepararLateral(){
  try{ if(localStorage.getItem(LS_SIDE)==='0') document.body.classList.add('side-off'); }catch(e){}
  document.querySelectorAll('[data-ic]').forEach(el=>{ const i=ICON[el.dataset.ic]; if(i) el.insertAdjacentHTML('afterbegin', i); });
  const b = $('bSide'); if(b) b.onclick = alternarLateral;
  const v = $('sideVeu'); if(v) v.onclick = fecharLateralMobile;
}

/* =====================================================================
   9. REPASSES A FORNECEDORES (ex.: brechó que paga quem consignou as peças)
   Prazo contado em dias úteis a partir da data da solicitação.
   ===================================================================== */
// feriados em que banco não abre: nacionais, bancários (carnaval, sexta-feira santa, Corpus Christi) e da cidade de São Paulo
const FERIADOS = {};
function feriados(ano){
  if(FERIADOS[ano]) return FERIADOS[ano];
  const a=ano%19, b=Math.floor(ano/100), c=ano%100, d=Math.floor(b/4), e=b%4, f=Math.floor((b+8)/25), g=Math.floor((b-f+1)/3),
    h=(19*a+b-d-g+15)%30, i=Math.floor(c/4), k=c%4, l=(32+2*e+2*i-h-k)%7, m=Math.floor((a+11*h+22*l)/451),
    mes=Math.floor((h+l-7*m+114)/31), dia=((h+l-7*m+114)%31)+1;
  const pascoa = Date.UTC(ano, mes-1, dia), rel = n => new Date(pascoa + n*864e5).toISOString().slice(0,10);
  const fixos = ['01-01','01-25','04-21','05-01','07-09','09-07','10-12','11-02','11-15','11-20','12-25'];
  return FERIADOS[ano] = new Set([...fixos.map(x=>ano+'-'+x), rel(-48), rel(-47), rel(-2), rel(60)]);
}
const diaUtil = iso => { const w=new Date(iso+'T12:00:00Z').getUTCDay(); return w!==0 && w!==6 && !feriados(+iso.slice(0,4)).has(iso); };
const somaDia = (iso, n) => new Date(Date.parse(iso+'T12:00:00Z') + n*864e5).toISOString().slice(0,10);
function somaDiasUteis(iso, n){ let d=iso, k=0; while(k<n){ d=somaDia(d,1); if(diaUtil(d)) k++; } return d; }
function diasUteisEntre(a, b){ if(b<a) return -diasUteisEntre(b,a); let n=0, d=a; while(d<b){ d=somaDia(d,1); if(diaUtil(d)) n++; } return n; }

// lê a planilha de controle de repasses (qualquer aba com colunas "Valor" e "Data Solicitado")
function lerPlanilhaRepasses(wb){
  const iso = d => d.toISOString().slice(0,10);
  const serial = n => iso(new Date(Date.UTC(1899,11,30) + Math.round(n)*864e5));
  const valor = v => { if(typeof v==='number') return v; let t=String(v??'').replace(/[R$\s]/g,''); if(!t) return NaN;
    if(t.includes(',') && t.includes('.')) t = t.lastIndexOf(',')>t.lastIndexOf('.') ? t.replace(/\./g,'').replace(',','.') : t.replace(/,/g,'');
    else if(t.includes(',')) t=t.replace(',','.'); else if(/^\d{1,3}(\.\d{3})+$/.test(t)) t=t.replace(/\./g,'');
    return Number(t); };
  const dataDe = (v, ref) => {
    if(v==null || v==='') return null;
    if(typeof v==='number') return v>20000 && v<80000 ? serial(v) : null;
    if(v instanceof Date && !isNaN(v)) return iso(new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())));
    const m = String(v).match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/); if(!m) return null;
    const dd=+m[1], mm=+m[2]; if(dd<1||dd>31||mm<1||mm>12) return null;
    let y = m[3] ? (+m[3]<100 ? 2000+ +m[3] : +m[3]) : (ref ? +ref.slice(0,4) : new Date().getFullYear());
    let r = `${y}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
    if(!m[3] && ref && r<ref) r = (y+1)+r.slice(4);          // "05/01" pago depois de uma solicitação de dezembro
    const t = new Date(r+'T12:00:00Z'); return isNaN(t) || t.toISOString().slice(0,10)!==r ? null : r;
  };
  for(const nome of wb.SheetNames){
    const g = XLSX.utils.sheet_to_json(wb.Sheets[nome], {header:1, raw:true, defval:null, blankrows:false});
    for(let h=0; h<Math.min(g.length,15); h++){
      const H = (g[h]||[]).map(norm);
      const col = (...ks) => { for(const k of ks){ const i=H.findIndex(x=>typeof k==='string' ? x===k : k.test(x)); if(i>=0) return i; } return -1; };
      const cV = col('valor','valor repasse','valor do repasse'), cS = col('data solicitado','data solicitacao','data da solicitacao','solicitado','solicitacao',/solicit/);
      if(cV<0 || cS<0) continue;
      const cSt = col('status','situacao'), cOk = col('repasse','pago','repasse feito','feito');
      const cP = col('data','data pagamento','data do pagamento','pago em','data repasse','data do repasse');
      const cB = col('banco','banco pagador','pago pelo banco'), cC = col('bb','origem','conta pagadora','loja','canal','empresa');
      let cF = col('fornecedor','nome','favorecido','beneficiario','cliente','consignante');
      if(cF<0){ const i0 = H.findIndex(x=>x==='#'||x==='n'||x==='id'); cF = i0>=0 && !H[i0+1] ? i0+1 : 1; }
      const itens=[]; let ignoradas=0;
      for(let r=h+1; r<g.length; r++){
        const row=g[r]||[]; const v=valor(row[cV]); const s=dataDe(row[cS]);
        if(isNaN(v) || !s){ if(row.some(x=>x!=null && x!=='')) ignoradas++; continue; }
        const st = norm(cSt>=0 ? row[cSt] : '');
        const ok = /^(ok|sim|pago|feito|s)$/.test(norm(cOk>=0 ? row[cOk] : '')) || /complet|pago|conclu/.test(st);
        const b = cB>=0 && row[cB] ? String(row[cB]).trim() : '';
        const bn = /^ita/.test(norm(b)) ? 'Itaú' : /^inter/.test(norm(b)) ? 'Inter' : b;
        itens.push({ f:String(row[cF]??'').trim(), v, s, p: cP>=0 ? dataDe(row[cP], s) : null, ok, x:/cancel/.test(st),
          b: bn || null, c: cC>=0 && row[cC]!=null ? String(row[cC]).trim() || null : null });
      }
      if(itens.length) return { aba:nome, itens, ignoradas };
    }
  }
  throw new Error('Não achei a lista de repasses: a planilha precisa de colunas "Valor" e "Data Solicitado".');
}

function resumoRepasses(rep){
  const hoje = hojeISO(), prazo = rep && rep.prazo || 10;
  const itens = (rep && rep.itens || []).filter(i=>!i.x);
  const pend = itens.filter(i=>!i.ok).map(i=>{ const vence = somaDiasUteis(i.s, prazo);
    return { ...i, vence, atraso: vence<hoje, dias: diasUteisEntre(hoje, vence), antigo: Date.parse(hoje)-Date.parse(i.s) > 60*864e5 }; })
    .sort((a,b)=>a.vence.localeCompare(b.vence) || b.v-a.v);
  const ini90 = somaDia(hoje,-90);
  const pagos90 = itens.filter(i=>i.ok && i.p && i.s && i.p>=ini90 && i.p>=i.s).map(i=>diasUteisEntre(i.s, i.p));
  const media = pagos90.length ? pagos90.reduce((t,x)=>t+x,0)/pagos90.length : null;
  const noPrazo = pagos90.length ? pagos90.filter(x=>x<=prazo).length/pagos90.length : null;
  // pedidos de mais de 60 dias sem "OK" quase sempre já foram pagos e só não foram marcados: ficam à parte, para conferir
  const ativos = pend.filter(i=>!i.antigo), antigos = pend.filter(i=>i.antigo);
  return { hoje, prazo, itens, pend: ativos, antigos, media, noPrazo, nPagos90: pagos90.length };
}
const dataRep = iso => iso.slice(0,4)===hojeISO().slice(0,4) ? dataCurta(iso) : dataCurta(iso)+'/'+iso.slice(2,4);

let REP_CHARTS = [];
function repassesHTML(rep){
  const R = resumoRepasses(rep), soma = l => l.reduce((t,i)=>t+i.v,0);
  const atr = R.pend.filter(i=>i.atraso), antigos = R.antigos;
  const sem7 = somaDia(R.hoje, 7), prox = R.pend.filter(i=>!i.atraso && i.vence<=sem7);
  const kpis = [
    ['A pagar', brl(soma(R.pend)), `${R.pend.length} repasse(s) solicitados e ainda não pagos`, C.roxo],
    ['Atrasados', `<span class="${atr.length?'neg':''}">${brl(soma(atr))}</span>`, atr.length ? `${atr.length} passaram de ${R.prazo} dias úteis` : 'nenhum fora do prazo', C.vencido],
    ['Vencem em 7 dias', brl(soma(prox)), prox.length ? `${prox.length} repasse(s) até ${dataCurta(sem7)}` : 'nada vence nesta semana', C.aberto],
    ['Prazo real de pagamento', R.media==null ? '—' : `${R.media.toLocaleString('pt-BR',{maximumFractionDigits:1})} dias úteis`, R.media==null ? 'sem pagamentos nos últimos 90 dias' : `${pct(R.noPrazo,0)} pagos em até ${R.prazo} dias úteis (últimos 90 dias)`, C.pos],
  ];
  const sit = i => i.atraso ? `<span class="neg">${-i.dias} dia(s) útil(eis) de atraso</span>` : i.dias===0 ? '<b>vence hoje</b>' : `faltam ${i.dias} dia(s) útil(eis)`;
  const MAX = 9, lst = R.pend.slice(0, MAX);
  const linhas = lst.map(i=>`<tr><td>${esc(i.f||'—')}${i.b?`<small class="sub2">${esc(i.b)}${i.c?' · '+esc(i.c):''}</small>`:''}</td><td>${dataRep(i.s)}</td><td>${dataRep(i.vence)}</td><td>${sit(i)}</td><td class="t">${brl(i.v)}</td></tr>`).join('');
  const atualizado = rep && rep.em ? ` · planilha de ${new Date(rep.em).toLocaleDateString('pt-BR')}` : '';
  return `<section class="page rep-page">${header('Repasses a fornecedores', `Pagos em até ${R.prazo} dias úteis após a solicitação${atualizado}`)}
    <div class="grid g4">${kpis.map(([l,v,d,c])=>`<div class="kpi big" style="--c:${c}"><div class="l">${l}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join('')}</div>
    <div class="grid g2 fill">
      <div class="card"><h3>Repasses por mês</h3><div class="sub">últimos 12 meses · solicitado (pela data do pedido) × pago (pela data do pagamento)</div><div class="cv"><canvas id="c_repmes"></canvas></div></div>
      <div class="card"><h3>Previsão de pagamentos</h3><div class="sub">repasses em aberto pelo dia em que vencem${atr.length?' · atrasados em vermelho':''}</div><div class="cv"><canvas id="c_repprev"></canvas></div></div>
    </div>
    <div class="card"><h3>Próximos repasses</h3><div class="sub">${R.pend.length ? `os ${lst.length} que vencem primeiro${R.pend.length>MAX?` (de ${R.pend.length})`:''}` : 'nenhum repasse em aberto'}</div>
      ${R.pend.length ? `<div class="ptab"><table><tr><th>Fornecedor</th><th>Solicitado</th><th>Pagar até</th><th>Situação</th><th>Valor</th></tr>${linhas}</table></div>` : '<div class="nodata">Nenhum repasse em aberto.</div>'}</div>
    ${antigos.length ? `<div class="note" style="--c:${C.aberto}"><b>${antigos.length} pedido(s) antigo(s) sem "OK" na planilha</b> (${brl(soma(antigos))}), solicitados há mais de 60 dias: ${antigos.slice(0,5).map(i=>`${esc(i.f||'—')} (${dataRep(i.s)})`).join(', ')}${antigos.length>5?' e outros':''}. Provavelmente já foram pagos; confira e marque na planilha. Eles não entram nos totais acima.</div>` : ''}
    ${footer(0, 0, `Repasses · ${esc(EMP_NOME)}`)}</section>`;
}
function anexarRepasses(rep){
  REP_CHARTS.forEach(c=>c.destroy()); REP_CHARTS=[];
  if(!REPORT_EL) return;
  const velho = REPORT_EL.querySelector('.rep-page');
  if(!rep){ if(velho) velho.remove(); renumerarPaginas(); return; }
  const div = document.createElement('div'); div.innerHTML = repassesHTML(rep);
  const novo = div.firstElementChild;
  if(velho){ if(velho.classList.contains('tv-cur')) novo.classList.add('tv-cur'); velho.replaceWith(novo); }
  else { const ref = REPORT_EL.querySelector('.ctr-page') || REPORT_EL.querySelector('.cal-page'); ref ? ref.before(novo) : REPORT_EL.append(novo); }
  renumerarPaginas();
  if(typeof Chart==='undefined') return;
  const R = resumoRepasses(rep), mesH = R.hoje.slice(0,7);
  const meses=[]; for(let x=mesMais(mesH,-11); x<=mesH; x=mesMais(x,1)) meses.push(x);
  const rot = meses.map(x=>MESES[+x.slice(5)-1]+'/'+x.slice(2,4));
  const sol = meses.map(x=>R.itens.filter(i=>i.s.startsWith(x)).reduce((t,i)=>t+i.v,0));
  const pag = meses.map(x=>R.itens.filter(i=>i.ok && i.p && i.p.startsWith(x)).reduce((t,i)=>t+i.v,0));
  const qtd = meses.map(x=>R.itens.filter(i=>i.s.startsWith(x)).length);
  const kf = v => (v/1000).toLocaleString('pt-BR',{maximumFractionDigits:0})+'k';
  REP_CHARTS.push(new Chart(novo.querySelector('#c_repmes'), { type:'bar', data:{ labels:rot, datasets:[
      { label:'Solicitado', data:sol, backgroundColor:C.roxo }, { label:'Pago', data:pag, backgroundColor:C.pos } ]},
    options:{ maintainAspectRatio:false, animation:false, plugins:{ legend:{position:'bottom'}, tooltip:{ callbacks:{ label:it=>`${it.dataset.label}: ${brl(it.parsed.y)}`, afterBody:it=>`${qtd[it[0].dataIndex]} pedido(s) no mês` } } },
      scales:{ x:{grid:{display:false}}, y:{beginAtZero:true, ticks:{callback:kf}} } } }));
  // previsão: atrasados numa barra só + próximos dias úteis
  const dias=[]; for(let d=R.hoje; dias.length<12; d=somaDia(d,1)) if(diaUtil(d)) dias.push(d);
  const atr = R.pend.filter(i=>i.atraso);
  const lbl = (atr.length?['Atrasados']:[]).concat(dias.map(dataCurta));
  const val = (atr.length?[atr.reduce((t,i)=>t+i.v,0)]:[]).concat(dias.map(d=>R.pend.filter(i=>i.vence===d).reduce((t,i)=>t+i.v,0)));
  REP_CHARTS.push(new Chart(novo.querySelector('#c_repprev'), { type:'bar', data:{ labels:lbl, datasets:[
      { label:'A pagar', data:val, backgroundColor: lbl.map(l=>l==='Atrasados'?C.vencido:C.aberto) } ]},
    options:{ maintainAspectRatio:false, animation:false, plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:it=>brl(it.parsed.y) } } },
      scales:{ x:{grid:{display:false}}, y:{beginAtZero:true, ticks:{callback:kf}} } } }));
}
// repasses em aberto viram um item por dia no calendário de contas a pagar
function repassesNoCalendario(rep, mes){
  if(!rep || !mes) return [];
  const por = {};
  for(const i of resumoRepasses(rep).pend){ if(!i.vence.startsWith(mes)) continue; (por[i.vence] = por[i.vence] || []).push(i); }
  return Object.entries(por).map(([d,l])=>({ id:'rep-'+d, recebedor:`Repasses a fornecedores (${l.length})`, valor:l.reduce((t,i)=>t+i.v,0), vencimento:d, tipo:'repasse' }));
}
