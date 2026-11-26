/* Página do consultor: login, empresas, envio de planilha, histórico e link do cliente. */
REPORT_EL = $('report');
const CORES = ['#902884','#566BAF','#3A2459','#2E9E5B','#D9661F','#B5487A','#0F7C86','#7A6500'];
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
function mostrarLogin(){ $('bSair').hidden=true; document.body.classList.remove('has-side'); show('login'); setTimeout(()=>$('iSenha').focus(),50); }
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
  $('bSair').hidden=false; document.body.classList.add('has-side');
  if(!st.empresas.length) carregarEmpresas();
  if(!iniciado){ window.addEventListener('hashchange', rotear); iniciado=true; }
  rotear();
}
function rotear(){
  const h=location.hash.slice(1); fecharLateralMobile();
  if(/^e-[a-z0-9]+$/.test(h)) return abrirEmpresa(h.slice(2));
  fecharEmpresa(); show('home'); carregarEmpresas();
}

/* ---------- lista de empresas ---------- */
async function carregarEmpresas(){
  if(!st.empresas.length) $('cards').innerHTML='<div class="nodata">Carregando empresas…</div>';
  try{ st.empresas = await api('empresas'); desenharCards(); desenharLateral(); }
  catch(e){ falha(e); if(!e.silent) $('cards').innerHTML='<div class="nodata">Não consegui carregar as empresas. Recarregue a página.</div>'; }
}
function desenharCards(){
  desenharVisao();
  const box=$('cards'); box.innerHTML='';
  for(const e of st.empresas){
    const u=e.ultimo, cor=corDe(e);
    const el=document.createElement('a'); el.className='ecard'; el.href='#e-'+e.id; el.style.setProperty('--c',cor);
    el.innerHTML = `<div class="t"><div class="av" style="--c:${cor}">${esc(iniciais(e.nome))}</div><div style="min-width:0"><h2>${esc(e.nome)}${e.temSenha?'':'<span class="warn">sem senha</span>'}</h2><div class="meta">${esc([e.cnpj,e.contato].filter(Boolean).join(' · ')||'—')}</div></div></div>`
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
  $('iSenhaCli').value=''; $('iPos').checked = emp ? emp.posicao!==false : true; $('iContas').checked = !!(emp && emp.contas); $('iContratos').checked = !!(emp && emp.contratos);
  const precisa = !emp || !emp.temSenha;
  $('lSenha').textContent = precisa ? 'Senha do cliente *' : 'Nova senha do cliente';
  $('iSenhaCli').placeholder = precisa ? 'mín. 4 caracteres' : 'deixe em branco para manter a atual';
  $('iSenhaCli').required = precisa;
  $('hSenha').textContent = precisa
    ? 'É a senha que o cliente digita para abrir o painel. Anote antes de salvar: por segurança ela não fica visível depois.'
    : `Senha definida em ${diaBR(emp.senhaEm)}. Preencha só se quiser trocar (quem estiver logado com a antiga sai na hora).`;
  corSel = emp ? corDe(emp) : CORES[st.empresas.length % CORES.length];
  $('iCor').innerHTML = CORES.map(c=>`<button type="button" data-c="${c}" style="background:${c}" class="${c===corSel?'on':''}" aria-label="cor"></button>`).join('');
  $('bDelEmp').hidden=!emp; $('mEmp').hidden=false; setTimeout(()=>$('iNome').focus(),50);
}
$('iCor').onclick = e => { const b=e.target.closest('button'); if(!b) return; corSel=b.dataset.c; [...$('iCor').children].forEach(x=>x.classList.toggle('on',x===b)); };
$('iCnpj').oninput = e => { const d=e.target.value.replace(/\D/g,'').slice(0,14); e.target.value = d.length>12? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2}).*/,'$1.$2.$3/$4-$5') : d; };
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$('mEmp').hidden=true);
document.addEventListener('keydown', e=>{ if(e.key==='Escape') $('mEmp').hidden=true; });
$('bNova').onclick = () => abrirForm(null);
$('bGerar').onclick = () => { const A='abcdefghjkmnpqrstuvwxyz23456789'; const b=new Uint8Array(8); crypto.getRandomValues(b); $('iSenhaCli').value=Array.from(b,x=>A[x%A.length]).join(''); $('iSenhaCli').select(); };
const senhasNovas = new Map(); // senha recém-definida, só nesta aba, para copiar junto com o link
$('fEmp').onsubmit = async ev => {
  ev.preventDefault();
  const body={ nome:$('iNome').value.trim(), cnpj:$('iCnpj').value.trim(), contato:$('iCont').value.trim(), cor:corSel,
    posicao:$('iPos').checked, contas:$('iContas').checked, contratos:$('iContratos').checked, senha:$('iSenhaCli').value.trim() };
  if(!body.nome) return;
  if(body.senha && body.senha.length<4) return toast('A senha precisa ter pelo menos 4 caracteres.');
  $('bSave').disabled=true;
  try{
    if(editId){
      st.emp = await api('empresas?id='+editId,{method:'PUT', body});
      if(body.senha) senhasNovas.set(editId, body.senha);
      st.rendered=null; cabecalho(); await carregarContas(); await carregarContratos(); escolherVersao(); toast(body.senha?'Empresa atualizada. Senha nova ativa.':'Empresa atualizada');
    } else {
      const e = await api('empresas',{method:'POST', body}); if(body.senha) senhasNovas.set(e.id, body.senha);
      location.hash='e-'+e.id; toast('Empresa cadastrada. Agora arraste a planilha.');
    }
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
  st.seq++; Object.assign(st,{emp:null, rels:[], relId:null, model:null, rendered:null, contas:[], contratos:[], calMes:mesAtual()});
  charts.forEach(c=>c.destroy()); charts=[]; REPORT_EL.innerHTML=''; $('shareBox').hidden=true; showErr('');
  desenharLateral();
}
async function abrirEmpresa(id){
  if(st.emp && st.emp.id===id) return;
  fecharEmpresa(); const seq=st.seq; show('emp');
  $('eNome').textContent='Carregando…'; $('eMeta').textContent=''; $('eAv').textContent=''; $('tbar').hidden=true;
  setEmpty('Carregando painel…',''); $('histList').innerHTML='<li class="none">Carregando…</li>';
  try{
    const emp = await api('empresas?id='+id); if(seq!==st.seq) return;
    st.emp=emp; cabecalho(); await carregarContas(); await carregarContratos(); await carregarHistorico();
  }catch(e){
    if(seq!==st.seq || e.silent) return;
    $('eNome').textContent='Empresa não encontrada'; setEmpty('Não consegui abrir esta empresa', e.message); $('histList').innerHTML='';
  }
}
function cabecalho(){
  const e=st.emp; EMP_NOME=e.nome||'';
  $('eNome').textContent=e.nome; $('eAv').textContent=iniciais(e.nome); $('eAv').style.setProperty('--c',corDe(e));
  $('eMeta').textContent=[e.cnpj, e.contato, e.ultimo?'atualizado em '+dataBR(e.ultimo.enviadoEm):null].filter(Boolean).join(' · ');
  if(!e.temSenha){ const w=document.createElement('span'); w.className='warn'; w.textContent='sem senha: o cliente não consegue abrir'; $('eMeta').append(' ', w); }
  REPORT_OPTS.posicao = e.posicao!==false;
  REPORT_OPTS.extra = (e.contas ? 1 : 0) + (e.contratos ? 1 : 0);
  $('contasBox').hidden = !e.contas;
  $('contratosBox').hidden = !e.contratos;
  desenharLateral();
  document.title=e.nome+' · Evolução Financeira';
  if(!$('shareBox').hidden) preencherShare();
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
    $('tbar').hidden=true; charts.forEach(c=>c.destroy()); charts=[]; REPORT_EL.innerHTML=''; st.rendered=null; st.model=null;
    setEmpty('Nenhuma planilha ainda','Arraste a planilha de conciliação no quadro acima para montar o painel.');
    return desenharExtras();
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
function redesenhar(){ if(st.model) render(st.model, st.mode, st.m); desenharExtras(); }
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
function mensagemCliente(){
  const s = senhasNovas.get(st.emp.id);
  return `Painel financeiro da ${st.emp.nome}:\n${linkCliente()}`+(s?`\nSenha: ${s}`:'');
}
function preencherShare(){
  $('shareInput').value=linkCliente();
  const s=senhasNovas.get(st.emp.id);
  $('shareSenha').textContent = !st.emp.temSenha ? '⚠ Defina uma senha em Editar: sem ela o cliente não consegue abrir.'
    : s ? `Senha atual: ${s} (vai junto ao copiar).` : 'Mande também a senha que você definiu para este cliente.';
}
async function copiar(txt){ try{ await navigator.clipboard.writeText(txt); toast('Copiado'); }catch(e){ $('shareInput').select(); toast('Selecione e copie o link'); } }
$('bShare').onclick = () => { if(!st.emp) return; preencherShare(); $('shareBox').hidden=false; copiar(mensagemCliente()); };
$('bCopy2').onclick = () => copiar(mensagemCliente());
$('bEdit').onclick = () => st.emp && abrirForm(st.emp);
$('bNovoLink').onclick = async ev => {
  ev.preventDefault();
  if(!await confirmar('Gerar um link novo?','O link atual para de funcionar na hora. Você vai precisar mandar o novo para o cliente.','Gerar link novo')) return;
  try{ st.emp=await api('empresas?id='+st.emp.id,{method:'PUT', body:{novoLink:true}}); cabecalho(); preencherShare(); copiar(mensagemCliente()); }catch(e){ falha(e); }
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


/* ---------- contas a pagar ---------- */
const brl2 = v => v.toLocaleString('pt-BR',{minimumFractionDigits:2, maximumFractionDigits:2});
function lerValor(t){
  let x = String(t||'').replace(/R\$|\s/g,'');
  if(!x) return NaN;
  if(x.includes(',')) x = x.replace(/\./g,'').replace(',','.');
  else if(/^\d{1,3}(\.\d{3})+$/.test(x)) x = x.replace(/\./g,'');
  const n = Number(x); return isFinite(n) ? Math.round(n*100)/100 : NaN;
}
function lerData(t){
  t = String(t||'').trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if(m){ const a = m[3].length===2 ? '20'+m[3] : m[3]; return `${a}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`; }
  if(/^\d{5}$/.test(t)){ const d=new Date(Date.UTC(1899,11,30)+(+t)*864e5); return d.toISOString().slice(0,10); } // número de série do Excel
  return '';
}
async function carregarContas(){
  st.contas = [];
  if(!st.emp || !st.emp.contas){ desenharContas(); return; }
  try{ st.contas = await api('contas?empresa='+st.emp.id); }catch(e){ falha(e); }
  desenharContas();
}
function ordenarContas(){ st.contas.sort((a,b)=>a.vencimento.localeCompare(b.vencimento)||a.recebedor.localeCompare(b.recebedor,'pt-BR')); }
function resumoContas(){
  const hoje=hojeISO(), futuras=st.contas.filter(c=>c.vencimento>=hoje);
  $('cbResumo').textContent = st.contas.length ? `${futuras.length} a vencer · ${curto(futuras.reduce((t,c)=>t+c.valor,0))}` : 'nenhuma conta cadastrada';
}
function desenharContas(){
  const tb=$('cLista'); tb.innerHTML=''; ordenarContas();
  const hoje=hojeISO(); resumoContas();
  if(!st.contas.length) tb.innerHTML='<tr><td colspan="4" style="color:var(--muted);padding:14px 8px">Cadastre a primeira conta na linha acima ou use "Colar do Excel".</td></tr>';
  for(const c of st.contas){
    const tr=document.createElement('tr'); tr.className = c.vencimento<hoje ? 'pass' : '';
    tr.innerHTML = `<td><input maxlength="120"></td><td class="cv2"><input inputmode="decimal"></td><td class="cd2"><input type="date"></td><td class="ca"><button class="x" title="Apagar conta" type="button">×</button></td>`;
    const [iR,iV,iD] = tr.querySelectorAll('input');
    iR.value=c.recebedor; iV.value=brl2(c.valor); iD.value=c.vencimento;
    const salvar = async () => {
      const novo={ recebedor:iR.value.trim(), valor:lerValor(iV.value), vencimento:iD.value };
      if(novo.recebedor===c.recebedor && novo.valor===c.valor && novo.vencimento===c.vencimento) return;
      if(!novo.recebedor || isNaN(novo.valor) || !novo.vencimento){ tr.className='erro'; return toast('Preencha recebedor, valor e data.'); }
      tr.className='salvando'; const mudouData = novo.vencimento!==c.vencimento;
      try{ Object.assign(c, await api('contas?id='+c.id,{method:'PUT', body:novo})); tr.className = c.vencimento<hojeISO() ? 'pass' : ''; iV.value=brl2(c.valor); desenharCalendario(); toast('Conta salva'); if(mudouData) desenharContas(); else resumoContas(); }
      catch(e){ tr.className='erro'; falha(e); }
    };
    [iR,iV,iD].forEach(i=>{ i.addEventListener('change', salvar); i.addEventListener('keydown', e=>{ if(e.key==='Enter') i.blur(); }); });
    tr.querySelector('.x').onclick = async () => {
      if(!await confirmar('Apagar esta conta?', `${c.recebedor} · R$ ${brl2(c.valor)} · ${c.vencimento.split('-').reverse().join('/')}`)) return;
      try{ await api('contas?id='+c.id,{method:'DELETE'}); st.contas=st.contas.filter(x=>x!==c); desenharContas(); desenharCalendario(); }catch(e){ falha(e); }
    };
    tb.append(tr);
  }
}
async function adicionarConta(){
  const item={ recebedor:$('nRec').value.trim(), valor:lerValor($('nVal').value), vencimento:$('nData').value };
  if(!item.recebedor) return $('nRec').focus();
  if(isNaN(item.valor)) { toast('Valor inválido. Use por exemplo 1.234,56'); return $('nVal').focus(); }
  if(!item.vencimento) return $('nData').focus();
  $('bAddConta').disabled=true;
  try{
    const r = await api('contas',{method:'POST', body:{empresaId:st.emp.id, itens:[item]}});
    st.contas.push(...r); $('nRec').value=''; $('nVal').value=''; $('nRec').focus();
    desenharContas(); st.calMes=item.vencimento.slice(0,7); desenharCalendario(); toast('Conta adicionada');
  }catch(e){ falha(e); }
  $('bAddConta').disabled=false;
}
$('bAddConta').onclick = adicionarConta;
['nRec','nVal','nData'].forEach(id=>$(id).addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); adicionarConta(); } }));
$('nVal').addEventListener('blur', () => { const v=lerValor($('nVal').value); if(!isNaN(v)) $('nVal').value=brl2(v); });

