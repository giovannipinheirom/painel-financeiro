/* Página do cliente: link /c/<token> + senha. Mostra só a empresa dele e tem o modo TV. */
REPORT_EL = $('report');
const token = (location.pathname.match(/\/c\/([a-z0-9]{24})\/?$/) || [])[1];
const cs = { model:null, mode:'mensal', m:null, relId:null, cache:new Map(), dados:null, contas:null, calMes:mesAtual() };

function status(t, s){ const el=$('status'); if(t==null){ el.hidden=true; return; } el.hidden=false; el.innerHTML=''; const b=document.createElement('b'); b.textContent=t; el.append(b, document.createTextNode(s||'')); }
const iniciais = n => String(n||'?').trim().split(/\s+/).filter(w=>w.length>2||/^[A-Z]/.test(w)).slice(0,2).map(w=>w[0]).join('').toUpperCase() || '?';

async function chamar(method, url, body){
  let r, data=null;
  try{ r = await fetch(url, { method, credentials:'same-origin', headers: body?{'Content-Type':'application/json'}:{}, body: body?JSON.stringify(body):undefined }); }
  catch(e){ return { rede:true }; }
  try{ data = await r.json(); }catch(e){}
  return { ok:r.ok, status:r.status, data:data||{} };
}

async function carregar(rel, { silencioso=false } = {}){
  if(!token) return status('Link incompleto','Confira se você copiou o link inteiro que recebeu do seu consultor.');
  if(rel && cs.cache.has(rel)) return mostrar(cs.cache.get(rel));
  const r = await chamar('GET', '/api/publico?token='+token+'&mes='+cs.calMes+(rel?'&rel='+encodeURIComponent(rel):''));
  if(silencioso && !r.ok) return;          // no modo TV, uma falha momentânea não derruba a tela
  if(r.rede) return status('Sem conexão','Não consegui falar com o servidor. Confira sua internet e recarregue a página.');
  if(r.status===401 && r.data.precisaSenha) return pedirSenha(r.data.empresa);
  if(!r.ok) return status('Painel indisponível', r.data.erro || 'Tente de novo em instantes.');
  if(r.data.relatorio) cs.cache.set(r.data.relatorio.id, r.data);
  mostrar(r.data);
}

/* ---------- senha ---------- */
function pedirSenha(emp){
  sairTv(); status(null); $('v-emp').hidden=true; $('bSair').hidden=true; $('vSenha').hidden=false; document.body.classList.remove('has-side');
  $('sNome').textContent = emp && emp.nome ? emp.nome : 'Painel financeiro';
  setTimeout(()=>$('iSenha').focus(), 50);
}
$('vSenha').onsubmit = async ev => {
  ev.preventDefault(); $('sMsg').textContent=''; $('bEntrar').disabled=true;
  const r = await chamar('POST', '/api/publico', { token, senha:$('iSenha').value, mes:cs.calMes });
  $('bEntrar').disabled=false;
  if(r.rede) return $('sMsg').textContent='Sem conexão. Tente de novo.';
  if(!r.ok) return $('sMsg').textContent = r.data.erro || 'Não foi possível entrar.';
  $('iSenha').value=''; $('vSenha').hidden=true;
  if(r.data.relatorio) cs.cache.set(r.data.relatorio.id, r.data);
  mostrar(r.data);
};
$('bSair').onclick = async () => { await chamar('DELETE', '/api/publico?token='+token); cs.cache.clear(); pedirSenha({nome:EMP_NOME}); };

