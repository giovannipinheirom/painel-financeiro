/* Página do cliente: abre pelo link /c/<token>, sem login, e mostra só a empresa dele. */
REPORT_EL = $('report');
const token = (location.pathname.match(/\/c\/([a-z0-9]{24})\/?$/) || [])[1];
const cs = { model:null, mode:'mensal', m:null, relId:null, cache:new Map() };

function status(t, s){ const el=$('status'); if(t==null){ el.hidden=true; return; } el.hidden=false; el.innerHTML=''; const b=document.createElement('b'); b.textContent=t; el.append(b, document.createTextNode(s||'')); }
const iniciais = n => String(n||'?').trim().split(/\s+/).filter(w=>w.length>2||/^[A-Z]/.test(w)).slice(0,2).map(w=>w[0]).join('').toUpperCase() || '?';

async function carregar(rel){
  if(!token) return status('Link incompleto','Confira se você copiou o link inteiro que recebeu do seu consultor.');
  if(rel && cs.cache.has(rel)) return mostrar(cs.cache.get(rel));
  let r, data=null;
  try{ r = await fetch('/api/publico?token='+token+(rel?'&rel='+encodeURIComponent(rel):''), {credentials:'omit'}); data = await r.json(); }
  catch(e){ return status('Sem conexão','Não consegui falar com o servidor. Confira sua internet e recarregue a página.'); }
  if(!r.ok) return status('Painel indisponível', data && data.erro ? data.erro : 'Tente de novo em instantes.');
  if(data.relatorio) cs.cache.set(data.relatorio.id, data);
  mostrar(data);
}

function mostrar(d){
  status(null); $('v-emp').hidden=false;
  EMP_NOME = d.empresa.nome;
  $('eNome').textContent=d.empresa.nome; $('eAv').textContent=iniciais(d.empresa.nome);
  document.title = d.empresa.nome+' · Evolução Financeira';
  $('ver').innerHTML = d.versoes.map((v,i)=>`<option value="${esc(v.id)}">${i===0?'Atual · ':''}${esc(diaBR(v.enviadoEm))} (até ${MESES[(v.ultimo||1)-1]})</option>`).join('');
  if(!d.relatorio){ $('tbar').hidden=true; $('eMeta').textContent=d.empresa.cnpj||''; return setEmpty('O painel ainda não foi publicado','Assim que o seu consultor enviar a primeira planilha, ela aparece aqui.'); }
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
  if(!cs.model) return;
  if(typeof Chart==='undefined') return setEmpty('Não consegui carregar os gráficos','Recarregue a página.');
  render(cs.model, cs.mode, cs.m);
}

$('mode').onclick = e => { const b=e.target.closest('button'); if(!b) return; cs.mode=b.dataset.m; [...$('mode').children].forEach(x=>x.classList.toggle('on',x===b)); redesenhar(); };
$('month').onchange = e => { cs.m=+e.target.value; redesenhar(); };
$('ver').onchange = e => carregar(e.target.value);
$('bPdf').onclick = () => window.print();
carregar(null);
