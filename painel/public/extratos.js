/* =====================================================================
   PAINEL A PARTIR DOS EXTRATOS BANCÁRIOS (área do consultor)
   1) lê os arquivos que o banco gera (BB, Sicredi, Stone, Cora)
   2) classifica cada lançamento com as REGRAS (palavra-chave → classificação) e o DEPARA
      (classificação → linha da DRE), do mesmo jeito que as planilhas de conciliação
   3) monta o mesmo modelo de painel que a planilha gera e publica
   ===================================================================== */
const EXT_BANCOS = { bb:'BB', sicredi:'Sicredi', stone:'Stone', cora:'Cora', inter:'Inter', itau:'Itaú', paypal:'PayPal', cartao_itau:'Cartão Itaú' };
const extNomeBanco = b => EXT_BANCOS[b] || b;
const extLimpa = s => String(s ?? '').replace(/\s+/g, ' ').trim();
function extNum(v){
  if(typeof v==='number') return v;
  let t = String(v ?? '').replace(/[R$\s]/g,''); if(!t) return NaN;
  let neg = false; if(/^\(.*\)$/.test(t)){ neg = true; t = t.slice(1,-1); }
  if(t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g,'').replace(',','.') : t.replace(/,/g,'');
  else if(t.includes(',')) t = t.replace(',','.');
  else if(/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g,'');
  const n = Number(t); return neg ? -n : n;
}
const extSerial = n => new Date(Date.UTC(1899,11,30) + Math.round(n)*864e5).toISOString().slice(0,10);
function extData(v){
  if(v == null || v === '') return null;
  if(typeof v === 'number') return v > 20000 && v < 80000 ? extSerial(v) : null;
  if(v instanceof Date && !isNaN(v)) return isoDe(v);
  const m = String(v).match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if(!m) return null;
  const a = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  const r = `${a}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
  const t = new Date(r+'T12:00:00Z'); return isNaN(t) || t.toISOString().slice(0,10) !== r ? null : r;
}
const extDiaAntes = iso => new Date(Date.parse(iso+'T12:00:00Z') - 864e5).toISOString().slice(0,10);
const extFimMes = (ano, m) => isoDe(new Date(ano, m, 0));   // m = 1..12
const extDataBR = iso => iso ? iso.split('-').reverse().join('/') : '';

// chave de cada lançamento: banco + data + valor + nº da ocorrência desse valor no dia.
// Não usa o texto: assim pequenas edições feitas à mão na planilha não viram lançamento repetido.
function extChaves(banco, itens){
  const cont = {};
  for(const i of itens){
    i.b = banco; i.p = i.p.map(extLimpa).join(' | ');
    const base = `${banco}|${i.d}|${Number(i.v).toFixed(2)}`;
    i.c = base + '#' + (cont[base] = (cont[base]||0) + 1);
  }
  return itens;
}

/* ---------- leitura dos arquivos dos bancos ---------- */
function extCsv(txt){
  const linhas = txt.replace(/^﻿/,'').split(/\r?\n/).filter(l=>l.trim()!=='');
  const sep = (linhas[0].match(/;/g)||[]).length > (linhas[0].match(/,/g)||[]).length ? ';' : ',';
  return linhas.map(l=>{ const out=[]; let cur='', q=false;
    for(let k=0;k<l.length;k++){ const ch=l[k];
      if(q){ if(ch==='"'){ if(l[k+1]==='"'){ cur+='"'; k++; } else q=false; } else cur+=ch; }
      else if(ch==='"') q=true; else if(ch===sep){ out.push(cur); cur=''; } else cur+=ch; }
    out.push(cur); return out; });
}
async function extTexto(file){
  const buf = await file.arrayBuffer();
  const u = new TextDecoder('utf-8').decode(buf);
  return u.includes('�') ? new TextDecoder('windows-1252').decode(buf) : u;
}
// acha a linha de cabeçalho que tem todas as colunas pedidas
function extCabecalho(g, ...cols){
  for(let r=0; r<Math.min(g.length,30); r++){ const H=(g[r]||[]).map(norm); if(cols.every(c=>H.some(h=>h===c || h.startsWith(c)))) return { r, H, i:c=>H.findIndex(h=>h===c), ini:c=>H.findIndex(h=>h.startsWith(c)) }; }
  return null;
}
const EXT_LEITORES = {
  bb(g){ const h = extCabecalho(g,'data','historico','valor','inf','detalhamento'); if(!h) return null;
    const iD=h.i('data'), iH=h.i('historico'), iV=h.ini('valor'), iI=h.i('inf'), iDet=h.ini('detalhamento');
    const itens=[], saldos=[];
    for(const r of g.slice(h.r+1)){ const d=extData(r[iD]); if(!d) continue;
      const v = Math.abs(extNum(r[iV])) * (String(r[iI]||'').trim().toUpperCase()==='D' ? -1 : 1); if(isNaN(v)) continue;
      const nh = norm(r[iH]);
      if(nh==='saldo anterior' || nh==='s a l d o' || nh.startsWith('saldo do dia')){ saldos.push({conta:'bb', d, s:v}); continue; }
      itens.push({ d, p:[r[iH], r[iDet]], v }); }
    return { banco:'bb', itens, saldos };
  },
  stone(g){ const h = extCabecalho(g,'movimentacao','tipo','valor','saldo depois','data'); if(!h) return null;
    const iM=h.i('movimentacao'), iT=h.i('tipo'), iV=h.i('valor'), iS=h.i('saldo depois'), iD=h.i('data'), iSit=h.i('situacao'), iDe=h.i('destino'), iO=h.i('origem');
    const itens=[], ult={};
    for(const r of g.slice(h.r+1)){ const d=extData(r[iD]); if(!d) continue; const v=extNum(r[iV]); if(isNaN(v)) continue;
      // nome da outra parte: quem recebeu (saída) ou quem pagou (entrada)
      const desconhecido = x => !x || norm(x)==='desconhecido';
      const nome = norm(r[iM])==='debito' ? (desconhecido(r[iDe]) ? r[iO] : r[iDe]) : r[iO];
      itens.push({ d, p:[r[iT], r[iSit], nome], v });
      const s = extNum(r[iS]); if(!isNaN(s)) (ult[d] = ult[d] || []).push({ s, a: s - v }); }
    // saldo do fim do dia: o "saldo depois" que não é o "saldo antes" de nenhum outro lançamento do dia (vários no mesmo minuto)
    const fimDia = l => { const k = x => Math.round(x*100); const usados = new Map(); l.forEach(x=>usados.set(k(x.a), (usados.get(k(x.a))||0)+1));
      return (l.find(x=>{ const n = usados.get(k(x.s))||0; if(n){ usados.set(k(x.s), n-1); return false; } return true; }) || l[0]).s; };
    return { banco:'stone', itens, saldos:Object.entries(ult).map(([d,l])=>({ conta:'stone', d, s:fimDia(l) })) };
  },
  sicredi(g){ const h = extCabecalho(g,'data','descricao','documento','valor','saldo'); if(!h) return null;
    const iD=h.i('data'), iDs=h.i('descricao'), iV=h.ini('valor'), iS=h.ini('saldo');
    const itens=[], porDia={}; let anterior=null, k=h.r+1;
    for(; k<g.length; k++){ const r=g[k]||[];
      if(!r.some(x=>x!=null && String(x).trim()!=='')) break;                       // fim da seção principal
      if(norm(r[iDs])==='saldo anterior'){ anterior = extNum(r[iS]); continue; }
      const d=extData(r[iD]); if(!d) break; const v=extNum(r[iV]); if(isNaN(v)) continue;
      itens.push({ d, p:[r[iDs]], v }); const s=extNum(r[iS]); if(!isNaN(s)) porDia[d]=s; }
    const saldos = Object.entries(porDia).map(([d,s])=>({ conta:'sicredi', d, s }));
    if(anterior!=null && itens.length) saldos.push({ conta:'sicredi', d:extDiaAntes(itens[0].d), s:anterior });
    // depois da seção principal: posição da conta e das aplicações (a seção "Lançamentos futuros" é ignorada)
    let dt=null;
    for(; k<g.length; k++){ const r=g[k]||[]; const t=norm(r[0]);
      if(t.startsWith('lancamentos futuros')) break;
      const m=String(r[0]||'').match(/saldo da conta em (\d{2}\/\d{2}\/\d{4})/i); if(m) dt=extData(m[1]);
      if(dt && t.startsWith('saldo de investimentos')){ const s=extNum(r[2]); if(!isNaN(s)) saldos.push({ conta:'sicredi_aplic', d:dt, s }); } }
    return { banco:'sicredi', itens, saldos };
  },
  cora(g){ const h = extCabecalho(g,'data','transacao','identificacao','valor'); if(!h) return null;
    const iD=h.i('data'), iT=h.i('transacao'), iId=h.i('identificacao'), iV=h.i('valor');
    const itens=[];
    for(const r of g.slice(h.r+1)){ const d=extData(r[iD]); if(!d) continue; const v=extNum(r[iV]); if(isNaN(v)) continue;
      itens.push({ d, p:[r[iT], r[iId]], v }); }
    return { banco:'cora', itens, saldos:[] };
  },
};
async function extLerArquivo(file){
  let g;
  if(/\.(csv|txt)$/i.test(file.name)) g = extCsv(await extTexto(file));
  else { await carregarXLSX(); const wb = XLSX.read(await file.arrayBuffer(), {type:'array', raw:true});
    g = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header:1, raw:true, defval:null}); }
  for(const ler of Object.values(EXT_LEITORES)){ const r = ler(g); if(r && r.itens.length){ extChaves(r.banco, r.itens); return r; } }
  throw new Error(`Não reconheci o banco do arquivo "${file.name}". Por enquanto leio extratos do BB, Sicredi, Stone e Cora.`);
}

/* ---------- classificação (mesma lógica das planilhas) ---------- */
// Excel SEARCH: não diferencia maiúsculas, * = qualquer texto, ? = um caractere; vale a 1ª regra de cima para baixo
const EXT_RX = new Map();
function extPadrao(p){ let r = EXT_RX.get(p);
  if(!r){ r = new RegExp(String(p).split('').map(ch => ch==='*' ? '[\\s\\S]*' : ch==='?' ? '[\\s\\S]' : ch.replace(/[.+^${}()|[\]\\]/g,'\\$&')).join(''), 'i'); EXT_RX.set(p, r); }
  return r; }
const extTextoRegra = l => l.p + ' | ' + (l.v < 0 ? 'SAÍDA' : 'ENTRADA');
function extRegraQuePega(l, regras){ const t = extTextoRegra(l); for(const r of regras) if(extPadrao(r.p).test(t)) return r; return null; }
function extPelaRegra(l, regras){ const r = extRegraQuePega(l, regras); return r ? r.c : null; }
const extChaveClasse = c => extLimpa(c).toUpperCase();

/* ---------- importar a planilha de conciliação (regras, de-para, histórico, saldos, faturamento) ---------- */
function extBancoDaAba(nome){ const n = norm(nome);
  if(/\bbb\b|banco do brasil/.test(n)) return 'bb'; if(/sicred/.test(n)) return 'sicredi'; if(/stone/.test(n)) return 'stone'; if(/\bcora\b/.test(n)) return 'cora';
  if(/\binter\b/.test(n)) return 'inter'; if(/cart/.test(n) && /itau/.test(n)) return 'cartao_itau'; if(/itau/.test(n)) return 'itau'; if(/paypal/.test(n)) return 'paypal';
  return n.replace(/^extrato /,'').replace(/[^a-z0-9]+/g,'_').slice(0,20) || null; }
function extLerPlanilha(wb){
  const out = { regras:[], depara:[], itens:[], saldos:[], meses:[], abas:[] };
  const gRegras = sheetGrid(wb,'REGRAS'); if(!gRegras) throw new Error('A planilha não tem a aba REGRAS.');
  const col = L => XLSX.utils.decode_col(L);
  for(const nome of wb.SheetNames){
    const ws = wb.Sheets[nome]; if(!ws || !ws['!ref']) continue;
    const rg = XLSX.utils.decode_range(ws['!ref']); let info = null;
    for(let R=rg.s.r; R<=Math.min(rg.e.r, rg.s.r+8) && !info; R++) for(let C=rg.s.c; C<=Math.min(rg.e.c,40); C++){
      const c = ws[XLSX.utils.encode_cell({r:R,c:C})]; if(c && c.f && /SEARCH\(REGRAS!/i.test(c.f)){ info={R,C,f:c.f}; break; } }
    if(!info) continue;
    const f = info.f, banco = extBancoDaAba(nome); if(!banco) continue;
    const mPad = f.match(/SEARCH\(REGRAS!\$?([A-Z]+)\$?\d+/i), mIdx = f.match(/INDEX\(REGRAS!\$?([A-Z]+)\$?\d+:\$?([A-Z]+)\$?\d+/i);
    if(!mPad || !mIdx) continue;
    const cPad = col(mPad[1]), cCls = col(mIdx[1]!==mIdx[2] ? mIdx[2] : mIdx[1]);
    const ini = f.indexOf(',', f.search(/SEARCH\(REGRAS!/i)); let fim = f.indexOf('IF(N(', ini); const fim2 = f.indexOf('))*', ini);
    if(fim < 0 || (fim2 >= 0 && fim2 < fim)) fim = fim2;
    const partes = [...f.slice(ini, fim).matchAll(/\$?([A-Z]{1,2})\$?\d+/g)].map(m=>col(m[1]));
    const mVal = f.match(/N\(\$?([A-Z]+)\$?\d+\)/i), mMan = f.match(/IF\(\$?([A-Z]+)\$?\d+<>""/i);
    const g = XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:null, range:0});
    const off = rg.s.c;   // sheet_to_json começa na 1ª coluna usada
    const cab = (g[info.R-1-rg.s.r] || []).map(norm);
    let cVal = mVal ? col(mVal[1]) : cab.findIndex(h=>h.startsWith('valor')) + off;
    let cData = cab.findIndex(h=>h.startsWith('data')); cData = cData >= 0 ? cData + off : off;
    const cMan = mMan ? col(mMan[1]) : -1;
    const itens = [];
    for(let R=info.R-rg.s.r; R<g.length; R++){ const r = g[R]||[]; const d = extData(r[cData-off]); if(!d) continue;
      const v = extNum(r[cVal-off]); if(isNaN(v)) continue;
      const man = cMan>=0 ? extLimpa(r[cMan-off]) : '';
      const cached = ws[XLSX.utils.encode_cell({r:R+rg.s.r, c:info.C})];
      // classificação digitada por cima da fórmula vale como ajuste manual (é ela que entra na DRE da planilha)
      const digitada = cached && !cached.f && cached.v != null ? extLimpa(cached.v) : '';
      itens.push({ d, p:partes.map(c=>r[c-off] ?? ''), v, m: digitada || man || null, ref: cached ? extLimpa(cached.v) : null }); }
    extChaves(banco, itens);
    out.itens.push(...itens);
    gRegras.forEach((r,k)=>{ if(k < 3) return; const p = r[cPad], c = r[cCls];
      if(p != null && String(p).trim() && c != null && String(c).trim()) out.regras.push({ b:banco, o:k, p:String(p).trim(), c:extLimpa(c) }); });
    out.abas.push({ nome, banco, linhas:itens.length });
  }
  if(!out.abas.length) throw new Error('Não achei abas de extrato com a fórmula de classificação (SEARCH nas REGRAS).');
  // de-para: classificação → linha da DRE
  const gDp = sheetGrid(wb,'DEPARA') || [];
  gDp.forEach((r,k)=>{ if(!k) return; const c=extLimpa(r[0]), d=extLimpa(r[1]); if(c && d) out.depara.push({ c, k:d }); });
  // histórico de saldos (fim de cada mês) e faturamento/rendimentos, para o painel continuar igual à planilha
  try{
    const ano = anoDaPlanilha(wb);
    const gBase = sheetGrid(wb,'Base Dash');
    const base = gBase ? parseBase(gBase) : baseGerencial(wb);
    const slot = { bb:'bb conta', sicredi:'sicredi conta', stone:'stone', cora:'cora' }, slotAp = { bb:'rende facil bb', sicredi:'aplicacao sicredi' };
    const nb = base.bancos || {}, bancosAbas = [...new Set(out.abas.map(a=>a.banco))];
    const quem = (chaveNb, natural) => nb[chaveNb] ? extBancoDaAba(nb[chaveNb]) : (gBase ? natural : bancosAbas[0]);
    const contas = [['bb conta','bb',quem('bb','bb')], ['sicredi conta','sic',quem('sic','sicredi')], ['stone','stone',quem('stone','stone')], ['cora','cora',quem('cora','cora')],
      ['rende facil bb','rende',quem('rende','bb')+'_aplic'], ['aplicacao sicredi','aplSic',quem('aplSic','sicredi')+'_aplic']];
    for(const [serie,, conta] of contas){ const s = base.series(serie); if(!s || !conta) continue;
      s.forEach((v,i)=>{ if(typeof v==='number') out.saldos.push({ conta, d:extFimMes(ano, i+1), s:v, o:'planilha' }); }); }
    const dre = parseDRE(sheetGrid(wb,'DRE FINANCEIRO') || sheetGrid(wb,'D.R.E Gerencial'));
    const fat = (dre.by('faturamento bruto')||{}).vals, rf = (dre.by('receita financeira')||{}).vals;
    for(let i=0;i<12;i++){ const f=fat?fat[i]:null, r=rf?rf[i]:null;
      if(f || r) out.meses.push({ mes:`${ano}-${String(i+1).padStart(2,'0')}`, f:f||null, r:r||null }); }
  }catch(e){ console.warn('saldos/meses da planilha:', e); }
  return out;
}

/* ---------- montar o painel a partir dos lançamentos ---------- */
const EXT_DESPESAS = ['despesas operacionais','despesas com pessoal','despesas administrativas','despesas comerciais','outras despesas'];
const EXT_ROTULO = { 'despesas operacionais':'Despesas Operacionais','despesas com pessoal':'Despesas com Pessoal','despesas administrativas':'Despesas Administrativas','despesas comerciais':'Despesas Comerciais','outras despesas':'Outras Despesas' };
const extEhAplic = cls => /aplica|resgat/i.test(cls || '');
function extProcessar(D){
  const regras = {}; for(const r of D.regras) (regras[r.b] = regras[r.b] || []).push(r);
  Object.values(regras).forEach(l=>l.sort((a,b)=>a.o-b.o));
  const dp = new Map(D.depara.map(x=>[extChaveClasse(x.c), x.k]));
  for(const l of D.lanc){ l.reg = l.m ? null : extRegraQuePega(l, regras[l.b]||[]); l.cls = l.m || (l.reg ? l.reg.c : null); l.cat = l.cls ? dp.get(extChaveClasse(l.cls)) : undefined; }
  const pend = D.lanc.filter(l=>!l.cls);
  const semCat = {}; for(const l of D.lanc) if(l.cls && l.cat===undefined){ const k=extChaveClasse(l.cls); (semCat[k] = semCat[k] || { classe:l.cls, n:0, total:0 }); semCat[k].n++; semCat[k].total += l.v; }
  return { regras, dp, pend, semCat:Object.values(semCat) };
}
function extMontarModelo(D){
  const P = extProcessar(D);
  if(!D.lanc.length) throw new Error('Ainda não há lançamentos importados.');
  const ultData = D.lanc.reduce((m,l)=>l.d>m?l.d:m, ''), ano = +ultData.slice(0,4), ultimo = +ultData.slice(5,7);
  const doAno = D.lanc.filter(l=>+l.d.slice(0,4)===ano);
  const z = () => Array(12).fill(0), mes = l => +l.d.slice(5,7) - 1;
  const cat = {}, kids = {}, extras = {};
  for(const l of doAno){ if(!l.cat) continue; const k = norm(l.cat); if(!k) continue;   // "//" fica fora da DRE
    (cat[k] = cat[k] || z())[mes(l)] += l.v;
    if(k==='despesas financeiras'){ const c = extChaveClasse(l.cls); (kids[c] = kids[c] || z())[mes(l)] += l.v; }
    if(!['receita bruta','deducoes impostos','deducoes','custos','despesas financeiras','distribuicao de dividendos','receitas nao operacionais','receita financeira',...EXT_DESPESAS].includes(k)) extras[k] = l.cat.replace(/^\(\s*[-−]\s*\)\s*/,''); }
  const C = k => cat[k] || z(), soma = (...a) => z().map((_,i)=>a.reduce((t,x)=>t+x[i],0));
  const meses = new Map(D.meses.map(x=>[x.m, x]));
  const fat = z().map((_,i)=>{ const x = meses.get(`${ano}-${String(i+1).padStart(2,'0')}`); return x && x.f ? x.f : 0; });
  const rf = soma(C('receita financeira'), z().map((_,i)=>{ const x = meses.get(`${ano}-${String(i+1).padStart(2,'0')}`); return x && x.r ? x.r : 0; }));
  const RB = C('receita bruta'), DED = soma(C('deducoes impostos'), C('deducoes')), CUS = C('custos'), MC = soma(RB, DED, CUS);
  const desp = EXT_DESPESAS.map(k=>[EXT_ROTULO[k], C(k)]).concat(Object.entries(extras).map(([k,r])=>[r, C(k)]));
  const FIN = C('despesas financeiras'), RO = soma(MC, ...desp.map(x=>x[1]), FIN), RNO = C('receitas nao operacionais');
  const RFIN = soma(RO, rf, RNO), DIV = C('distribuicao de dividendos'), RL = soma(RFIN, DIV);
  const linha = (r, v) => [r, ...v.map((x,i)=>i<ultimo ? Math.round(x*100)/100 : 0)];
  const grade = [['D.R.E', ...MESES], linha('Faturamento Bruto', fat), linha('Receita Bruta', RB), linha('Deduções (Impostos)', DED), linha('Custos', CUS),
    linha('(=) Margem de Contribuição', MC), ...desp.map(([r,v])=>linha(r,v)), linha('(-) Despesas Financeiras', FIN),
    ...Object.entries(kids).sort((a,b)=>a[1].reduce((t,x)=>t+x,0)-b[1].reduce((t,x)=>t+x,0)).map(([c,v])=>linha(c, v)),
    linha('(=) Resultado Operacional', RO), linha('Receita Financeira', rf), linha('Receitas Não Operacionais', RNO),
    linha('(=) Resultado Financeiro', RFIN), linha('(-) Distribuição de Dividendos', DIV), linha('Resultado Líquido', RL)];
  const dre = parseDRE(grade);

  // saldos: último saldo conhecido (extrato, planilha ou informado) + movimentos depois dele
  const movs = {};
  const add = (conta, d, v) => (movs[conta] = movs[conta] || []).push([d, v]);
  for(const l of D.lanc){ add(l.b, l.d, l.v); if(extEhAplic(l.cls)) add(l.b+'_aplic', l.d, -l.v); }
  const pref = {}; for(const [c, l] of Object.entries(movs)){ l.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0); let t=0; pref[c] = l.map(([d,v])=>[d, t+=v]); }
  const ate = (c, d) => { const l = pref[c]; if(!l || !l.length) return 0; let lo=0, hi=l.length-1, r=-1; while(lo<=hi){ const m=(lo+hi)>>1; if(l[m][0]<=d){ r=m; lo=m+1; } else hi=m-1; } return r<0 ? 0 : l[r][1]; };
  const pts = {}; for(const s of D.saldos) (pts[s.conta] = pts[s.conta] || []).push(s); Object.values(pts).forEach(l=>l.sort((a,b)=>a.d<b.d?-1:1));
  const saldoEm = (c, d) => { const l = pts[c] || [];
    let P = null; for(const x of l) if(x.d <= d) P = x;
    if(P) return P.s + ate(c, d) - ate(c, P.d);
    const Q = l.find(x=>x.d > d); if(Q) return Q.s - (ate(c, Q.d) - ate(c, d));
    return pref[c] ? ate(c, d) : null; };
  const serieSaldo = c => z().map((_,i)=> i<ultimo ? saldoEm(c, extFimMes(ano, i+1)) : null);
  // cada banco ocupa uma "vaga" do painel (BB, Sicredi, Stone, Cora); outros bancos usam vagas livres com o nome certo
  const bancos = [...new Set([...D.lanc.map(l=>l.b), ...D.saldos.map(s=>s.conta.replace(/_aplic$/,''))])];
  const vagas = { bb:null, sic:null, stone:null, cora:null }, natural = { bb:'bb', sicredi:'sic', stone:'stone', cora:'cora' }, nb = {};
  for(const b of bancos) if(natural[b] && !vagas[natural[b]]) vagas[natural[b]] = b;
  for(const b of bancos) if(!Object.values(vagas).includes(b)){ const v = Object.keys(vagas).find(k=>!vagas[k]); if(v){ vagas[v] = b; nb[v] = extNomeBanco(b); if(v==='bb') nb.rende = extNomeBanco(b); if(v==='sic') nb.aplSic = extNomeBanco(b); } }
  const S = {};
  if(vagas.bb){ S['bb conta'] = serieSaldo(vagas.bb); S['rende facil bb'] = pts[vagas.bb+'_aplic']||pref[vagas.bb+'_aplic'] ? serieSaldo(vagas.bb+'_aplic') : null; }
  if(vagas.sic){ S['sicredi conta'] = serieSaldo(vagas.sic); S['aplicacao sicredi'] = pts[vagas.sic+'_aplic']||pref[vagas.sic+'_aplic'] ? serieSaldo(vagas.sic+'_aplic') : null; }
  if(vagas.stone) S['stone'] = serieSaldo(vagas.stone);
  if(vagas.cora) S['cora'] = serieSaldo(vagas.cora);
  const aplic = z(), resg = z();
  for(const l of doAno) if(extEhAplic(l.cls)){ if(l.v < 0) aplic[mes(l)] += -l.v; else resg[mes(l)] += l.v; }
  S['aplicacoes totais'] = aplic; S['resgates totais'] = resg;
  const rendA = z().map((_,i)=>{ const x = meses.get(`${ano}-${String(i+1).padStart(2,'0')}`); return x && x.r ? x.r : 0; });
  if(S['aplicacao sicredi']) S['sicredi rendimento'] = rendA; else S['bb rendimento'] = rendA;
  // carteira de clientes (colada pelo consultor)
  const cart = {}, hoje = hojeISO();
  for(const x of D.carteira){ const nome = extNomeBanco(x.b), t = norm(x.c), a = cart[nome] = cart[nome] || [0,0,0];
    const k = /receb|pago|liquid|baixad|compens/.test(t) ? 0 : (/vencid|atras/.test(t) || (x.venc && x.venc < hoje)) ? 2 : 1; a[k] += x.v; }
  const base = { series:k=>S[k]||null, scalar:(k)=> k==='ultimo mes com lancamentos' ? ultimo : k==='mes selecionado dash' ? ultimo : null, cart, bancos:nb };
  const modelo = modeloDeGrades(dre, base, ano, extDataBR(ultData));
  return { modelo, P, ano, ultimo, ultData };
}

/* =====================================================================
   TELA (caixa "Extratos bancários" na página da empresa)
   ===================================================================== */
const EXT_CATEGORIAS = ['Receita Bruta','Deduções (Impostos)','Custos','Despesas Operacionais','Despesas com Pessoal','Despesas Administrativas',
  'Despesas Comerciais','Outras Despesas','(-) Despesas Financeiras','Receitas Não Operacionais','(-) Distribuição de Dividendos','//'];
st.ext = null;
const extApi = (acao, opts={}) => api(`extratos?empresa=${st.emp.id}${acao?'&acao='+acao:''}`, opts);
async function carregarExtratos(){
  st.ext = null;
  if(!st.emp || !st.emp.extratos){ $('extBox').hidden = true; return; }
  $('extBox').hidden = false;
  try{ const d = await extApi(''); st.ext = { D:{ lanc:d.lanc, regras:d.regras, depara:d.depara, saldos:d.saldos, meses:d.meses, carteira:d.carteira, imports:d.imports||[] } }; }
  catch(e){ falha(e); }
  desenharExtratos();
}
function extClasses(){ const D=st.ext.D; return [...new Set([...D.depara.map(x=>extLimpa(x.c)), ...D.regras.map(x=>extLimpa(x.c))])].sort((a,b)=>a.localeCompare(b,'pt-BR')); }
function desenharExtratos(){
  if(!st.ext) return;
  const D = st.ext.D, P = extProcessar(D); st.ext.P = P;
  const n = D.lanc.length, ds = D.lanc.map(l=>l.d).sort();
  $('extResumo').textContent = n ? `${n.toLocaleString('pt-BR')} lançamentos · ${extDataBR(ds[0])} a ${extDataBR(ds[ds.length-1])}${P.pend.length?` · ${P.pend.length} a classificar`:''}` : 'nenhum extrato importado';
  $('extDrop').classList.toggle('mini', n>0);
  // bancos
  const porB = {}; for(const l of D.lanc){ const x = porB[l.b] = porB[l.b] || { n:0, ini:l.d, fim:l.d }; x.n++; if(l.d<x.ini) x.ini=l.d; if(l.d>x.fim) x.fim=l.d; }
  $('extBancos').innerHTML = Object.entries(porB).map(([b,x])=>`<div class="extb"><b>${esc(extNomeBanco(b))}</b><span>${x.n.toLocaleString('pt-BR')} lançamentos</span><span>${extDataBR(x.ini)} a ${extDataBR(x.fim)}</span></div>`).join('')
    || '<div class="nodata">Arraste os extratos acima. Se a empresa já tem a planilha de conciliação, comece por "Importar planilha de referência": ela traz as regras, o de-para e o histórico.</div>';
  // a classificar
  const cls = extClasses(), lista = `<datalist id="extClsLista">${cls.map(c=>`<option value="${esc(c)}">`).join('')}</datalist>`;
  const pend = P.pend.slice().sort((a,b)=>b.d.localeCompare(a.d)).slice(0,150);
  $('extPend').innerHTML = (P.pend.length ? `<div class="extsub"><h4>A classificar <span>${P.pend.length} lançamento(s) sem regra · ficam fora da DRE até serem classificados</span></h4>
      <div class="cscroll"><table class="ctab extt"><thead><tr><th>Banco</th><th>Data</th><th>Lançamento</th><th class="cv2">Valor</th><th>Classificação</th><th>Criar regra com o texto</th><th></th></tr></thead><tbody>
      ${pend.map(l=>`<tr data-c="${esc(l.c)}"><td>${esc(extNomeBanco(l.b))}</td><td>${extDataBR(l.d)}</td><td class="extx" title="${esc(l.p)}">${esc(l.p)}</td><td class="${l.v<0?'neg':''}">${brl2(l.v)}</td>
        <td><input class="extcls" list="extClsLista" placeholder="escolha ou digite uma nova"></td><td><label class="extrg"><input type="checkbox" class="extmk" checked><input class="extpad" value="${esc(extSugerirPadrao(l))}"></label></td><td><button class="btn sm primary extok" type="button">Salvar</button></td></tr>`).join('')}
      </tbody></table></div>${lista}${P.pend.length>150?'<small class="hint">Mostrando os 150 mais recentes.</small>':''}</div>` : (n ? '<div class="ook">'+ICON.check+'<span>Todos os lançamentos estão classificados.</span></div>' : ''))
    + (P.semCat.length ? `<div class="extsub"><h4>Classificações sem linha da DRE <span>escolha onde cada uma entra no resultado ("//" = fora do resultado)</span></h4>
      <table class="ctab extt"><tbody>${P.semCat.map(x=>`<tr data-cls="${esc(x.classe)}"><td><b>${esc(x.classe)}</b></td><td>${x.n} lançamento(s) · ${brl2(x.total)}</td>
        <td><select class="extcat"><option value="">linha da DRE…</option>${EXT_CATEGORIAS.map(c=>`<option>${esc(c)}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>` : '');
  // faturamento e rendimentos por mês
  const ano = ds.length ? +ds[ds.length-1].slice(0,4) : new Date().getFullYear(), mesesM = new Map(D.meses.map(x=>[x.m,x]));
  $('extMeses').innerHTML = `<table class="ctab extt"><thead><tr><th>Mês</th><th class="cv2">Faturamento bruto (R$)</th><th class="cv2">Rendimentos das aplicações (R$)</th></tr></thead><tbody>
    ${MESES.map((m,i)=>{ const k=`${ano}-${String(i+1).padStart(2,'0')}`, x=mesesM.get(k)||{}; return `<tr data-m="${k}"><td>${m}/${ano}</td><td class="cv2"><input inputmode="decimal" data-f value="${x.f!=null?brl2(x.f):''}" placeholder="0,00"></td><td class="cv2"><input inputmode="decimal" data-r value="${x.r!=null?brl2(x.r):''}" placeholder="0,00"></td></tr>`; }).join('')}
    </tbody></table><small class="hint">O faturamento (notas emitidas) e os rendimentos das aplicações não vêm no extrato da conta corrente. Cada alteração salva sozinha.</small>`;
  // saldos iniciais
  const contas = [...new Set([...Object.keys(porB), ...D.saldos.map(s=>s.conta.replace(/_aplic$/,''))])].flatMap(b=>['bb','sicredi'].includes(b) ? [b, b+'_aplic'] : [b]);
  const ini = `${ano-1}-12-31`;
  $('extSaldos').innerHTML = `<table class="ctab extt"><thead><tr><th>Conta</th><th class="cd2">Data</th><th class="cv2">Saldo (R$)</th><th>Saldos já conhecidos</th></tr></thead><tbody>
    ${contas.map(c=>{ const pts = D.saldos.filter(s=>s.conta===c); const man = pts.filter(s=>s.o==='manual').sort((a,b)=>a.d<b.d?-1:1)[0];
      const nome = c.endsWith('_aplic') ? extNomeBanco(c.replace(/_aplic$/,''))+' · aplicação' : extNomeBanco(c)+' · conta';
      return `<tr data-conta="${esc(c)}"><td>${esc(nome)}</td><td class="cd2"><input type="date" data-d value="${man?man.d:ini}"></td><td class="cv2"><input inputmode="decimal" data-s value="${man?brl2(man.s):''}" placeholder="0,00"></td>
        <td><small class="hint" style="margin:0">${pts.length ? `${pts.length} (último: ${extDataBR(pts[pts.length-1].d)} · ${brl2(pts[pts.length-1].s)})` : 'nenhum: informe o saldo inicial'}</small></td></tr>`; }).join('') || '<tr><td colspan="4">Importe um extrato primeiro.</td></tr>'}
    </tbody></table><small class="hint">O saldo de cada fim de mês parte do último saldo conhecido (do extrato, da planilha ou informado aqui) e soma os lançamentos depois dele. BB, Sicredi e Stone já trazem o saldo no próprio extrato; a Cora não.</small>`;
  // carteira de clientes
  const porCart = {}; D.carteira.forEach(x=>{ const t = porCart[x.b] = porCart[x.b] || { n:0, v:0 }; t.n++; t.v += x.v; });
  $('extCartBanco').innerHTML = [...new Set([...Object.keys(porB), 'bb','cora','stone','sicredi'])].map(b=>`<option value="${b}">${esc(extNomeBanco(b))}</option>`).join('');
  $('extCartInfo').textContent = Object.keys(porCart).length ? 'Carteira atual: ' + Object.entries(porCart).map(([b,x])=>`${extNomeBanco(b)} ${x.n} título(s) · ${curto(x.v)}`).join(' · ') : 'Nenhuma carteira colada ainda.';
}
function extSugerirPadrao(l){ const partes = l.p.split(' | ').filter(Boolean); const nome = partes.length > 1 ? partes[partes.length-1] : partes[0] || '';
  return extLimpa(nome.replace(/\b\d{2}\/\d{2}( \d{2}:\d{2})?\b/g,'').replace(/\b\d{8,}\b/g,'')).slice(0,60); }

// salvar classificação de um lançamento (com ou sem regra nova)
$('extPend').addEventListener('click', async e=>{
  const b = e.target.closest('.extok'); if(!b) return;
  const tr = b.closest('tr'), l = st.ext.D.lanc.find(x=>x.c===tr.dataset.c); if(!l) return;
  const digitada = extLimpa(tr.querySelector('.extcls').value); if(!digitada) return toast('Escolha ou digite a classificação.');
  const classe = extClasses().find(c=>extChaveClasse(c)===extChaveClasse(digitada)) || digitada.toUpperCase();
  const regra = tr.querySelector('.extmk').checked, padrao = extLimpa(tr.querySelector('.extpad').value);
  b.disabled = true;
  try{
    if(regra){ if(!padrao) throw new Error('Escreva o texto da regra.');
      if(!extPadrao(padrao).test(extTextoRegra(l))) throw new Error('Esse texto não aparece no lançamento: a regra não pegaria ele.');
      await extApi('regra', {method:'POST', body:{ b:l.b, p:padrao, c:classe }}); st.ext.D.regras.push({ b:l.b, o:-1e9+st.ext.D.regras.length, p:padrao, c:classe });
      const agora = extProcessar(st.ext.D).pend.length; toast(`Regra criada. ${P0(st.ext.P.pend.length - agora)} lançamento(s) classificados.`); }
    else { await extApi('manual', {method:'PUT', body:{ chaves:[l.c], classe, texto:`${extNomeBanco(l.b)} ${extDataBR(l.d)} ${l.p} ${brl2(l.v)}` }}); l.m = classe; toast('Lançamento classificado'); }
    extMarcarDesatualizado(); desenharExtratos();
  }catch(err){ falha(err); b.disabled = false; }
});
const P0 = n => Math.max(0, n);
$('extPend').addEventListener('change', async e=>{
  const s = e.target.closest('.extcat'); if(!s || !s.value) return;
  const classe = s.closest('tr').dataset.cls;
  try{ await extApi('depara', {method:'PUT', body:{ classe, categoria:s.value }}); st.ext.D.depara.push({ c:classe, k:s.value }); extMarcarDesatualizado(); desenharExtratos(); toast(`${classe} → ${s.value}`); }
  catch(err){ falha(err); }
});
$('extMeses').addEventListener('change', async e=>{
  const tr = e.target.closest('tr[data-m]'); if(!tr) return;
  const f = tr.querySelector('[data-f]').value.trim(), r = tr.querySelector('[data-r]').value.trim();
  const fv = f ? lerValor(f) : '', rv = r ? lerValor(r) : '';
  if(Number.isNaN(fv) || Number.isNaN(rv)) return toast('Valor inválido. Use por exemplo 1.234,56');
  try{ await extApi('mes', {method:'PUT', body:{ mes:tr.dataset.m, faturamento:fv, rendimento:rv }});
    const D = st.ext.D, x = D.meses.find(m=>m.m===tr.dataset.m); if(x){ x.f = fv===''?null:fv; x.r = rv===''?null:rv; } else D.meses.push({ m:tr.dataset.m, f:fv===''?null:fv, r:rv===''?null:rv });
    extMarcarDesatualizado(); toast('Salvo'); }
  catch(err){ falha(err); }
});
$('extSaldos').addEventListener('change', async e=>{
  const tr = e.target.closest('tr[data-conta]'); if(!tr) return;
  const d = tr.querySelector('[data-d]').value, sv = tr.querySelector('[data-s]').value.trim();
  if(!d) return; const s = sv ? lerValor(sv) : '';
  if(Number.isNaN(s)) return toast('Valor inválido. Use por exemplo 1.234,56');
  try{ await extApi('saldo', {method:'PUT', body:{ conta:tr.dataset.conta, d, s }});
    const D = st.ext.D; D.saldos = D.saldos.filter(x=>!(x.conta===tr.dataset.conta && x.d===d)); if(s!=='') D.saldos.push({ conta:tr.dataset.conta, d, s, o:'manual' });
    extMarcarDesatualizado(); desenharExtratos(); toast('Saldo salvo'); }
  catch(err){ falha(err); }
});
$('bExtCart').onclick = async () => {
  const banco = $('extCartBanco').value, linhas = $('extCartTxt').value.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const itens = [];
  for(const l of linhas){ const c = l.includes('\t') ? l.split('\t') : l.split(';'); if(c.length < 4) continue;
    const v = extNum(c[3]); if(isNaN(v) || /^nome$/i.test(extLimpa(c[0]))) continue;
    itens.push({ n:extLimpa(c[0]), c:extLimpa(c[1]), venc:extData(c[2]), v }); }
  if(!itens.length) return toast('Não achei linhas no formato: nome, classificação, vencimento, valor (colunas copiadas do Excel).');
  try{ await extApi('carteira', {method:'POST', body:{ banco, itens }}); st.ext.D.carteira = st.ext.D.carteira.filter(x=>x.b!==banco).concat(itens.map(i=>({ b:banco, n:i.n, c:i.c, venc:i.venc, v:i.v })));
    $('extCartTxt').value=''; extMarcarDesatualizado(); desenharExtratos(); toast(`${itens.length} título(s) de ${extNomeBanco(banco)} salvos`); }
  catch(err){ falha(err); }
};

// importar extratos (vários arquivos de uma vez)
// efeito de uma importação: o que entrou (por classificação) e o que mudou no painel (antes → depois)
const EXT_CONTAS_ROT = { bb:'BB · conta', rende:'BB · aplicação', sic:'Sicredi · conta', aplSic:'Sicredi · aplicação', stone:'Stone', cora:'Cora' };
function extRotuloConta(k, nb){ nb = nb || {}; const base = { bb:nb.bb, rende:nb.rende, sic:nb.sic, aplSic:nb.aplSic, stone:nb.stone, cora:nb.cora }[k];
  if(!base) return EXT_CONTAS_ROT[k]; return k==='rende'||k==='aplSic' ? base+' · aplicação' : (k==='bb'||k==='sic' ? base+' · conta' : base); }
function extImpacto(M0, M1, novos){
  const porCls = {};
  for(const l of novos){ const k = l.cls || 'A CLASSIFICAR';
    const x = porCls[k] = porCls[k] || { classe:k, cat: l.cls ? (l.cat===undefined ? '(sem linha da DRE)' : (norm(l.cat) ? l.cat : 'fora da DRE (//)')) : '—', n:0, total:0 };
    x.n++; x.total = Math.round((x.total + l.v)*100)/100; }
  const dre = [], saldos = [];
  if(M1){ const mesmo = M0 && M0.ano === M1.ano;
    const vistos = new Set();
    for(const r of M1.modelo.dre.rows){ if(vistos.has(r.key)) continue; vistos.add(r.key);
      const a = mesmo ? (M0.modelo.dre.by(r.key)||{}).vals || Array(12).fill(0) : Array(12).fill(0);
      r.vals.forEach((v,i)=>{ const d = v - (a[i]||0); if(Math.abs(d) > 0.005) dre.push([r.label, i+1, Math.round((a[i]||0)*100)/100, Math.round(v*100)/100]); }); }
    for(const k of Object.keys(EXT_CONTAS_ROT)){ const b1 = M1.modelo.contas[k]; if(!b1) continue; const b0 = mesmo ? M0.modelo.contas[k] || [] : [];
      b1.forEach((v,i)=>{ if(v==null) return; const a = b0[i]; if(a==null || Math.abs(v-a) > 0.005) saldos.push([extRotuloConta(k, M1.modelo.bancos), i+1, a==null?null:Math.round(a*100)/100, Math.round(v*100)/100]); }); } }
  return { porClasse:Object.values(porCls).sort((a,b)=>a.total-b.total), dre, saldos, ano: M1 ? M1.ano : null };
}
// importar extratos (vários arquivos de uma vez); cada arquivo vira uma linha do log com o efeito no painel
let extFila = Promise.resolve();
function extImportarArquivos(files){ extFila = extFila.then(()=>extImportarAgora(files)); return extFila; }
async function extImportarAgora(files){
  if(!files.length || !st.emp || !st.ext) return;
  $('extDrop').classList.add('busy'); const res = []; let ultimoImp = null;
  try{
    for(const f of files){
      if(await extEhPlanilhaReferencia(f)){ await extImportarPlanilha(f); continue; }
      const x = await extLerArquivo(f), D = st.ext.D, existentes = new Set(D.lanc.map(l=>l.c));
      if(!D.regras.some(r=>r.b===x.banco) && !await confirmar(`Nenhuma regra do ${extNomeBanco(x.banco)} nesta empresa`,
        `Esta empresa ainda não tem as regras de classificação do ${extNomeBanco(x.banco)} (elas vêm da planilha de referência). Se importar "${f.name}" agora, tudo entra como "A classificar". O melhor é clicar em "Importar planilha de referência" antes. Importar mesmo assim?`, 'Importar mesmo assim')){ res.push(`${f.name}: não importado`); continue; }
      const novos = x.itens.filter(i=>!existentes.has(i.c)).map(i=>({ c:i.c, b:i.b, d:i.d, p:i.p, v:i.v, m:null }));
      const sal = x.saldos.map(s=>({ ...s, o:'extrato' }));
      let M0 = null, M1 = null; try{ if(D.lanc.length) M0 = extMontarModelo(D); }catch(e){}
      const D1 = { ...D, lanc:D.lanc.concat(novos), saldos:D.saldos.filter(s=>!sal.some(n=>n.conta===s.conta && n.d===s.d)).concat(sal) };
      try{ M1 = extMontarModelo(D1); }catch(e){}
      const detalhe = extImpacto(M0, M1, novos);
      const r = await extApi('lancamentos', {method:'POST', body:{ itens:x.itens.map(i=>({ c:i.c, b:i.b, d:i.d, p:i.p, v:i.v })), saldos:sal, log:{ tipo:'extrato', arquivo:f.name, banco:x.banco, detalhe } }});
      novos.forEach(l=>{ l.i = r.importId; }); D.lanc = D1.lanc; D.saldos = D1.saldos; ultimoImp = r.importId;
      res.push(`${extNomeBanco(x.banco)}: ${r.novos} novo(s)${r.repetidos?`, ${r.repetidos} já importado(s)`:''}`);
    }
    if(res.length){
      toast(res.join(' · '));
      await carregarExtratos(); await extGerarPainel(true);
      if(ultimoImp) extAbrirPlanilha({ aba:'log', imp:ultimoImp }); }
  }catch(err){ falha(err); }
  $('extDrop').classList.remove('busy'); $('extFile').value='';
}
$('extDrop').onclick = () => $('extFile').click();
$('extFile').onchange = e => extImportarArquivos([...e.target.files]);
['dragover','dragenter'].forEach(t=>$('extDrop').addEventListener(t, e=>{ e.preventDefault(); $('extDrop').classList.add('over'); }));
['dragleave','drop'].forEach(t=>$('extDrop').addEventListener(t, e=>{ e.preventDefault(); if(t==='drop') e.stopPropagation(); $('extDrop').classList.remove('over'); }));
$('extDrop').addEventListener('drop', e=>{ e.stopPropagation(); $('drop').classList.remove('over'); extImportarArquivos([...e.dataTransfer.files]); });

// importar a planilha de conciliação (regras, de-para, histórico, saldos, faturamento)
$('bExtPlan').onclick = () => $('extPlan').click();
$('extPlan').onchange = e => { const f = e.target.files[0]; e.target.value=''; if(f) extFila = extFila.then(()=>extImportarPlanilha(f)); };
async function extEhPlanilhaReferencia(f){
  if(!/\.xls[xbm]?$/i.test(f.name)) return false;
  try{ await carregarXLSX(); const wb = XLSX.read(await f.arrayBuffer(), {type:'array', bookSheets:true});
    return wb.SheetNames.some(n=>norm(n)==='regras'); }catch(e){ return false; }
}
async function extImportarPlanilha(f){
  if(!await confirmar('Importar a planilha de referência?', 'As regras e o de-para da empresa serão substituídos pelos da planilha, e os lançamentos dela entram no histórico (os que já existem não duplicam).', 'Importar')) return;
  $('bExtPlan').disabled = true; toast('Lendo a planilha…');
  try{
    await carregarXLSX();
    const P = extLerPlanilha(XLSX.read(await f.arrayBuffer(), {type:'array', cellFormula:true}));
    await extApi('config', {method:'POST', body:{ regras:P.regras, depara:P.depara, origem:f.name }});
    const r = await extApi('lancamentos', {method:'POST', body:{ itens:P.itens.map(i=>({ c:i.c, b:i.b, d:i.d, p:i.p, v:i.v, m:i.m })), saldos:P.saldos, manualPrevalece:true,
      log:{ tipo:'planilha', arquivo:f.name, banco:P.abas.map(a=>a.banco).join(','), detalhe:{ abas:P.abas, regras:P.regras.length, depara:P.depara.length, saldos:P.saldos.length, meses:P.meses.length } } }});
    for(const m of P.meses) await extApi('mes', {method:'PUT', body:{ mes:m.mes, faturamento:m.f ?? '', rendimento:m.r ?? '', semLog:true }});
    toast(`Planilha importada: ${P.regras.length} regras, ${P.depara.length} classificações, ${r.novos.toLocaleString('pt-BR')} lançamentos novos (${P.abas.map(a=>extNomeBanco(a.banco)).join(', ')})`);
    await carregarExtratos(); await extGerarPainel(true);
  }catch(err){ falha(err); }
  $('bExtPlan').disabled = false;
}

// gerar o painel a partir dos lançamentos
function extMarcarDesatualizado(){ $('bExtGerar').classList.add('pulsa'); $('bExtGerar').textContent = 'Atualizar painel'; }
async function extGerarPainel(auto){
  if(!st.ext || !st.ext.D.lanc.length) return auto ? null : toast('Importe os extratos primeiro.');
  try{
    const D = st.ext.D, M = extMontarModelo(D), pend = M.P.pend.length;
    const falta = !D.regras.length ? 'a empresa ainda não tem regras de classificação (importe a planilha de referência)'
      : !D.depara.length ? 'a empresa ainda não tem o de-para das classificações (importe a planilha de referência)'
      : pend > Math.max(20, D.lanc.length * 0.1) ? `${pend.toLocaleString('pt-BR')} de ${D.lanc.length.toLocaleString('pt-BR')} lançamentos estão sem classificação` : '';
    if(falta){
      if(auto){ toast(`O painel NÃO foi atualizado: ${falta}.`); $('bExtGerar').classList.add('pulsa'); return null; }
      if(!await confirmar('Atualizar o painel mesmo assim?', `Atenção: ${falta}. O painel publicado vai ser substituído por um com esses dados incompletos.`, 'Atualizar mesmo assim')) return null;
    }
    const modelo = serializeModel(M.modelo);
    const rel = await api('relatorios', {method:'POST', body:{ empresaId:st.emp.id, arquivo:`Extratos até ${extDataBR(M.ultData)}`, modelo }});
    st.cache.set(rel.id, {...rel, modelo}); st.relId = rel.id; st.m = null; st.rendered = null;
    await carregarHistorico(); st.emp = await api('empresas?id='+st.emp.id); cabecalho();
    $('bExtGerar').classList.remove('pulsa');
    toast(`Painel atualizado até ${extDataBR(M.ultData)}${M.P.pend.length ? ` · ${M.P.pend.length} lançamento(s) a classificar ficaram fora` : ''}`);
  }catch(err){ falha(err); }
}
$('bExtGerar').onclick = () => extGerarPainel(false);

/* =====================================================================
   PLANILHA DA EMPRESA ("Excel" embutido): log, extratos, regras, de-para, resumos, DRE, saldos…
   Mostra o que cada importação trouxe e como foi classificado; baixa tudo em .xlsx.
   ===================================================================== */
const xlLetra = i => { let s=''; i++; while(i>0){ const r=(i-1)%26; s=String.fromCharCode(65+r)+s; i=Math.floor((i-1)/26); } return s; };
const XL = { abas:[], aba:null, imp:null, soNovo:false, busca:'' };
function extAbasPlanilha(){
  const D = st.ext.D, P = extProcessar(D); let M = null; try{ if(D.lanc.length) M = extMontarModelo(D); }catch(e){}
  const imps = new Map((D.imports||[]).map(x=>[x.id, x]));
  const quando = iso => iso ? new Date(iso).toLocaleString('pt-BR',{dateStyle:'short', timeStyle:'short'}) : '';
  const abas = [];
  abas.push({ id:'log', nome:'Log', cols:[{t:'Data e hora',w:130},{t:'Tipo',w:80},{t:'Arquivo / o que foi feito',w:420},{t:'Banco',w:110},{t:'Período',w:170},{t:'Recebidos',w:80,k:'int'},{t:'Novos',w:70,k:'int'},{t:'Já importados',w:95,k:'int'},{t:'Situação',w:90}],
    rows:(D.imports||[]).map(x=>[quando(x.criado), x.tipo==='extrato'?'Extrato':x.tipo==='planilha'?'Planilha':'Ajuste', x.arquivo||'', (x.banco||'').split(',').map(extNomeBanco).join(', '),
      x.ini ? `${extDataBR(x.ini)} a ${extDataBR(x.fim)}` : '', x.recebidos, x.novos, x.repetidos, x.desfeito ? 'desfeita' : '']), meta:(D.imports||[]).map(x=>x.id) });
  const bancos = [...new Set(D.lanc.map(l=>l.b))];
  for(const b of bancos){
    const ls = D.lanc.filter(l=>l.b===b).sort((x,y)=>y.d.localeCompare(x.d) || x.c.localeCompare(y.c));
    abas.push({ id:'ext_'+b, nome:'Extrato '+extNomeBanco(b), soma:2,
      cols:[{t:'Data',w:88,k:'data'},{t:'Lançamento',w:390},{t:'Valor (R$)',w:110,k:'num'},{t:'Classificação',w:190},{t:'Como foi classificado',w:250},{t:'Linha da DRE',w:200},{t:'Mês',w:48,k:'int'},{t:'Importado por',w:280}],
      rows:ls.map(l=>{ const im = imps.get(l.i);
        return [l.d, l.p, l.v, l.cls || 'A CLASSIFICAR', l.m ? 'ajuste manual' : l.reg ? `regra: "${l.reg.p}"` : 'nenhuma regra pegou', l.cls ? (l.cat===undefined ? '(sem linha da DRE)' : (norm(l.cat) ? l.cat : 'fora da DRE (//)')) : '—',
          +l.d.slice(5,7), im ? `${im.arquivo||''} · ${quando(im.criado)}` : 'antes do log']; }),
      meta:ls.map(l=>l.i||null), alerta:ls.map(l=>!l.cls) });
  }
  const usoRegra = new Map(); for(const l of D.lanc) if(l.reg) usoRegra.set(l.reg, (usoRegra.get(l.reg)||0)+1);
  const regras = D.regras.slice().sort((a,b)=>a.b.localeCompare(b.b) || a.o-b.o);
  abas.push({ id:'regras', nome:'REGRAS', cols:[{t:'Banco',w:110},{t:'Ordem',w:60,k:'int'},{t:'Palavra-chave (* = qualquer texto)',w:320},{t:'Classificação',w:220},{t:'Lançamentos que ela pega',w:170,k:'int'}],
    rows:regras.map((r,i)=>[extNomeBanco(r.b), regras.filter(x=>x.b===r.b).indexOf(r)+1, r.p, r.c, usoRegra.get(r)||0]) });
  const porCls = {}; for(const l of D.lanc) if(l.cls){ const k=extChaveClasse(l.cls); const x=porCls[k]=porCls[k]||{n:0,t:0}; x.n++; x.t+=l.v; }
  const classes = [...new Set([...D.depara.map(x=>extChaveClasse(x.c)), ...Object.keys(porCls)])].sort();
  const dpm = new Map(D.depara.map(x=>[extChaveClasse(x.c), x.k]));
  abas.push({ id:'depara', nome:'DEPARA', soma:3, cols:[{t:'Classificação (DE)',w:240},{t:'Linha da DRE (PARA)',w:240},{t:'Lançamentos',w:100,k:'int'},{t:'Total (R$)',w:130,k:'num'}],
    rows:classes.map(c=>[c, dpm.get(c) ?? '(sem linha da DRE)', (porCls[c]||{}).n||0, Math.round(((porCls[c]||{}).t||0)*100)/100]), alerta:classes.map(c=>!dpm.has(c)) });
  if(M){
    const ano = M.ano, res = {};
    for(const l of D.lanc){ if(+l.d.slice(0,4)!==ano) continue; const k = l.cls ? extChaveClasse(l.cls) : 'A CLASSIFICAR'; (res[k] = res[k] || Array(12).fill(0))[+l.d.slice(5,7)-1] += l.v; }
    const meses = MESES.map(m=>({t:`${m}/${String(ano).slice(2)}`, w:96, k:'num'}));
    abas.push({ id:'resumos', nome:'RESUMOS', cols:[{t:'Classificação',w:230},{t:'Linha da DRE',w:200},...meses,{t:'Total',w:110,k:'num'}],
      rows:Object.entries(res).sort((a,b)=>a[0].localeCompare(b[0])).map(([k,v])=>[k, k==='A CLASSIFICAR' ? '—' : (dpm.get(k) ?? '(sem linha da DRE)'), ...v.map(x=>Math.round(x*100)/100), Math.round(v.reduce((t,x)=>t+x,0)*100)/100]) });
    abas.push({ id:'dre', nome:'DRE', cols:[{t:`D.R.E ${ano}`,w:260},...meses,{t:'Total',w:110,k:'num'}],
      rows:M.modelo.dre.rows.map(r=>[r.label, ...r.vals.map((x,i)=>i<M.ultimo?Math.round(x*100)/100:null), Math.round(r.vals.slice(0,M.ultimo).reduce((t,x)=>t+x,0)*100)/100]), estilo:M.modelo.dre.rows.map(r=>r.type) });
    abas.push({ id:'saldos', nome:'Saldos', cols:[{t:'Conta · saldo no fim do mês',w:230},...meses],
      rows:Object.keys(EXT_CONTAS_ROT).filter(k=>M.modelo.contas[k] && M.modelo.contas[k].some(v=>v!=null && Math.abs(v)>0.005)).map(k=>[extRotuloConta(k, M.modelo.bancos), ...M.modelo.contas[k].map(v=>v==null?null:Math.round(v*100)/100)]) });
  }
  abas.push({ id:'fat', nome:'Faturamento', cols:[{t:'Mês',w:100},{t:'Faturamento bruto (R$)',w:170,k:'num'},{t:'Rendimentos das aplicações (R$)',w:210,k:'num'}],
    rows:D.meses.slice().sort((a,b)=>a.m.localeCompare(b.m)).map(x=>[`${x.m.slice(5)}/${x.m.slice(0,4)}`, x.f, x.r]) });
  abas.push({ id:'carteira', nome:'Carteira', soma:4, cols:[{t:'Banco',w:100},{t:'Nome',w:320},{t:'Classificação',w:160},{t:'Vencimento',w:100,k:'data'},{t:'Valor (R$)',w:120,k:'num'}],
    rows:D.carteira.map(x=>[extNomeBanco(x.b), x.n, x.c, x.venc, x.v]) });
  return abas;
}
function extAbrirPlanilha(op={}){
  if(!st.ext) return;
  let w = $('xlWin');
  if(!w){ w = document.createElement('div'); w.id='xlWin'; w.className='xlwin'; document.body.append(w);
    w.innerHTML = `<div class="xltop"><div class="xltit"><b id="xlTit"></b><span id="xlSub"></span></div>
      <input type="search" id="xlBusca" placeholder="Procurar nesta aba" autocomplete="off">
      <label class="xlnovo" title="Mostra só os lançamentos da importação selecionada no Log"><input type="checkbox" id="xlSoNovo"> Só a importação selecionada</label>
      <button class="btn sm" id="xlBaixar" type="button">Baixar .xlsx</button><button class="xfech" id="xlFechar" type="button" aria-label="Fechar">×</button></div>
      <div class="xlbody" id="xlBody"></div><div class="xlstatus" id="xlStatus"></div><div class="xltabs" id="xlTabs"></div>`;
    $('xlFechar').onclick = () => { w.hidden = true; document.body.classList.remove('xl-aberta'); };
    document.addEventListener('keydown', e=>{ if(e.key==='Escape' && !w.hidden && !document.querySelector('.modal:not([hidden])')) $('xlFechar').click(); });
    $('xlBusca').addEventListener('input', e=>{ XL.busca = norm(e.target.value); xlDesenhar(); });
    $('xlSoNovo').addEventListener('change', e=>{ XL.soNovo = e.target.checked; xlDesenhar(); });
    $('xlBaixar').onclick = xlBaixar;
    $('xlTabs').addEventListener('click', e=>{ const t=e.target.closest('[data-aba]'); if(!t) return; XL.aba = t.dataset.aba; XL.busca=''; $('xlBusca').value=''; XL.soNovo=false; $('xlSoNovo').checked=false; xlDesenhar(); });
  }
  XL.abas = extAbasPlanilha();
  if(op.imp !== undefined) XL.imp = op.imp;
  XL.aba = op.aba || XL.aba || 'log'; if(!XL.abas.some(a=>a.id===XL.aba)) XL.aba = 'log';
  XL.soNovo = !!op.soNovo; $('xlSoNovo').checked = XL.soNovo; XL.busca = ''; $('xlBusca').value = '';
  $('xlTit').textContent = 'Planilha · ' + st.emp.nome;
  const D = st.ext.D; $('xlSub').textContent = `${D.lanc.length.toLocaleString('pt-BR')} lançamentos · ${(D.imports||[]).filter(x=>x.tipo!=='ajuste').length} importação(ões)`;
  w.hidden = false; document.body.classList.add('xl-aberta'); xlDesenhar();
}
function xlDesenhar(){
  const aba = XL.abas.find(a=>a.id===XL.aba); if(!aba) return;
  $('xlTabs').innerHTML = XL.abas.map(a=>`<button type="button" class="xltab${a.id===XL.aba?' on':''}" data-aba="${a.id}">${esc(a.nome)}</button>`).join('');
  $('xlSoNovo').parentElement.style.visibility = aba.id.startsWith('ext_') && XL.imp ? 'visible' : 'hidden';
  if(aba.id==='log') return xlLog(aba);
  let idx = aba.rows.map((_,i)=>i);
  if(XL.soNovo && XL.imp && aba.meta) idx = idx.filter(i=>aba.meta[i]===XL.imp);
  if(XL.busca){ const txt = aba.rows.map(r=>norm(r.map(x=>x==null?'':typeof x==='number'?brl2(x):String(x)).join(' '))); idx = idx.filter(i=>txt[i].includes(XL.busca)); }
  xlGrade($('xlBody'), aba, idx);
  const soma = aba.soma!=null ? idx.reduce((t,i)=>t+(+aba.rows[i][aba.soma]||0),0) : null;
  $('xlStatus').textContent = `${idx.length.toLocaleString('pt-BR')} de ${aba.rows.length.toLocaleString('pt-BR')} linha(s)` + (soma!=null ? ` · Soma de "${aba.cols[aba.soma].t}": ${brl(soma)}` : '')
    + (aba.meta && XL.imp && aba.meta.includes(XL.imp) ? ` · em amarelo: lançamentos da importação selecionada no Log` : '');
}
function xlCelula(v, c){
  if(v==null || v==='') return '<td></td>';
  if(c.k==='num'){ const n=+v; return `<td class="n${n<0?' neg':''}">${brl2(n)}</td>`; }
  if(c.k==='int') return `<td class="n">${(+v).toLocaleString('pt-BR')}</td>`;
  if(c.k==='data') return `<td>${extDataBR(v)}</td>`;
  return `<td title="${esc(v)}">${esc(v)}</td>`;
}
function xlGrade(box, aba, idx){
  const RH = 26;
  box.innerHTML = `<div class="xgscroll"><table class="xg"><colgroup><col style="width:52px">${aba.cols.map(c=>`<col style="width:${c.w}px">`).join('')}</colgroup>
    <thead><tr class="xgl"><th></th>${aba.cols.map((_,i)=>`<th>${xlLetra(i)}</th>`).join('')}</tr>
    <tr class="xgn"><th>1</th>${aba.cols.map(c=>`<th class="${c.k==='num'||c.k==='int'?'n':''}">${esc(c.t)}</th>`).join('')}</tr></thead><tbody></tbody></table></div>`;
  const sc = box.querySelector('.xgscroll'), tb = box.querySelector('tbody'), ncol = aba.cols.length + 1;
  let ultimo = '';
  const pintar = () => {
    const ini = Math.max(0, Math.floor(sc.scrollTop/RH) - 15), fim = Math.min(idx.length, ini + Math.ceil(sc.clientHeight/RH) + 30), chave = ini+':'+fim;
    if(chave === ultimo) return; ultimo = chave;
    let h = ini ? `<tr style="height:${ini*RH}px"><td colspan="${ncol}"></td></tr>` : '';
    for(let k=ini; k<fim; k++){ const i = idx[k], r = aba.rows[i];
      const cls = [aba.meta && XL.imp && aba.meta[i]===XL.imp ? 'novo' : '', aba.alerta && aba.alerta[i] ? 'alerta' : '', aba.estilo && aba.estilo[i]!=='sub' && aba.estilo[i]!=='sub2' ? 'dre-total' : ''].join(' ');
      h += `<tr class="${cls}"><th>${i+2}</th>${r.map((v,j)=>xlCelula(v, aba.cols[j])).join('')}</tr>`; }
    if(fim < idx.length) h += `<tr style="height:${(idx.length-fim)*RH}px"><td colspan="${ncol}"></td></tr>`;
    tb.innerHTML = h || `<tr><td colspan="${ncol}" class="xlvazio">Nada para mostrar.</td></tr>`;
  };
  sc.addEventListener('scroll', ()=>requestAnimationFrame(pintar)); pintar();
  new ResizeObserver(()=>{ ultimo=''; pintar(); }).observe(sc);
}
// aba Log: lista de importações/ajustes e o detalhe da selecionada (o que subiu e o efeito no painel)
function xlLog(aba){
  const D = st.ext.D, imps = D.imports || [], sel = imps.find(x=>x.id===XL.imp);
  const tipoTag = x => `<span class="xltag ${x.tipo}">${x.tipo==='extrato'?'Extrato':x.tipo==='planilha'?'Planilha':'Ajuste'}</span>`;
  const quando = iso => new Date(iso).toLocaleString('pt-BR',{dateStyle:'short', timeStyle:'short'});
  const mesN = (ano, m) => `${MESES[m-1]}/${String(ano||'').slice(2)}`;
  let det = '';
  if(sel){
    const d = sel.detalhe || {}, banco = (sel.banco||'').split(',').filter(Boolean);
    const tab = (cab, linhas) => linhas.length ? `<table class="xlmini"><tr>${cab.map(c=>`<th>${c}</th>`).join('')}</tr>${linhas.join('')}</table>` : '<div class="xlvazio">Nada mudou.</div>';
    const dif = (a, b) => { const x = (b||0) - (a||0); return `<td class="n ${x<0?'neg':'pos'}">${x>0?'+':''}${brl2(x)}</td>`; };
    det = `<div class="xldet"><div class="xldh"><div>${tipoTag(sel)} <b>${esc(sel.arquivo||'')}</b>${sel.desfeito?' <span class="xltag desfeito">desfeita</span>':''}
        <div class="xldm">${quando(sel.criado)}${banco.length?' · '+banco.map(extNomeBanco).join(', '):''}${sel.ini?` · lançamentos de ${extDataBR(sel.ini)} a ${extDataBR(sel.fim)}`:''}</div></div>
        <div class="xldacts">${sel.tipo==='extrato' && !sel.desfeito && sel.novos ? `<button class="btn sm primary" type="button" id="xlVerNovos">Ver os ${sel.novos} lançamento(s) na aba Extrato ${esc(extNomeBanco(banco[0]))}</button>` : ''}
        ${sel.tipo!=='ajuste' && !sel.desfeito && sel.novos ? `<button class="btn sm danger" type="button" id="xlDesfazer">Desfazer importação</button>` : ''}</div></div>`
      + (sel.tipo!=='ajuste' ? `<div class="xlnums"><div><b>${(sel.recebidos||0).toLocaleString('pt-BR')}</b><span>lançamentos no arquivo</span></div><div><b class="pos">${(sel.novos||0).toLocaleString('pt-BR')}</b><span>novos (subiram)</span></div><div><b>${(sel.repetidos||0).toLocaleString('pt-BR')}</b><span>já estavam importados</span></div></div>` : '')
      + (sel.tipo==='extrato' ? `<div class="xlcols"><div><h4>O que subiu, por classificação</h4>${tab(['Classificação','Linha da DRE','Lanç.','Total (R$)'], (d.porClasse||[]).map(x=>`<tr class="${x.classe==='A CLASSIFICAR'?'alerta':''}"><td>${esc(x.classe)}</td><td>${esc(x.cat)}</td><td class="n">${x.n}</td><td class="n ${x.total<0?'neg':''}">${brl2(x.total)}</td></tr>`))}</div>
          <div><h4>Efeito no painel ${d.ano?'('+d.ano+')':''}</h4>${tab(['Linha da DRE','Mês','Antes','Depois','Diferença'], (d.dre||[]).map(([l,m,a,b])=>`<tr><td>${esc(l)}</td><td>${mesN(d.ano,m)}</td><td class="n">${brl2(a)}</td><td class="n">${brl2(b)}</td>${dif(a,b)}</tr>`))}
          ${(d.saldos||[]).length ? `<h4 style="margin-top:12px">Saldos no fim do mês</h4>${tab(['Conta','Mês','Antes','Depois','Diferença'], d.saldos.map(([l,m,a,b])=>`<tr><td>${esc(l)}</td><td>${mesN(d.ano,m)}</td><td class="n">${a==null?'—':brl2(a)}</td><td class="n">${brl2(b)}</td>${a==null?'<td></td>':dif(a,b)}</tr>`))}` : ''}</div></div>` : '')
      + (sel.tipo==='planilha' && d.abas ? `<div class="xldm" style="margin-top:8px">Abas lidas: ${d.abas.map(a=>`${esc(a.nome)} (${a.linhas})`).join(', ')} · ${d.regras} regras · ${d.depara} classificações · ${d.saldos} saldos · ${d.meses} meses de faturamento</div>` : '')
      + `</div>`;
  }
  $('xlBody').innerHTML = `<div class="xllog">${det}<div class="xglog"></div></div>`;
  xlGrade($('xlBody').querySelector('.xglog'), aba, aba.rows.map((_,i)=>i));
  $('xlBody').querySelectorAll('.xglog tbody tr').forEach(()=>{});
  $('xlBody').querySelector('.xglog').addEventListener('click', e=>{ const tr = e.target.closest('tbody tr'); if(!tr) return; const n = +(tr.querySelector('th')||{}).textContent - 2; if(!(n>=0)) return; XL.imp = aba.meta[n]; xlDesenhar(); });
  $('xlStatus').textContent = `${imps.length} registro(s) no log · clique numa linha para ver o detalhe`;
  if(sel){ const v = $('xlVerNovos'); if(v) v.onclick = () => { XL.aba = 'ext_'+(sel.banco||'').split(',')[0]; XL.soNovo = true; $('xlSoNovo').checked = true; xlDesenhar(); };
    const u = $('xlDesfazer'); if(u) u.onclick = async () => {
      if(!await confirmar('Desfazer esta importação?', `Os ${sel.novos} lançamento(s) que vieram de "${sel.arquivo}" saem da planilha e do painel. Dá para importar de novo depois.`, 'Desfazer')) return;
      try{ const r = await extApi('desfazer', {method:'POST', body:{ id:sel.id }}); toast(`${r.removidos} lançamento(s) removidos`); await carregarExtratos(); await extGerarPainel(true); extAbrirPlanilha({ aba:'log', imp:sel.id }); }
      catch(err){ falha(err); } }; }
}
async function xlBaixar(){
  try{
    await carregarXLSX();
    const wb = XLSX.utils.book_new();
    for(const a of XL.abas){
      const dados = [a.cols.map(c=>c.t), ...a.rows.map(r=>r.map((v,j)=>a.cols[j].k==='data' && v ? new Date(+v.slice(0,4), +v.slice(5,7)-1, +v.slice(8,10)) : v))];
      const ws = XLSX.utils.aoa_to_sheet(dados, {cellDates:true});
      a.cols.forEach((c,j)=>{ for(let i=1;i<dados.length;i++){ const cel = ws[XLSX.utils.encode_cell({r:i,c:j})]; if(!cel) continue;
        if(c.k==='num') cel.z = '#,##0.00;[Red]-#,##0.00'; else if(c.k==='data') cel.z = 'dd/mm/yyyy'; } });
      ws['!cols'] = a.cols.map(c=>({ wch: Math.max(8, Math.round(c.w/7)) }));
      if(dados.length > 1) ws['!autofilter'] = { ref: XLSX.utils.encode_range({s:{r:0,c:0}, e:{r:dados.length-1, c:a.cols.length-1}}) };
      XLSX.utils.book_append_sheet(wb, ws, a.nome.slice(0,31));
    }
    XLSX.writeFile(wb, `Planilha ${st.emp.nome} ${hojeISO()}.xlsx`);
  }catch(err){ falha(err); }
}
$('bExtAbrir').onclick = () => extAbrirPlanilha({ aba:'log' });