/* ---------- painel ---------- */
function mostrar(d){
  cs.dados=d; status(null); $('vSenha').hidden=true; $('v-emp').hidden=false; $('bSair').hidden=false; document.body.classList.add('has-side');
  $('sbNome').textContent=d.empresa.nome; $('sbAv').textContent=iniciais(d.empresa.nome); $('sbAv').style.setProperty('--c','#902884');
  $('sbMeta').textContent = d.relatorio ? 'atualizado em '+diaBR(d.relatorio.enviadoEm) : (d.empresa.cnpj||'');
  EMP_NOME = d.empresa.nome; REPORT_OPTS.posicao = d.empresa.posicao!==false;
  cs.contas = d.contas || null; if(cs.contas) cs.calMes = cs.contas.mes;
  cs.contratos = d.contratos || null;
  cs.repasses = d.repasses || null;
  REPORT_OPTS.extra = (cs.contas ? 1 : 0) + (cs.contratos ? 1 : 0) + (cs.repasses ? 1 : 0);
  $('tbar').classList.remove('so-cal');
  $('eNome').textContent=d.empresa.nome; $('eAv').textContent=iniciais(d.empresa.nome); $('eAv').style.setProperty('--c','#902884');
  document.title = d.empresa.nome+' · Evolução Financeira';
  $('ver').innerHTML = d.versoes.map((v,i)=>`<option value="${esc(v.id)}">${i===0?'Atual · ':''}${esc(diaBR(v.enviadoEm))} (até ${MESES[(v.ultimo||1)-1]})</option>`).join('');
  if(!d.relatorio){
    $('eMeta').textContent=d.empresa.cnpj||''; cs.model=null; charts.forEach(c=>c.destroy()); charts=[]; REPORT_EL.innerHTML='';
    setEmpty('O painel financeiro ainda não foi publicado','Assim que o seu consultor enviar a primeira planilha, ela aparece aqui.');
    if(cs.contas || cs.contratos || cs.repasses){ $('tbar').hidden=false; $('tbar').classList.add('so-cal'); anexarRepasses(cs.repasses); anexarContratos(cs.contratos); desenharCalendario(); } else { $('tbar').hidden=true; sairTv(); }
    return;
  }
  cs.relId=d.relatorio.id; $('ver').value=cs.relId;
  $('eMeta').textContent=[d.empresa.cnpj, 'atualizado em '+dataBR(d.relatorio.enviadoEm)].filter(Boolean).join(' · ');
  const prevAno=cs.model?.ano;
  try{ cs.model=hydrateModel(d.relatorio.modelo); }catch(e){ return setEmpty('Não consegui abrir esta versão','Escolha outra versão ou fale com o seu consultor.'); }
  const m=cs.model;
  if(cs.m==null || cs.m>m.ultimo || prevAno!==m.ano) cs.m=Math.min(m.sel||m.ultimo, m.ultimo)||m.ultimo;
  $('month').innerHTML=range(1,m.ultimo).map(i=>`<option value="${i}">${MESES[i-1]}/${m.ano}</option>`).join(''); $('month').value=cs.m;
  setEmpty(null); $('tbar').hidden=false; redesenhar();
}
function redesenhar(){
  if(cs.model){
    if(typeof Chart==='undefined') return setEmpty('Não consegui carregar os gráficos','Recarregue a página.');
    render(cs.model, cs.mode, cs.m);
  }
  anexarRepasses(cs.repasses);
  anexarContratos(cs.contratos);
  desenharCalendario();
  if(tv.on) tvMostrar(tv.i);
}
function desenharCalendario(){
  if(!cs.contas){ const v=REPORT_EL.querySelector('.cal-page'); if(v) v.remove(); return; }
  anexarCalendario(cs.contas.itens.concat(repassesNoCalendario(cs.repasses, cs.contas.mes)), cs.contas.mes);
}
async function irParaMes(mes){
  const r = await chamar('GET', '/api/publico?token='+token+'&so=contas&mes='+mes);
  if(r.status===401) return pedirSenha({nome:EMP_NOME});
  if(!r.ok || !r.data.contas) return toast(r.rede ? 'Sem conexão.' : (r.data.erro || 'Não consegui abrir este mês.'));
  cs.contas = r.data.contas; cs.calMes = r.data.contas.mes; desenharCalendario();
  if(tv.on) tvMostrar(tv.i);
}
REPORT_EL.addEventListener('click', e => {
  const b = e.target.closest('[data-cal]'); if(!b) return;
  const d = +b.dataset.cal; irParaMes(d===0 ? mesAtual() : mesMais(cs.calMes, d));
});
$('mode').onclick = e => { const b=e.target.closest('button'); if(!b) return; cs.mode=b.dataset.m; [...$('mode').children].forEach(x=>x.classList.toggle('on',x===b)); redesenhar(); };
$('month').onchange = e => { cs.m=+e.target.value; redesenhar(); };
$('ver').onchange = e => carregar(e.target.value);
$('bPdf').onclick = () => window.print();

/* =====================================================================
   MODO TV: tela cheia, passa uma página do painel a cada 15 s,
   e busca dados novos a cada 5 min (a TV pode ficar ligada o dia todo).
   ===================================================================== */
const TEMPO = 15000, ATUALIZA = 5*60*1000;
const tv = { on:false, i:0, ini:0, pausa:false, tick:null, atual:null, idle:null, lock:null, fs:false };
const paginas = () => [...REPORT_EL.querySelectorAll('.page')];

