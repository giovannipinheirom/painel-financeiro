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
  return {series, scalar, cart};
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
    cart: base.cart,
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
  const NP = (REPORT_OPTS.posicao ? 7 : 6) + (REPORT_OPTS.extra||0);

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
    ['BB · conta', ct.bb, C.bb], ['BB · Rende Fácil', ct.rende, C.bb],
    ['Sicredi · conta', ct.sic, C.sic], ['Sicredi · aplicação', ct.aplSic, C.sic],
    ['Stone', ct.stone, C.stone], ['Cora', ct.cora, C.cora],
  ];
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
  notes.push([C.navy, `<b>Saldo total de ${curto(sT)}</b>${sTp!=null?` (${sig(sT-sTp)} vs ${vsSaldo})`:''}, ${pct(saldoTotal(P.end)? (bal(ct.rende,P.end)+bal(ct.aplSic,P.end))/sT : 0)} aplicado. Carteira com <b>${pct(colT(0)/cartAll)} recebido</b>${colT(1)?`; ${curto(colT(1))} em aberto`:''}${colT(2)?` e ${curto(colT(2))} vencidos`:''}.`]);

  let html = `<section class="page">
    ${header(`Evolução Financeira — ${P.titulo}`, `${model.ate?`Lançamentos até ${model.ate} · `:''}${mode==='mensal'?'comparativos contra o mês anterior':mode==='trimestral'?'comparativos contra o trimestre anterior':'valores acumulados no ano'}`)}
    <div><div class="sec">${P.secao} <span>· ${P.secaoSub}</span></div>
      <div class="grid g6">${kRes.map(([l,v,d,c])=>`<div class="kpi big" style="--c:${c}"><div class="l">${l}</div><div class="v">${v}</div><div class="d">${d||'&nbsp;'}</div></div>`).join('')}</div></div>
    <div><div class="sec">Conta corrente e aplicações <span>· saldo em fim de ${MESES[P.end].toLowerCase()} · total ${brl(sT)}</span></div>
      <div class="grid g6">${bancos.map(([l,arr,c])=>{ const v=bal(arr,P.end), p=bal(arr,P.prevEnd); const d=p==null?null:v-p;
        return `<div class="kpi" style="--c:${c}"><div class="l">${l}</div><div class="v">${brl(v)}</div><div class="d">${d==null?'&nbsp;':Math.round(d)===0?'<span style="color:#9AA3AF">= sem variação</span>':delta(d,vsSaldo)}</div><div class="bar"><i style="width:${Math.max(sT?v/sT*100:0,0.6)}%"></i></div></div>`;}).join('')}</div></div>
    <div><div class="sec">Carteira de clientes <span>· acumulado do ano</span></div>
      <div class="grid g3">${kC.map(([l,v,c])=>{const p=v/cartAll; return `<div class="kpi big" style="--c:${c}"><div class="l">${l}</div><div class="v">${brl(v)}</div><div class="d">${pct(p, p>0&&p<0.01?2:1)} da carteira total</div><div class="bar"><i style="width:${Math.max(p*100,0.8)}%"></i></div></div>`;}).join('')}</div></div>
    <div><div class="sec">Destaques</div><div class="hl">${notes.slice(0,4).map(([c,t])=>`<div class="note" style="--c:${c}">${t}</div>`).join('')}</div></div>
    ${footer(1,NP,footTxt)}
  </section>`;

  /* ---------- página 2 ---------- */
  const unidade = mode==='trimestral'?'por trimestre':'por mês';
  const parcialNota = P.parcial? ' · * trimestre parcial' : '';
  html += `<section class="page">${header('Desempenho', `Faturamento, receita, saídas e resultado ${unidade} · ${model.ano}${parcialNota}`)}
    <div class="grid g2 fill">
      <div class="card"><h3>Faturamento × Receita</h3><div class="sub">R$ ${unidade}</div><div class="cv"><canvas id="c_fatrec"></canvas></div></div>
      <div class="card"><h3>Resultado líquido ${mode==='trimestral'?'trimestral':'mensal'}</h3><div class="sub">Barras: resultado do período · linha: acumulado no ano</div><div class="cv"><canvas id="c_res"></canvas></div></div>
      <div class="card"><h3>Receita × Saídas</h3><div class="sub">R$ ${unidade}</div><div class="cv"><canvas id="c_recsai"></canvas></div></div>
      <div class="card"><h3>Evolução de caixa</h3><div class="sub">Saldo no fim de cada ${mode==='trimestral'?'trimestre':'mês'} · em contas + aplicado</div><div class="cv"><canvas id="c_caixa"></canvas></div></div>
    </div>${footer(2,NP,footTxt)}</section>`;

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
    ${footer(3,NP,footTxt)}</section>`;

  /* ---------- página 4 ---------- */
  html += `<section class="page">${header('Carteira, saídas e despesas financeiras', `Saídas e despesas financeiras: ${P.secaoSub} · carteira: acumulado do ano`)}
    <div class="grid g2b fill">
      <div class="card"><h3>Títulos por banco</h3><div class="sub">Participação no total de títulos do ano</div><div class="cv"><canvas id="c_tit"></canvas></div></div>
      <div class="card"><h3>Saídas por categoria</h3><div class="sub">${P.secaoSub} (R$)</div><div class="cv"><canvas id="c_cat"></canvas></div></div>
      <div class="card"><h3>Posição da carteira por banco</h3><div class="sub">% recebido, em aberto e vencido</div><div class="cv"><canvas id="c_pos"></canvas></div></div>
      <div class="card"><h3>Despesas financeiras por tipo</h3><div class="sub">${P.secaoSub} · total ${brl(fin)}</div><div class="cv"><canvas id="c_fin"></canvas></div></div>
    </div>${footer(4,NP,footTxt)}</section>`;

  /* ---------- página 5 ---------- */
  html += `<section class="page">${header('Caixa por banco', `Saldos no fim de cada ${mode==='trimestral'?'trimestre':'mês'} em conta corrente e aplicações`)}
    <div class="grid g2 fill">
      <div class="card"><h3>BB — caixa (conta + Rende Fácil)</h3><div class="sub">R$</div><div class="cv"><canvas id="c_bb"></canvas></div></div>
      <div class="card"><h3>Sicredi — caixa (conta + aplicação)</h3><div class="sub">R$</div><div class="cv"><canvas id="c_sic"></canvas></div></div>
      <div class="card"><h3>BB × Sicredi — caixa total</h3><div class="sub">R$</div><div class="cv"><canvas id="c_bbsic"></canvas></div></div>
      <div class="card"><h3>Saldo em conta corrente por banco</h3><div class="sub">R$ (sem aplicações)</div><div class="cv"><canvas id="c_contas"></canvas></div></div>
    </div>${footer(5,NP,footTxt)}</section>`;

  /* ---------- página 6 ---------- */
  html += `<section class="page">${header('Aplicações financeiras', `Movimentação, rendimentos e saldos aplicados ${unidade}`)}
    <div class="grid g2 fill">
      <div class="card"><h3>Aplicações × Resgates</h3><div class="sub">Movimentação ${unidade} (R$)</div><div class="cv"><canvas id="c_apres"></canvas></div></div>
      <div class="card"><h3>Rendimento × Impostos</h3><div class="sub">R$ ${unidade} · IR + IOF</div><div class="cv"><canvas id="c_rend"></canvas></div></div>
      <div class="card"><h3>Rendimentos por banco</h3><div class="sub">R$ ${unidade}</div><div class="cv"><canvas id="c_rendbk"></canvas></div></div>
      <div class="card"><h3>Saldo das aplicações</h3><div class="sub">R$ no fim de cada ${mode==='trimestral'?'trimestre':'mês'}</div><div class="cv"><canvas id="c_apl"></canvas></div></div>
    </div>${footer(6,NP,footTxt)}</section>`;

  /* ---------- página 7: posição de clientes (opcional por empresa) ---------- */
  const bancosPos = ['BB','Cora','Stone','Sicredi'].filter(b=>model.cart[b]).concat(cartNames.filter(b=>!['BB','Cora','Stone','Sicredi'].includes(b)));
  if(REPORT_OPTS.posicao){
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
      </div>${footer(7,NP,footTxt)}</section>`;
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
  Chart.defaults.font.size = 10; Chart.defaults.color = '#6B7686';
  Chart.defaults.animation = false; Chart.defaults.devicePixelRatio = Math.max(2, window.devicePixelRatio||1); Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.plugins.legend.position = 'bottom';
  Object.assign(Chart.defaults.plugins.legend.labels,{boxWidth:10,boxHeight:10,padding:12});
  Chart.defaults.elements.bar.borderRadius = 3; Chart.defaults.elements.line.borderWidth = 2.5; Chart.defaults.elements.point.radius = 3;
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
  mk('c_tit',{type:'doughnut',data:{labels:cn,datasets:[{data:cn.map(b=>+(cartTot(b)/cartAll*100).toFixed(1)),backgroundColor:cn.map(bankColor),borderColor:'#fff',borderWidth:2}]},
    options:{cutout:'62%',plugins:{legend:{position:'right',labels:{generateLabels:ch=>cn.map((b,i)=>({text:`${b}  ${pct(cartTot(b)/cartAll)}`,fillStyle:bankColor(b),strokeStyle:bankColor(b),index:i}))}},tooltip:{enabled:false}}},
    plugins:[{id:'lbl',afterDatasetDraw(ch){const {ctx}=ch;const meta=ch.getDatasetMeta(0);ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';
      meta.data.forEach((a,i)=>{const v=ch.data.datasets[0].data[i];if(v<5)return;const p=a.tooltipPosition();ctx.font='600 11px '+Chart.defaults.font.family;ctx.fillStyle='#fff';ctx.fillText(Math.round(v)+'%',p.x,p.y);});
      const c=meta.data[0];ctx.fillStyle='#1B2433';ctx.font='700 15px '+Chart.defaults.font.family;ctx.fillText(curto(cartAll),c.x,c.y-6);ctx.font='500 9.5px '+Chart.defaults.font.family;ctx.fillStyle='#6B7686';ctx.fillText('em títulos no ano',c.x,c.y+10);ctx.restore();}}]});
  mk('c_pos',{type:'bar',data:{labels:cn,datasets:[['Recebido',C.recebido],['Em aberto',C.aberto],['Vencido',C.vencido]].map(([n,c],j)=>bar(n,cn.map(b=>model.cart[b][j]/(cartTot(b)||1)*100),c,{stack:'p'}))},
    options:{indexAxis:'y',elements:{bar:{borderRadius:0}},datasets:{bar:{maxBarThickness:20}},scales:{x:{stacked:true,max:100,grid:{color:'#EEF1F5'},border:{display:false},ticks:{callback:v=>v+'%'}},y:{stacked:true,grid:{display:false}}}}});

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

  mk('c_bb',{data:{labels:L,datasets:[line('Total BB',rende.map((v,i)=>v+endOf(ct.bb)[i]),'#7A6500',{order:0}),bar('Rende Fácil',rende,C.bb,{stack:'b',order:1}),bar('Conta BB',endOf(ct.bb),'#F3DD6B',{stack:'b',order:1})]},options:{scales:{x:{...xC,stacked:true},y:yK({stacked:true,beginAtZero:true})}}});
  mk('c_sic',{data:{labels:L,datasets:[line('Total Sicredi',aplSic.map((v,i)=>v+endOf(ct.sic)[i]),'#1D4D20',{order:0}),bar('Aplicação',aplSic,C.sic,{stack:'b',order:1}),bar('Conta Sicredi',endOf(ct.sic),C.sicL,{stack:'b',order:1})]},options:{scales:{x:{...xC,stacked:true},y:yK({stacked:true,beginAtZero:true})}}});
  mk('c_bbsic',{type:'line',data:{labels:L,datasets:[line('BB',rende.map((v,i)=>v+endOf(ct.bb)[i]),C.bb),line('Sicredi',aplSic.map((v,i)=>v+endOf(ct.sic)[i]),C.sic)]},options:{scales:{x:xC,y:yK({beginAtZero:true})}}});
  mk('c_contas',{type:'line',data:{labels:L,datasets:[line('BB',endOf(ct.bb),C.bb),line('Sicredi',endOf(ct.sic),C.sic),line('Stone',endOf(ct.stone),C.stone),line('Cora',endOf(ct.cora),C.cora)]},
    options:{scales:{x:xC,y:yK({ticks:{callback:v=>(v/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})+'k'}})}}});

  const ap=model.apl, rendBB=agg(ap.rendBB), rendSic=agg(ap.rendSic), rendBr=rendBB.map((v,i)=>v+rendSic[i]), imp=agg(ap.imp);
  mk('c_apres',{type:'bar',data:{labels:L,datasets:[bar('Aplicações',agg(ap.aplic),C.fat),bar('Resgates',agg(ap.resg),C.sai)]},options:{scales:{x:xC,y:yK({beginAtZero:true})}}});
  const plain = {grid:{color:'#EEF1F5'},border:{display:false},beginAtZero:true,ticks:{callback:v=>v.toLocaleString('pt-BR')}};
  mk('c_rend',{data:{labels:L,datasets:[line('Rendimento líquido',rendBr.map((v,i)=>v-imp[i]),C.gold,{order:0}),bar('Rendimento bruto',rendBr,C.rec,{order:1}),bar('Impostos (IR + IOF)',imp,C.neg,{order:1})]},options:{scales:{x:xC,y:plain}}});
  mk('c_rendbk',{type:'bar',data:{labels:L,datasets:[bar('Sicredi',rendSic,C.sic,{stack:'r'}),bar('BB',rendBB,C.bb,{stack:'r'})]},options:{scales:{x:{...xC,stacked:true},y:{...plain,stacked:true}}}});
  mk('c_apl',{type:'line',data:{labels:L,datasets:[line('Total aplicado',aplicado,C.navy,{borderWidth:3}),line('Aplicação Sicredi',aplSic,C.sic),line('Rende Fácil BB',rende,C.bb)]},options:{scales:{x:xC,y:yK({beginAtZero:true})}}});

  if(REPORT_OPTS.posicao && document.getElementById('c_receber')){
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
    saidasCats:m.saidasCats.map(r=>rows.indexOf(r)), finKids:m.finKids.map(r=>rows.indexOf(r)), contas:m.contas, apl:m.apl, cart:m.cart };
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
      + l.slice(0,MAXC).map(x=>`<div class="ev2" title="${esc(x.recebedor)} · ${brl(x.valor)}"><b>${esc(x.recebedor)}</b><span>${brl(x.valor)}</span></div>`).join('')
      + (l.length>MAXC?`<div class="mais">+${l.length-MAXC} conta(s) · ${curto(soma(l.slice(MAXC)))}</div>`:'') + '</div>';
  }
  const resto = (7 - (primeiro+nd)%7) % 7;
  for(let i=0;i<resto;i++) cels += '<div class="cd fora"></div>';
  const agenda = Object.keys(porDia).map(Number).sort((x,y)=>x-y).map(d=>{
    const iso = mes+'-'+String(d).padStart(2,'0'), l = porDia[d];
    return `<div class="ag ${iso<hoje?'pass':''} ${iso===hoje?'hoje':''}"><div class="agd"><b>${d}</b><span>${DIAS_SEM[new Date(a,m-1,d).getDay()]}</span></div><div class="agl">`
      + l.map(x=>`<div class="ev2"><b>${esc(x.recebedor)}</b><span>${brl(x.valor)}</span></div>`).join('') + '</div></div>';
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
  return novo;
}