function lerColagem(txt){
  const ok=[], ruins=[];
  for(const linha of txt.split(/\r?\n/)){
    if(!linha.trim()) continue;
    let cols = linha.split('\t'); if(cols.length<3) cols = linha.split(';');
    cols = cols.map(c=>c.trim()).filter((c,i)=>c!==''||i<3);
    if(cols.length<3){ ruins.push(linha); continue; }
    // aceita as colunas em qualquer ordem: acha a data e o valor, o resto é o nome
    let iD = cols.findIndex(c=>lerData(c)), iV = cols.findIndex((c,i)=>i!==iD && !isNaN(lerValor(c)));
    if(iD<0 || iV<0){ ruins.push(linha); continue; }
    const nome = cols.filter((c,i)=>i!==iD && i!==iV).join(' ').trim();
    if(!nome){ ruins.push(linha); continue; }
    ok.push({ recebedor:nome.slice(0,120), valor:lerValor(cols[iV]), vencimento:lerData(cols[iD]) });
  }
  return {ok, ruins};
}
$('bColar').onclick = () => { $('tColar').value=''; $('colarMsg').textContent=''; $('mColar').hidden=false; setTimeout(()=>$('tColar').focus(),50); };
$('bColarNao').onclick = () => $('mColar').hidden=true;
$('tColar').oninput = () => { const {ok,ruins}=lerColagem($('tColar').value); $('colarMsg').textContent = ok.length||ruins.length ? `${ok.length} conta(s) reconhecida(s)`+(ruins.length?` · ${ruins.length} linha(s) ignorada(s) (títulos ou incompletas)`:'') : ''; };
$('bColarSim').onclick = async () => {
  const {ok} = lerColagem($('tColar').value);
  if(!ok.length) return $('colarMsg').textContent='Nenhuma conta reconhecida. Confira se há recebedor, valor e data em cada linha.';
  $('bColarSim').disabled=true;
  try{
    for(let i=0;i<ok.length;i+=300){ const r=await api('contas',{method:'POST', body:{empresaId:st.emp.id, itens:ok.slice(i,i+300)}}); st.contas.push(...r); }
    $('mColar').hidden=true; desenharContas(); desenharCalendario(); toast(`${ok.length} conta(s) importada(s)`);
  }catch(e){ $('colarMsg').textContent=e.message; }
  $('bColarSim').disabled=false;
};