function tvEncaixar(){
  const p = REPORT_EL.querySelector('.page.tv-cur'); if(!p) return;
  p.style.transform='translate(-50%,-50%)';
  const s = Math.min(innerWidth*0.96/p.offsetWidth, (innerHeight-60)*0.95/p.offsetHeight);
  p.style.transform = `translate(-50%,-50%) scale(${s})`;
}
function tvMostrar(i){
  const ps=paginas(); if(!ps.length) return;
  tv.i=((i%ps.length)+ps.length)%ps.length;
  ps.forEach((p,k)=>{ p.classList.toggle('tv-cur', k===tv.i); if(k!==tv.i) p.style.transform=''; });
  tvEncaixar();
  const h=ps[tv.i].querySelector('h1'); $('tvTitle').textContent = (h?h.textContent:'')+' · '+EMP_NOME;
  $('tvCount').textContent = (tv.i+1)+' de '+ps.length;
  tv.ini=Date.now(); tv.decorrido=0;
}
function tvLoop(){
  if(tv.pausa){ tv.ini = Date.now() - tv.decorrido; return; }
  tv.decorrido = Date.now()-tv.ini;
  $('tvprog').style.width = Math.min(100, tv.decorrido/TEMPO*100)+'%';
  if(tv.decorrido>=TEMPO) tvMostrar(tv.i+1);
}
async function entrarTv(){
  if(cs.contas && cs.calMes!==mesAtual()) await irParaMes(mesAtual());
  if(!paginas().length) return;
  tv.on=true; tv.pausa=false; tv.decorrido=0; $('tvPause').textContent='❚❚';
  document.body.classList.add('tv');
  try{ if(document.documentElement.requestFullscreen){ await document.documentElement.requestFullscreen(); tv.fs=true; } }catch(e){ tv.fs=false; }
  try{ if(navigator.wakeLock) tv.lock = await navigator.wakeLock.request('screen'); }catch(e){}
  tvMostrar(0);
  clearInterval(tv.tick); tv.tick=setInterval(tvLoop, 100);
  clearInterval(tv.atual); tv.atual=setInterval(()=>{ cs.cache.clear(); cs.calMes=mesAtual(); carregar(null,{silencioso:true}); }, ATUALIZA);
  mexeu();
}
function sairTv(){
  if(!tv.on) return;
  tv.on=false; clearInterval(tv.tick); clearInterval(tv.atual); clearTimeout(tv.idle);
  document.body.classList.remove('tv','tv-idle');
  paginas().forEach(p=>{ p.classList.remove('tv-cur'); p.style.transform=''; });
  if(document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(()=>{});
  try{ tv.lock && tv.lock.release(); }catch(e){} tv.lock=null;
  window.dispatchEvent(new Event('resize'));
}
function mexeu(){ if(!tv.on) return; document.body.classList.remove('tv-idle'); clearTimeout(tv.idle); tv.idle=setTimeout(()=>document.body.classList.add('tv-idle'), 3000); }

$('bTv').onclick = entrarTv;
$('tvSair').onclick = sairTv;
$('tvNext').onclick = () => tvMostrar(tv.i+1);
$('tvPrev').onclick = () => tvMostrar(tv.i-1);
$('tvPause').onclick = () => { tv.pausa=!tv.pausa; $('tvPause').textContent = tv.pausa ? '▶' : '❚❚'; };
document.addEventListener('keydown', e => {
  if(!tv.on) return;
  if(e.key==='ArrowRight'){ tvMostrar(tv.i+1); mexeu(); }
  else if(e.key==='ArrowLeft'){ tvMostrar(tv.i-1); mexeu(); }
  else if(e.key===' '){ e.preventDefault(); $('tvPause').click(); mexeu(); }
  else if(e.key==='Escape') sairTv();
});
['mousemove','touchstart'].forEach(ev=>document.addEventListener(ev, mexeu, {passive:true}));
document.addEventListener('fullscreenchange', () => { if(tv.on && tv.fs && !document.fullscreenElement) sairTv(); });
document.addEventListener('visibilitychange', async () => { if(tv.on && document.visibilityState==='visible' && navigator.wakeLock){ try{ tv.lock=await navigator.wakeLock.request('screen'); }catch(e){} } });
window.addEventListener('resize', () => { if(tv.on) tvEncaixar(); });

carregar(null);

/* ---------- barra lateral ---------- */
prepararLateral();
vigiarPaginas($('sbPaginas'));
$('sbPdf').onclick = () => { fecharLateralMobile(); window.print(); };
$('sbTv').onclick = () => { fecharLateralMobile(); $('bTv').click(); };
$('sbSair').onclick = () => $('bSair').click();
