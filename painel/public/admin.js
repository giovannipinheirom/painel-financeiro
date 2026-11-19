/* Página do consultor: login, empresas, envio de planilha, histórico e link do cliente. */
REPORT_EL = $('report');
const CORES = ['#1F3A5F','#2F6DB5','#2E9E5B','#6A3FA0','#D9661F','#B5487A','#0F7C86','#7A6500'];
const st = { empresas:[], emp:null, rels:[], relId:null, model:null, mode:'mensal', m:null, rendered:null, cache:new Map(), seq:0 };

/* ---------- API ---------- */
async function api(path, { method='GET', body } = {}){
  let r;
  try{
    r = await fetch('/api/'+path, { method, credentials:'same-origin',
      headers: body ? {'Content-Type':'application/json'} : {}, body: body ? JSON.stringify(body) : undefined });
  }catch(e){ throw new Error('Sem conexão com o servidor. Confira sua internet.'); }
  let data = null; try{ data = await r.json(); }catch(e){}
  if(r.status===401 && path!=='login'){ mostrarLogin(); const e=new Error('login'); e.silent=true; throw e; }
  if(!r.ok) throw new Error((data && data.erro) || ('Erro '+r.status));
  return data;
}
const falha = e => { if(!e.silent){ console.error(e); toast(e.message); } };

/* ---------- utilidades ---------- */
const iniciais = n => String(n||'?').trim().split(/\s+/).filter(w=>w.length>2||/^[A-Z]/.test(w)).slice(0,2).map(w=>w[0]).join('').toUpperCase() || String(n||'?')[0].toUpperCase();
const corDe = e => CORES.includes(e && e.cor) ? e.cor : CORES[0];
function setStatus(t, s){ const el=$('status'); if(t==null){ el.hidden=true; return; } el.hidden=false; el.innerHTML=''; const b=document.createElement('b'); b.textContent=t; el.append(b, document.createTextNode(s||'')); }
function showErr(msg){ $('err').textContent=msg||''; $('err').hidden=!msg; }
function show(v){ $('vLogin').hidden=v!=='login'; $('v-home').hidden=v!=='home'; $('v-emp').hidden=v!=='emp'; if(v) setStatus(null); }
function confirmar(title, text, ok='Excluir'){
  return new Promise(res=>{
    $('cT').textContent=title; $('cS').textContent=text; $('cYes').textContent=ok; $('mConf').hidden=false;
    const done=v=>{ $('mConf').hidden=true; $('cYes').onclick=$('cNo').onclick=null; res(v); };
    $('cYes').onclick=()=>done(true); $('cNo').onclick=()=>done(false);
  });
}

/* ---------- login ---------- */
function mostrarLogin(){ $('bSair').hidden=true; show('login'); setTimeout(()=>$('iSenha').focus(),50); }
$('vLogin').onsubmit = async ev => {
  ev.preventDefault(); $('loginMsg').textContent=''; $('bEntrar').disabled=true;
  try{ await api('login',{method:'POST', body:{senha:$('iSenha').value}}); $('iSenha').value=''; iniciar(); }
  catch(e){ $('loginMsg').textContent=e.message; }
  $('bEntrar').disabled=false;
};
$('bSair').onclick = async () => { try{ await api('login',{method:'DELETE'}); }catch(e){} location.hash=''; mostrarLogin(); };

(async function(){
  if(!libsOk()) showErr('Não consegui carregar as bibliotecas de planilha/gráfico. Recarregue a página.');
  try{ const r=await api('login'); if(r.admin) iniciar(); else mostrarLogin(); }
  catch(e){ setStatus('Não consegui conectar', ' '+e.message); }
})();
let iniciado=false;
function iniciar(){
  $('bSair').hidden=false;
  if(!iniciado){ window.addEventListener('hashchange', rotear); iniciado=true; }
  rotear();
}
function rotear(){
  const h=location.hash.slice(1);
  if(/^e-[a-z0-9]+$/.test(h)) return abrirEmpresa(h.slice(2));
  fecharEmpresa(); show('home'); carregarEmpresas();
}