/* calendário no preview do consultor (mesma página que o cliente vê) */
function desenharCalendario(){
  if(!st.emp) return;
  const velho = REPORT_EL.querySelector('.cal-page');
  if(!st.emp.contas){ if(velho) velho.remove(); return; }
  anexarCalendario(st.contas.concat(st.emp.contratos ? parcelasNoCalendario(st.contratos) : []), st.calMes || mesAtual());
}
function desenharExtras(){ anexarContratos(st.emp && st.emp.contratos ? st.contratos : null); desenharCalendario(); }
REPORT_EL.addEventListener('click', e => {
  const b = e.target.closest('[data-cal]'); if(!b) return;
  const d = +b.dataset.cal; st.calMes = d===0 ? mesAtual() : mesMais(st.calMes||mesAtual(), d); desenharCalendario();
});


/* ---------- contratos ---------- */
async function carregarContratos(){
  st.contratos = [];
  if(st.emp && st.emp.contratos){ try{ st.contratos = await api('contratos?empresa='+st.emp.id); }catch(e){ falha(e); } }
  desenharContratos();
}
const dataBRc = iso => iso.split('-').reverse().join('/');
function mudouContratos(){ desenharContratos(); desenharExtras(); }
function desenharContratos(){
  const box=$('ctrLista'); box.innerHTML='';
  const { lista } = resumoContratos(st.contratos);
  const saldo = lista.reduce((t,c)=>t+c.saldo,0);
  $('ctrResumo').textContent = st.contratos.length ? `${lista.filter(c=>c.faltam).length} ativo(s) · falta pagar ${curto(saldo)}` : 'nenhum contrato cadastrado';
  if(!st.contratos.length) box.innerHTML='<div class="nodata" style="margin-top:10px">Clique em "+ Novo contrato" para começar.</div>';
  const hoje=hojeISO();
  st.contratos.forEach((c,k)=>{
    c.parcelas.sort((a,b)=>a.vencimento.localeCompare(b.vencimento));
    const r=lista[k];
    const card=document.createElement('div'); card.className='ctrcard'; card.style.borderLeft='4px solid '+r.cor;
    card.innerHTML=`<div class="ctrh"><input class="nome" maxlength="120" placeholder="Nome do contrato" title="Nome do contrato · clique para editar"><span class="res"></span>
        <button class="btn sm" data-a="gerar" type="button">Início e parcelas</button><button class="btn sm danger" data-a="apagar" type="button">Excluir</button></div>
      <div class="cscroll"><table class="ctab"><thead><tr><th class="n">Nº</th><th class="cd2">Vencimento</th><th class="cv2">Valor (R$)</th><th class="ca"></th></tr></thead><tbody></tbody>
        <tbody><tr class="novo"><td class="n">novo</td><td class="cd2"><input type="date" data-n="d"></td><td class="cv2"><input inputmode="decimal" placeholder="0,00" data-n="v"></td><td class="ca"><button class="btn sm primary" data-a="add" type="button">+<span class="lbl"> Linha</span></button></td></tr></tbody></table></div>`;
    const iNome=card.querySelector('input.nome'); iNome.value=c.nome;
    card.querySelector('.res').textContent = r.total ? `início ${dataBRc(r.inicio.vencimento)} · ${r.pagas}/${r.total} paga(s) · já pago ${brl(r.pago)} · falta ${brl(r.saldo)}` : 'sem parcelas';
    iNome.addEventListener('change', async ()=>{ const nome=iNome.value.trim(); if(!nome||nome===c.nome){ iNome.value=c.nome; return; }
      try{ Object.assign(c, await api('contratos?id='+c.id,{method:'PUT', body:{nome}})); toast('Contrato renomeado'); desenharExtras(); }catch(e){ falha(e); iNome.value=c.nome; } });
    iNome.addEventListener('keydown', e=>{ if(e.key==='Enter') iNome.blur(); });
    const tb=card.querySelector('tbody');
    c.parcelas.forEach((p,i)=>{
      const tr=document.createElement('tr'); tr.className = p.vencimento<hoje ? 'pass' : '';
      tr.innerHTML=`<td class="n">${i+1}/${c.parcelas.length}</td><td class="cd2"><input type="date"></td><td class="cv2"><input inputmode="decimal"></td><td class="ca"><button class="x" type="button" title="Apagar parcela">×</button></td>`;
      const [iD,iV]=tr.querySelectorAll('input'); iD.value=p.vencimento; iV.value=brl2(p.valor);
      const salvar = async ()=>{ const novo={vencimento:iD.value, valor:lerValor(iV.value)};
        if(novo.vencimento===p.vencimento && novo.valor===p.valor) return;
        if(!novo.vencimento || isNaN(novo.valor)){ tr.className='erro'; return toast('Preencha data e valor.'); }
        tr.className='salvando';
        try{ Object.assign(p, await api('contratos?parcela='+p.id,{method:'PUT', body:novo})); toast('Parcela salva'); mudouContratos(); }catch(e){ tr.className='erro'; falha(e); } };
      [iD,iV].forEach(x=>{ x.addEventListener('change', salvar); x.addEventListener('keydown', e=>{ if(e.key==='Enter') x.blur(); }); });
      tr.querySelector('.x').onclick = async ()=>{ try{ await api('contratos?parcela='+p.id,{method:'DELETE'}); c.parcelas=c.parcelas.filter(x=>x!==p); mudouContratos(); }catch(e){ falha(e); } };
      tb.append(tr);
    });
    const nD=card.querySelector('[data-n="d"]'), nV=card.querySelector('[data-n="v"]');
    // sugere a data um mês depois da última parcela
    const ult=c.parcelas[c.parcelas.length-1]; if(ult) nD.value=somaMes(ult.vencimento,1);
    if(ult) nV.value=brl2(ult.valor);
    const add = async ()=>{ const it={vencimento:nD.value, valor:lerValor(nV.value)};
      if(!it.vencimento) return nD.focus(); if(isNaN(it.valor)) return nV.focus();
      try{ const r2=await api('contratos',{method:'POST', body:{contratoId:c.id, itens:[it]}}); c.parcelas.push(...r2); mudouContratos(); toast('Parcela adicionada'); }catch(e){ falha(e); } };
    card.querySelector('[data-a="add"]').onclick=add;
    [nD,nV].forEach(x=>x.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); add(); } }));
    card.querySelector('[data-a="gerar"]').onclick=()=>abrirGerar(c);
    card.querySelector('[data-a="apagar"]').onclick=async ()=>{
      if(!await confirmar('Excluir o contrato '+c.nome+'?','O contrato e todas as parcelas saem do painel e do calendário do cliente.')) return;
      try{ await api('contratos?id='+c.id,{method:'DELETE'}); st.contratos=st.contratos.filter(x=>x!==c); mudouContratos(); toast('Contrato excluído'); }catch(e){ falha(e); } };
    box.append(card);
  });
}
function somaMes(iso, n){ const [a,m,d]=iso.split('-').map(Number); const alvo=new Date(a,m-1+n,1); const ult=new Date(alvo.getFullYear(),alvo.getMonth()+1,0).getDate(); return isoDe(new Date(alvo.getFullYear(),alvo.getMonth(),Math.min(d,ult))); }
$('bNovoCtr').onclick = () => abrirGerar(null);
let gerarCtr=null;
// c = null → contrato novo (só é criado ao confirmar, já com o nome)
function abrirGerar(c){
  gerarCtr=c;
  $('gerarT').textContent = c ? 'Gerar parcelas' : 'Novo contrato';
  $('gerarSub').textContent = c ? 'Cria as parcelas mensais que faltam entre o início e o fim do contrato. Meses que já têm parcela não são duplicados.'
                                : 'Informe o início e o total de parcelas: o painel cria todas, e as já vencidas contam como pagas.';
  $('bGerarSim').textContent = c ? 'Gerar parcelas' : 'Criar contrato';
  const ps=c ? c.parcelas.slice().sort((a,b)=>a.vencimento.localeCompare(b.vencimento)) : [];
  const ult=ps[ps.length-1];
  $('gNome').value = c ? c.nome : '';
  $('gVal').value = ult? brl2(ult.valor) : ''; $('gQtd').value = ps.length || ''; $('gData').value = ps.length ? ps[0].vencimento : '';
  infoGerar(); $('mGerar').hidden=false; setTimeout(()=>$(c?'gVal':'gNome').focus(),50);
}
// parcelas do contrato: do início, uma por mês; pula meses que já têm parcela
function planoGerar(){
  const ini=$('gData').value, qtd=+$('gQtd').value, valor=lerValor($('gVal').value);
  if(!ini || !(qtd>=1 && qtd<=360)) return null;
  const tem=new Set((gerarCtr? gerarCtr.parcelas : []).map(p=>p.vencimento.slice(0,7)));
  const todas=Array.from({length:qtd},(_,i)=>somaMes(ini,i));
  const novas=todas.filter(d=>!tem.has(d.slice(0,7))).map(vencimento=>({ vencimento, valor }));
  const hoje=hojeISO(), pagas=todas.filter(d=>d<hoje).length;
  return { novas, pagas, faltam:qtd-pagas, fim:todas[todas.length-1], valor };
}
function infoGerar(){
  const pl=planoGerar(), el=$('gInfo');
  if(!pl){ el.textContent='As parcelas com data passada contam como pagas e entram em "Já pago" no painel do cliente.'; return; }
  const v = isNaN(pl.valor) ? '' : ` · já pago ${brl(pl.pagas*pl.valor)}`;
  el.textContent = `${pl.pagas} paga(s)${v} · ${pl.faltam} a pagar · última em ${dataBRc(pl.fim)}`
    + (gerarCtr && gerarCtr.parcelas.length ? ` · ${pl.novas.length} parcela(s) nova(s) a criar` : '');
}
['gData','gQtd','gVal'].forEach(id=>$(id).addEventListener('input', infoGerar));
$('bGerarNao').onclick = () => $('mGerar').hidden=true;
$('fGerar').onsubmit = async ev => {
  ev.preventDefault();
  const nome=$('gNome').value.trim(), valor=lerValor($('gVal').value), qtd=+$('gQtd').value, ini=$('gData').value;
  if(!nome) return toast('Dê um nome ao contrato.');
  if(isNaN(valor)) return toast('Valor inválido. Use por exemplo 1.234,56');
  if(!(qtd>=1 && qtd<=360) || !ini) return toast('Confira a quantidade e a data.');
  const itens = planoGerar().novas;
  if(gerarCtr && !itens.length && nome===gerarCtr.nome) return toast('Todos esses meses já têm parcela. Aumente o total ou mude o início.');
  $('bGerarSim').disabled=true;
  try{
    if(!gerarCtr){ gerarCtr = await api('contratos',{method:'POST', body:{empresaId:st.emp.id, nome}}); st.contratos.push(gerarCtr); }
    else if(nome!==gerarCtr.nome) Object.assign(gerarCtr, await api('contratos?id='+gerarCtr.id,{method:'PUT', body:{nome}}));
    if(itens.length){ const r=await api('contratos',{method:'POST', body:{contratoId:gerarCtr.id, itens}}); gerarCtr.parcelas.push(...r); }
    $('mGerar').hidden=true; mudouContratos(); toast(itens.length ? itens.length+' parcela(s) criada(s)' : 'Contrato salvo'); }
  catch(e){ falha(e); }
  $('bGerarSim').disabled=false;
};


