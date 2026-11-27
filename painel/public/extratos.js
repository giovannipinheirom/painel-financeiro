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
      const hora = String(r[iD]).match(/(\d{1,2}):(\d{2})/); const t = hora ? +hora[1]*60 + +hora[2] : 0, s = extNum(r[iS]);
      if(!isNaN(s) && (!ult[d] || t >= ult[d].t)) ult[d] = { t, s }; }
    return { banco:'stone', itens, saldos:Object.entries(ult).map(([d,x])=>({ conta:'stone', d, s:x.s })) };
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
function extPelaRegra(l, regras){ const t = extTextoRegra(l); for(const r of regras) if(extPadrao(r.p).test(t)) return r.c; return null; }
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
  for(const l of D.lanc){ l.cls = l.m || extPelaRegra(l, regras[l.b]||[]); l.cat = l.cls ? dp.get(extChaveClasse(l.cls)) : undefined; }
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
  try{ const d = await extApi(''); st.ext = { D:{ lanc:d.lanc, regras:d.regras, depara:d.depara, saldos:d.saldos, meses:d.meses, carteira:d.carteira } }; }
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
    else { await extApi('manual', {method:'PUT', body:{ chaves:[l.c], classe }}); l.m = classe; toast('Lançamento classificado'); }
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
async function extImportarArquivos(files){
  if(!files.length || !st.emp) return;
  $('extDrop').classList.add('busy'); const res = [];
  try{
    for(const f of files){
      const x = await extLerArquivo(f);
      const r = await extApi('lancamentos', {method:'POST', body:{ itens:x.itens.map(i=>({ c:i.c, b:i.b, d:i.d, p:i.p, v:i.v })), saldos:x.saldos.map(s=>({ ...s, o:'extrato' })) }});
      res.push(`${extNomeBanco(x.banco)}: ${r.novos} novo(s)${r.repetidos?`, ${r.repetidos} já importado(s)`:''}`);
    }
    toast(res.join(' · '));
    await carregarExtratos(); await extGerarPainel(true);
  }catch(err){ falha(err); }
  $('extDrop').classList.remove('busy'); $('extFile').value='';
}
$('extDrop').onclick = () => $('extFile').click();
$('extFile').onchange = e => extImportarArquivos([...e.target.files]);
['dragover','dragenter'].forEach(t=>$('extDrop').addEventListener(t, e=>{ e.preventDefault(); $('extDrop').classList.add('over'); }));
['dragleave','drop'].forEach(t=>$('extDrop').addEventListener(t, e=>{ e.preventDefault(); $('extDrop').classList.remove('over'); }));
$('extDrop').addEventListener('drop', e=>extImportarArquivos([...e.dataTransfer.files]));

// importar a planilha de conciliação (regras, de-para, histórico, saldos, faturamento)
$('bExtPlan').onclick = () => $('extPlan').click();
$('extPlan').onchange = async e => {
  const f = e.target.files[0]; e.target.value=''; if(!f) return;
  if(!await confirmar('Importar a planilha de referência?', 'As regras e o de-para da empresa serão substituídos pelos da planilha, e os lançamentos dela entram no histórico (os que já existem não duplicam).', 'Importar')) return;
  $('bExtPlan').disabled = true; toast('Lendo a planilha…');
  try{
    await carregarXLSX();
    const P = extLerPlanilha(XLSX.read(await f.arrayBuffer(), {type:'array', cellFormula:true}));
    await extApi('config', {method:'POST', body:{ regras:P.regras, depara:P.depara }});
    const r = await extApi('lancamentos', {method:'POST', body:{ itens:P.itens.map(i=>({ c:i.c, b:i.b, d:i.d, p:i.p, v:i.v, m:i.m })), saldos:P.saldos, manualPrevalece:true }});
    for(const m of P.meses) await extApi('mes', {method:'PUT', body:{ mes:m.mes, faturamento:m.f ?? '', rendimento:m.r ?? '' }});
    toast(`Planilha importada: ${P.regras.length} regras, ${P.depara.length} classificações, ${r.novos.toLocaleString('pt-BR')} lançamentos novos (${P.abas.map(a=>extNomeBanco(a.banco)).join(', ')})`);
    await carregarExtratos(); await extGerarPainel(true);
  }catch(err){ falha(err); }
  $('bExtPlan').disabled = false;
};

// gerar o painel a partir dos lançamentos
function extMarcarDesatualizado(){ $('bExtGerar').classList.add('pulsa'); $('bExtGerar').textContent = 'Atualizar painel'; }
async function extGerarPainel(auto){
  if(!st.ext || !st.ext.D.lanc.length) return auto ? null : toast('Importe os extratos primeiro.');
  try{
    const M = extMontarModelo(st.ext.D), modelo = serializeModel(M.modelo);
    const rel = await api('relatorios', {method:'POST', body:{ empresaId:st.emp.id, arquivo:`Extratos até ${extDataBR(M.ultData)}`, modelo }});
    st.cache.set(rel.id, {...rel, modelo}); st.relId = rel.id; st.m = null; st.rendered = null;
    await carregarHistorico(); st.emp = await api('empresas?id='+st.emp.id); cabecalho();
    $('bExtGerar').classList.remove('pulsa');
    toast(`Painel atualizado até ${extDataBR(M.ultData)}${M.P.pend.length ? ` · ${M.P.pend.length} lançamento(s) a classificar ficaram fora` : ''}`);
  }catch(err){ falha(err); }
}
$('bExtGerar').onclick = () => extGerarPainel(false);