/* ---------- lista de empresas ---------- */
async function carregarEmpresas(){
  if(!st.empresas.length) $('cards').innerHTML='<div class="nodata">Carregando empresas…</div>';
  try{ st.empresas = await api('empresas'); desenharCards(); }
  catch(e){ falha(e); if(!e.silent) $('cards').innerHTML='<div class="nodata">Não consegui carregar as empresas. Recarregue a página.</div>'; }
}
function desenharCards(){
  const box=$('cards'); box.innerHTML='';
  for(const e of st.empresas){
    const u=e.ultimo, cor=corDe(e);
    const el=document.createElement('a'); el.className='ecard'; el.href='#e-'+e.id; el.style.setProperty('--c',cor);
    el.innerHTML = `<div class="t"><div class="av" style="--c:${cor}">${esc(iniciais(e.nome))}</div><div style="min-width:0"><h2>${esc(e.nome)}</h2><div class="meta">${esc([e.cnpj,e.contato].filter(Boolean).join(' · ')||'—')}</div></div></div>`
      + (u && typeof u.rb==='number'
        ? `<div class="mk"><div><span>Receita · ${MESES[(u.mes||1)-1]}</span><b>${curto(u.rb)}</b></div><div><span>Resultado · ${MESES[(u.mes||1)-1]}</span><b class="${u.rl<0?'neg':''}">${curto(u.rl)}</b></div></div>`
        : `<div class="nodata">Nenhuma planilha enviada ainda</div>`)
      + `<div class="ft"><span>${u?'Atualizado em '+diaBR(u.enviadoEm):'Cadastrada em '+diaBR(e.criadoEm)}</span><span class="go">Abrir →</span></div>`;
    box.append(el);
  }
  const add=document.createElement('button'); add.className='addcard'; add.innerHTML='<div><i>+</i>Cadastrar empresa</div>'; add.onclick=()=>abrirForm(null);
  box.append(add);
}

/* ---------- formulário de empresa ---------- */
let editId=null, corSel=CORES[0];
function abrirForm(emp){
  editId = emp? emp.id : null;
  $('mEmpT').textContent = emp? 'Editar empresa' : 'Nova empresa';
  $('iNome').value=emp?.nome||''; $('iCnpj').value=emp?.cnpj||''; $('iCont').value=emp?.contato||'';
  corSel = emp ? corDe(emp) : CORES[st.empresas.length % CORES.length];
  $('iCor').innerHTML = CORES.map(c=>`<button type="button" data-c="${c}" style="background:${c}" class="${c===corSel?'on':''}" aria-label="cor"></button>`).join('');
  $('bDelEmp').hidden=!emp; $('mEmp').hidden=false; setTimeout(()=>$('iNome').focus(),50);
}
$('iCor').onclick = e => { const b=e.target.closest('button'); if(!b) return; corSel=b.dataset.c; [...$('iCor').children].forEach(x=>x.classList.toggle('on',x===b)); };
$('iCnpj').oninput = e => { const d=e.target.value.replace(/\D/g,'').slice(0,14); e.target.value = d.length>12? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2}).*/,'$1.$2.$3/$4-$5') : d; };
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$('mEmp').hidden=true);
document.addEventListener('keydown', e=>{ if(e.key==='Escape') $('mEmp').hidden=true; });
$('bNova').onclick = () => abrirForm(null);
$('fEmp').onsubmit = async ev => {
  ev.preventDefault();
  const body={ nome:$('iNome').value.trim(), cnpj:$('iCnpj').value.trim(), contato:$('iCont').value.trim(), cor:corSel };
  if(!body.nome) return;
  $('bSave').disabled=true;
  try{
    if(editId){ st.emp = await api('empresas?id='+editId,{method:'PUT', body}); cabecalho(); toast('Empresa atualizada'); }
    else { const e = await api('empresas',{method:'POST', body}); location.hash='e-'+e.id; toast('Empresa cadastrada. Agora arraste a planilha.'); }
    $('mEmp').hidden=true;
  }catch(e){ falha(e); }
  $('bSave').disabled=false;
};
$('bDelEmp').onclick = async () => {
  const emp = st.emp && st.emp.id===editId ? st.emp : st.empresas.find(x=>x.id===editId);
  if(!emp) return;
  $('mEmp').hidden=true;
  if(!await confirmar('Excluir '+emp.nome+'?','A empresa, todas as planilhas enviadas e o link do cliente deixam de existir. Não dá para desfazer.')) return;
  try{ await api('empresas?id='+emp.id,{method:'DELETE'}); location.hash=''; toast('Empresa excluída'); }catch(e){ falha(e); }
};