/* ---------- barra lateral e visão geral ---------- */
prepararLateral();
vigiarPaginas($('sbPaginas'));
$('sbHome').onclick = ev => { ev.preventDefault(); location.hash=''; };
$('sbNova').onclick = () => { fecharLateralMobile(); abrirForm(null); };
$('sbSair').onclick = () => $('bSair').click();
$('sbLink').onclick = ev => { ev.preventDefault(); fecharLateralMobile(); $('bShare').click(); $('shareBox').scrollIntoView({behavior:'smooth', block:'center'}); };
document.querySelectorAll('[data-ir]').forEach(a=>a.onclick = ev => { ev.preventDefault(); fecharLateralMobile(); $(a.dataset.ir).scrollIntoView({behavior:'smooth', block:'start'}); });
$('sbBusca').addEventListener('input', desenharLateral);

function desenharLateral(){
  const q = norm($('sbBusca').value), box = $('sbEmp'), atual = st.emp && st.emp.id;
  const lista = st.empresas.filter(e=>!q || norm(e.nome).includes(q));
  box.innerHTML = lista.length ? '' : `<div class="sbvazio">${st.empresas.length ? 'Nenhuma empresa encontrada.' : 'Nenhuma empresa ainda.'}</div>`;
  for(const e of lista){
    const a=document.createElement('a'); a.className='sbi emp'+(e.id===atual?' on':''); a.href='#e-'+e.id;
    const u=e.ultimo, val = u && typeof u.rl==='number' ? `<em class="${u.rl<0?'neg':''}">${esc(curto(u.rl))}</em>` : (e.temSenha ? '' : '<em class="alerta">sem senha</em>');
    a.innerHTML = `<i class="sbav" style="--c:${corDe(e)}">${esc(iniciais(e.nome))}</i><span>${esc(e.nome)}</span>${val}`;
    box.append(a);
  }
  $('sbHome').classList.toggle('on', !atual && !$('v-home').hidden);
  $('sbEmpNav').hidden = !st.emp;
  if(st.emp){
    $('sbEmpNome').textContent = st.emp.nome;
    document.querySelector('[data-ir="contasBox"]').hidden = !st.emp.contas;
    document.querySelector('[data-ir="contratosBox"]').hidden = !st.emp.contratos;
  }
}