/* ---------- página da empresa ---------- */
function fecharEmpresa(){
  st.seq++; Object.assign(st,{emp:null, rels:[], relId:null, model:null, rendered:null});
  charts.forEach(c=>c.destroy()); charts=[]; REPORT_EL.innerHTML=''; $('shareBox').hidden=true; showErr('');
}
async function abrirEmpresa(id){
  if(st.emp && st.emp.id===id) return;
  fecharEmpresa(); const seq=st.seq; show('emp');
  $('eNome').textContent='Carregando…'; $('eMeta').textContent=''; $('eAv').textContent=''; $('tbar').hidden=true;
  setEmpty('Carregando painel…',''); $('histList').innerHTML='<li class="none">Carregando…</li>';
  try{
    const emp = await api('empresas?id='+id); if(seq!==st.seq) return;
    st.emp=emp; cabecalho(); await carregarHistorico();
  }catch(e){
    if(seq!==st.seq || e.silent) return;
    $('eNome').textContent='Empresa não encontrada'; setEmpty('Não consegui abrir esta empresa', e.message); $('histList').innerHTML='';
  }
}
function cabecalho(){
  const e=st.emp; EMP_NOME=e.nome||'';
  $('eNome').textContent=e.nome; $('eAv').textContent=iniciais(e.nome); $('eAv').style.setProperty('--c',corDe(e));
  $('eMeta').textContent=[e.cnpj, e.contato, e.ultimo?'atualizado em '+dataBR(e.ultimo.enviadoEm):null].filter(Boolean).join(' · ');
  document.title=e.nome+' · Evolução Financeira';
  if(!$('shareBox').hidden) $('shareInput').value=linkCliente();
}
async function carregarHistorico(){
  const seq=st.seq;
  try{ const rels=await api('relatorios?empresa='+st.emp.id); if(seq!==st.seq) return; st.rels=rels; }
  catch(e){ if(!e.silent) $('histList').innerHTML='<li class="none">Não consegui carregar o histórico.</li>'; return falha(e); }
  desenharHistorico(); escolherVersao();
}
function desenharHistorico(){
  const ul=$('histList'); ul.innerHTML='';
  if(!st.rels.length) ul.innerHTML='<li class="none">Nenhum envio ainda. A primeira planilha aparece aqui.</li>';
  st.rels.forEach((r,i)=>{
    const li=document.createElement('li'); li.className=r.id===st.relId?'on':'';
    li.innerHTML=`<div class="n"><b></b><small>${esc(dataBR(r.enviadoEm))} · até ${MESES[(r.ultimo||1)-1]}/${esc(r.ano)}</small></div>${i===0?'<span class="tag">atual</span>':''}<button class="x" title="Apagar envio">×</button>`;
    li.querySelector('b').textContent=r.arquivo||'planilha';
    li.onclick=ev=>{ if(ev.target.closest('.x')) return; st.relId=r.id; desenharHistorico(); escolherVersao(); };
    li.querySelector('.x').onclick=()=>apagarEnvio(r);
    ul.append(li);
  });
}
async function escolherVersao(){
  if(!st.rels.length){
    $('tbar').hidden=true; charts.forEach(c=>c.destroy()); charts=[]; REPORT_EL.innerHTML=''; st.rendered=null;
    return setEmpty('Nenhuma planilha ainda','Arraste a planilha de conciliação no quadro acima para montar o painel.');
  }
  if(!st.relId || !st.rels.some(r=>r.id===st.relId)) st.relId=st.rels[0].id;
  desenharHistorico();
  const id=st.relId; if(st.rendered===id+'|'+EMP_NOME) return;
  const seq=st.seq;
  try{
    let rel=st.cache.get(id);
    if(!rel){ if(!st.model) setEmpty('Carregando painel…',''); rel=await api('relatorios?id='+id); st.cache.set(id,rel); }
    if(seq!==st.seq || st.relId!==id) return;
    const prevAno=st.model?.ano;
    st.model=hydrateModel(rel.modelo); const m=st.model;
    if(st.m==null || st.m>m.ultimo || prevAno!==m.ano) st.m=Math.min(m.sel||m.ultimo, m.ultimo)||m.ultimo;
    $('month').innerHTML=range(1,m.ultimo).map(i=>`<option value="${i}">${MESES[i-1]}/${m.ano}</option>`).join(''); $('month').value=st.m;
    $('fileinfo').textContent=(rel.arquivo||'')+' · enviada em '+dataBR(rel.enviadoEm); $('fileinfo').title=$('fileinfo').textContent;
    setEmpty(null); $('tbar').hidden=false; st.rendered=id+'|'+EMP_NOME; redesenhar();
  }catch(e){ if(!e.silent){ setEmpty('Não consegui abrir esta versão', e.message); $('tbar').hidden=true; } }
}
function redesenhar(){ if(st.model) render(st.model, st.mode, st.m); }
$('mode').onclick = e => { const b=e.target.closest('button'); if(!b) return; st.mode=b.dataset.m; [...$('mode').children].forEach(x=>x.classList.toggle('on',x===b)); redesenhar(); };
$('month').onchange = e => { st.m=+e.target.value; redesenhar(); };
$('bPdf').onclick = () => window.print();

async function apagarEnvio(r){
  if(!await confirmar('Apagar este envio?', `${r.arquivo||'Planilha'} enviada em ${dataBR(r.enviadoEm)} sai do histórico.`+(st.rels[0]?.id===r.id?' O envio anterior volta a ser a versão atual do cliente.':''))) return;
  try{
    await api('relatorios?id='+r.id,{method:'DELETE'}); st.cache.delete(r.id);
    if(st.relId===r.id){ st.relId=null; st.rendered=null; }
    toast('Envio apagado'); await carregarHistorico();
    st.emp = await api('empresas?id='+st.emp.id); cabecalho();
  }catch(e){ falha(e); }
}

/* ---------- link do cliente ---------- */
const linkCliente = () => location.origin+'/c/'+st.emp.token;
async function copiar(txt){ try{ await navigator.clipboard.writeText(txt); toast('Link copiado'); }catch(e){ $('shareInput').select(); toast('Selecione e copie o link'); } }
$('bShare').onclick = () => { if(!st.emp) return; $('shareInput').value=linkCliente(); $('shareBox').hidden=false; copiar(linkCliente()); };
$('bCopy2').onclick = () => copiar($('shareInput').value);
$('bEdit').onclick = () => st.emp && abrirForm(st.emp);
$('bNovoLink').onclick = async ev => {
  ev.preventDefault();
  if(!await confirmar('Gerar um link novo?','O link atual para de funcionar na hora. Você vai precisar mandar o novo para o cliente.','Gerar link novo')) return;
  try{ st.emp=await api('empresas?id='+st.emp.id,{method:'PUT', body:{novoLink:true}}); cabecalho(); $('shareInput').value=linkCliente(); copiar(linkCliente()); }catch(e){ falha(e); }
};

/* ---------- envio de planilha ---------- */
let ocupado=false;
async function enviarPlanilha(file){
  if(!st.emp || ocupado) return;
  if(!libsOk()) return showErr('As bibliotecas não carregaram. Recarregue a página.');
  showErr(''); ocupado=true; $('drop').classList.add('busy'); $('dropT').textContent='Lendo '+file.name+'…';
  try{
    if(file.size>40*1024*1024) throw new Error('Arquivo grande demais (máx. 40 MB).');
    const wb=XLSX.read(await file.arrayBuffer(), {type:'array'});
    const modelo=serializeModel(buildModel(wb));
    $('dropT').textContent='Salvando…';
    const rel=await api('relatorios',{method:'POST', body:{empresaId:st.emp.id, arquivo:file.name, modelo}});
    st.cache.set(rel.id, {...rel, modelo});
    st.relId=rel.id; st.m=null; st.rendered=null;
    await carregarHistorico();
    st.emp=await api('empresas?id='+st.emp.id); cabecalho();
    toast('Painel atualizado: '+MESES[rel.ultimo-1]+'/'+rel.ano);
  }catch(e){ if(!e.silent) showErr('Não consegui montar o painel com essa planilha.\n'+e.message); }
  ocupado=false; $('drop').classList.remove('busy'); $('dropT').textContent='Arraste a planilha nova aqui';
}
$('drop').onclick = () => $('file').click();
$('file').onchange = e => { if(e.target.files[0]) enviarPlanilha(e.target.files[0]); e.target.value=''; };
const podeSoltar = () => !$('v-emp').hidden && st.emp;
['dragover','dragenter'].forEach(ev=>document.addEventListener(ev,e=>{ e.preventDefault(); if(podeSoltar()) $('drop').classList.add('over'); }));
['dragleave','drop'].forEach(ev=>document.addEventListener(ev,e=>{ e.preventDefault(); if(ev==='drop'||!e.relatedTarget) $('drop').classList.remove('over'); }));
document.addEventListener('drop', e=>{ const f=e.dataTransfer && e.dataTransfer.files[0]; if(f && podeSoltar()) enviarPlanilha(f); });