// resumo da carteira de empresas no topo da tela inicial
function desenharVisao(){
  const es = st.empresas, hoje = Date.now(), DIAS = 864e5;
  const com = es.filter(e=>e.ultimo && typeof e.ultimo.rb==='number');
  const emDia = es.filter(e=>e.ultimo && hoje-new Date(e.ultimo.enviadoEm) < 45*DIAS);
  const rb = com.reduce((t,e)=>t+e.ultimo.rb,0), rl = com.reduce((t,e)=>t+e.ultimo.rl,0);
  const pos = com.filter(e=>e.ultimo.rl>=0).length;
  const pend = [];
  for(const e of es){
    if(!e.temSenha) pend.push([e, 'Sem senha: o cliente ainda não consegue abrir o painel', 'Definir senha']);
    if(!e.ultimo) pend.push([e, 'Nenhuma planilha enviada ainda', 'Enviar planilha']);
    else if(hoje-new Date(e.ultimo.enviadoEm) >= 45*DIAS) pend.push([e, `Última planilha em ${diaBR(e.ultimo.enviadoEm)}`, 'Atualizar']);
  }
  const k = (l,v,d,c,ic) => `<div class="okpi" style="--c:${c}"><div class="oic">${ICON[ic]}</div><div class="ol">${l}</div><div class="ov">${v}</div><div class="od">${d}</div></div>`;
  $('cardsSub').textContent = es.length ? `${es.length} cadastrada(s)` : '';
  $('ovw').innerHTML = !es.length ? `<div class="obem"><div class="oic big">${ICON.spark}</div><div><b>Bem-vindo ao painel</b><span>Cadastre a primeira empresa para começar. Depois é só arrastar a planilha do mês e mandar o link para o cliente.</span></div><button class="btn primary" type="button" onclick="abrirForm(null)">+ Cadastrar empresa</button></div>` :
    `<div class="okpis">
      ${k('Empresas', es.length, `${es.filter(e=>e.temSenha).length} com acesso liberado`, '#566BAF', 'users')}
      ${k('Planilhas em dia', `${emDia.length} de ${es.length}`, 'enviadas nos últimos 45 dias', '#34c759', 'upload')}
      ${k('Receita somada', com.length? curto(rb) : '—', 'último mês de cada empresa', '#902884', 'chart')}
      ${k('Resultado somado', com.length? `<span class="${rl<0?'neg':''}">${curto(rl)}</span>` : '—', com.length? `${pos} de ${com.length} no positivo` : 'sem planilhas ainda', '#ff9500', 'bars')}
    </div>
    <div class="opend">
      <div class="oph"><h2>${pend.length ? 'Pendências' : 'Tudo em dia'}</h2><span>${pend.length ? pend.length+' item(ns) para resolver' : 'Nenhuma empresa precisa de atenção agora.'}</span></div>
      ${pend.length ? `<div class="olist">${pend.slice(0,6).map(([e,t,acao])=>`<a class="oitem" href="#e-${esc(e.id)}"><i class="sbav" style="--c:${corDe(e)}">${esc(iniciais(e.nome))}</i><div><b>${esc(e.nome)}</b><span>${esc(t)}</span></div><em>${acao} ›</em></a>`).join('')}</div>`
        : `<div class="ook">${ICON.check}<span>Todas as empresas têm senha e planilha recente.</span></div>`}
    </div>`;
}
