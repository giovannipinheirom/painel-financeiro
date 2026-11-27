// Funções compartilhadas pela API: conexão com o Postgres, login e respostas.
import postgres from 'postgres';
import crypto from 'node:crypto';

const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
const LOCAL = /@(localhost|127\.0\.0\.1)[:/]/.test(DB_URL);

// Na Vercel cada função abre as próprias conexões (poucas); no servidor próprio o processo é um só e reaproveita.
// prepare:false para funcionar com poolers (Neon, Supabase, PgBouncer).
const sql = DB_URL ? postgres(DB_URL, { max: process.env.VERCEL ? 3 : 10, idle_timeout: 20, connect_timeout: 15, prepare: false, onnotice: () => {}, ssl: LOCAL ? false : 'require' }) : null;

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; this.expose = true; }
}

// Cria as tabelas na primeira chamada (não precisa rodar SQL na mão).
let pronto = null;
const VERSAO_BANCO = 9;
async function migrar() {
  try {
    const [v] = await sql`select v from esquema_versao limit 1`;
    if (v && v.v >= VERSAO_BANCO) return;
  } catch { /* tabela ainda não existe: banco novo ou de versão antiga */ }
  await criarTabelas();
  await sql`create table if not exists esquema_versao (v int not null)`;
  await sql`delete from esquema_versao`;
  await sql`insert into esquema_versao (v) values (${VERSAO_BANCO})`;
}
async function criarTabelas() {
  await sql`create table if not exists empresas (
    id text primary key,
    nome text not null,
    cnpj text,
    contato text,
    cor text,
    token text not null unique,
    criado_em timestamptz not null default now()
  )`;
  await sql`create table if not exists relatorios (
    id text primary key,
    empresa_id text not null references empresas(id) on delete cascade,
    arquivo text,
    enviado_em timestamptz not null default now(),
    ano int,
    ultimo int,
    resumo jsonb,
    modelo jsonb not null
  )`;
  await sql`create index if not exists relatorios_empresa_data on relatorios (empresa_id, enviado_em desc)`;
  // v2: senha do cliente e opção "posição de clientes" (vale também para as empresas já cadastradas)
  await sql`alter table empresas add column if not exists senha_hash text`;
  await sql`alter table empresas add column if not exists senha_em timestamptz`;
  await sql`alter table empresas add column if not exists posicao_clientes boolean not null default true`;
  // v3: calendário de contas a pagar
  await sql`alter table empresas add column if not exists contas_pagar boolean not null default false`;
  await sql`create table if not exists contas_pagar (
    id text primary key,
    empresa_id text not null references empresas(id) on delete cascade,
    recebedor text not null,
    valor numeric(14,2) not null,
    vencimento date not null,
    criado_em timestamptz not null default now()
  )`;
  await sql`create index if not exists contas_pagar_empresa_venc on contas_pagar (empresa_id, vencimento)`;
  // v4: contratos com parcelas
  await sql`alter table empresas add column if not exists contratos boolean not null default false`;
  await sql`create table if not exists contratos (
    id text primary key,
    empresa_id text not null references empresas(id) on delete cascade,
    nome text not null,
    criado_em timestamptz not null default now()
  )`;
  await sql`create table if not exists contrato_parcelas (
    id text primary key,
    contrato_id text not null references contratos(id) on delete cascade,
    vencimento date not null,
    valor numeric(14,2) not null
  )`;
  await sql`create index if not exists contrato_parcelas_contrato on contrato_parcelas (contrato_id, vencimento)`;
  // v5: repasses a fornecedores (ex.: brechó que paga quem consignou as peças)
  await sql`alter table empresas add column if not exists repasses boolean not null default false`;
  await sql`alter table empresas add column if not exists repasse_prazo int not null default 10`;
  await sql`alter table empresas add column if not exists repasses_em timestamptz`;
  await sql`alter table empresas add column if not exists repasses_arquivo text`;
  await sql`create table if not exists repasses (
    id text primary key,
    empresa_id text not null references empresas(id) on delete cascade,
    fornecedor text not null,
    valor numeric(14,2) not null,
    solicitado date not null,
    pago boolean not null default false,
    pago_em date,
    cancelado boolean not null default false,
    banco text,
    conta text
  )`;
  await sql`create index if not exists repasses_empresa_sol on repasses (empresa_id, solicitado)`;
  // v7: painel a partir dos extratos bancários
  await sql`alter table empresas add column if not exists extratos boolean not null default false`;
  await sql`create table if not exists ext_lanc (
    empresa_id text not null references empresas(id) on delete cascade,
    chave text not null, banco text not null, data date not null,
    partes text not null, valor numeric(14,2) not null, manual text,
    primary key (empresa_id, chave))`;
  await sql`create index if not exists ext_lanc_data on ext_lanc (empresa_id, data)`;
  await sql`create table if not exists ext_regra (
    empresa_id text not null references empresas(id) on delete cascade,
    banco text not null, ordem int not null, padrao text not null, classe text not null,
    primary key (empresa_id, banco, ordem))`;
  await sql`create table if not exists ext_depara (
    empresa_id text not null references empresas(id) on delete cascade,
    classe text not null, categoria text not null, primary key (empresa_id, classe))`;
  await sql`create table if not exists ext_saldo (
    empresa_id text not null references empresas(id) on delete cascade,
    conta text not null, data date not null, saldo numeric(14,2) not null, origem text,
    primary key (empresa_id, conta, data))`;
  await sql`create table if not exists ext_mes (
    empresa_id text not null references empresas(id) on delete cascade,
    mes text not null, faturamento numeric(14,2), rendimento numeric(14,2), primary key (empresa_id, mes))`;
  await sql`create table if not exists ext_carteira (
    empresa_id text not null references empresas(id) on delete cascade,
    banco text not null, nome text not null, classe text, vencimento date, valor numeric(14,2) not null)`;
  await sql`create index if not exists ext_carteira_emp on ext_carteira (empresa_id, banco)`;
  // v8: log de importações e ajustes (qual importação trouxe cada lançamento)
  await sql`alter table ext_lanc add column if not exists imp text`;
  // v9: logo da empresa e formatação da planilha embutida
  await sql`alter table empresas add column if not exists logo text`;
  await sql`alter table empresas add column if not exists planilha_fmt jsonb`;
  await sql`create table if not exists ext_import (
    id text primary key, empresa_id text not null references empresas(id) on delete cascade,
    criado timestamptz not null default now(), tipo text not null, arquivo text, banco text, ini date, fim date,
    recebidos int, novos int, repetidos int, detalhe jsonb, desfeito boolean not null default false)`;
  await sql`create index if not exists ext_import_emp on ext_import (empresa_id, criado desc)`;
  // v6: PDF anexado a uma conta a pagar (boleto, nota etc.)
  await sql`create table if not exists conta_anexos (
    conta_id text primary key references contas_pagar(id) on delete cascade,
    nome text not null,
    tamanho int not null,
    dados bytea not null,
    criado_em timestamptz not null default now()
  )`;
}

// Repasses para o painel: os não pagos (qualquer data) + os dos últimos ~13 meses
export async function repassesDaEmpresa(sql, e) {
  const itens = await sql`select fornecedor as f, valor::float8 as v, to_char(solicitado, 'YYYY-MM-DD') as s,
                                 to_char(pago_em, 'YYYY-MM-DD') as p, pago as ok, cancelado as x, banco as b, conta as c
                            from repasses where empresa_id = ${e.id}
                             and (not pago and not cancelado or solicitado >= current_date - 400)
                           order by solicitado, fornecedor limit 20000`;
  return { prazo: e.repasse_prazo || 10, em: e.repasses_em, arquivo: e.repasses_arquivo, itens };
}

// Contratos de uma empresa com todas as parcelas (numeradas: 3 de 12 etc.)
export async function contratosDaEmpresa(sql, empresaId) {
  const cs = await sql`select id, nome from contratos where empresa_id = ${empresaId} order by criado_em`;
  const ps = await sql`select p.id, p.contrato_id, to_char(p.vencimento, 'YYYY-MM-DD') as vencimento, p.valor::float8 as valor
                         from contrato_parcelas p join contratos c on c.id = p.contrato_id
                        where c.empresa_id = ${empresaId} order by p.vencimento, p.id limit 5000`;
  return cs.map(c => ({ id: c.id, nome: c.nome, parcelas: ps.filter(p => p.contrato_id === c.id).map(p => ({ id: p.id, vencimento: p.vencimento, valor: p.valor })) }));
}
export async function db() {
  if (!sql) throw new HttpError(500, 'Banco não configurado: defina DATABASE_URL nas variáveis de ambiente da Vercel.');
  if (!pronto) pronto = migrar().catch(e => { pronto = null; throw e; });
  await pronto;
  return sql;
}

// ---------- ids ----------
const ALFA = 'abcdefghijkmnpqrstuvwxyz23456789';
export function novoId(n = 12) {
  const b = crypto.randomBytes(n);
  return Array.from(b, x => ALFA[x % 32]).join('');
}
export const ID_OK = /^[a-z0-9]{6,40}$/;

// ---------- sessão do consultor ----------
const SECRET = process.env.SESSION_SECRET || '';
const DIAS = 30;
const assinar = exp => crypto.createHmac('sha256', SECRET).update('sessao:' + exp).digest('base64url');
const igual = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};
function cookies(req) {
  const out = {};
  for (const p of String(req.headers.cookie || '').split(';')) {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  }
  return out;
}
function seguro(req) {
  // COOKIE_SEGURO=0 só para testar pelo IP, sem HTTPS (num VPS)
  if (process.env.COOKIE_SEGURO === '0') return false;
  const host = String(req.headers.host || '');
  return !/^(localhost|127\.0\.0\.1)(:|$)/.test(host);
}
export function senhaConfere(senha) {
  const certa = process.env.ADMIN_PASSWORD || '';
  if (!certa || !SECRET) throw new HttpError(500, 'Defina ADMIN_PASSWORD e SESSION_SECRET nas variáveis de ambiente da Vercel.');
  return igual(senha || '', certa);
}
export function abrirSessao(req, res) {
  const exp = Date.now() + DIAS * 864e5;
  res.setHeader('Set-Cookie', `sessao=${exp}.${assinar(exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DIAS * 86400}${seguro(req) ? '; Secure' : ''}`);
}
export function fecharSessao(req, res) {
  res.setHeader('Set-Cookie', `sessao=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${seguro(req) ? '; Secure' : ''}`);
}
export function ehAdmin(req) {
  if (!SECRET) return false;
  const [exp, sig] = String(cookies(req).sessao || '').split('.');
  if (!exp || !sig || !(+exp > Date.now())) return false;
  return igual(sig, assinar(exp));
}
export function exigirAdmin(req) {
  if (!ehAdmin(req)) throw new HttpError(401, 'Faça login para continuar.');
}

// ---------- senha e sessão do cliente ----------
export function hashSenha(senha) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(senha), salt, 32);
  return 's1$' + salt.toString('base64url') + '$' + h.toString('base64url');
}
export function confereSenha(senha, guardado) {
  const [v, salt, h] = String(guardado || '').split('$');
  if (v !== 's1' || !salt || !h) return false;
  const x = crypto.scryptSync(String(senha || ''), Buffer.from(salt, 'base64url'), 32);
  const y = Buffer.from(h, 'base64url');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
// A assinatura inclui o hash da senha: trocar a senha desconecta todo mundo daquele cliente.
const assinarCli = (empId, exp, senhaHash) => crypto.createHmac('sha256', SECRET).update(`cli:${empId}:${exp}:${senhaHash}`).digest('base64url');
export function abrirSessaoCliente(req, res, empId, senhaHash) {
  if (!SECRET) throw new HttpError(500, 'Defina SESSION_SECRET nas variáveis de ambiente da Vercel.');
  const exp = Date.now() + DIAS * 864e5;
  res.setHeader('Set-Cookie', `cli_${empId}=${exp}.${assinarCli(empId, exp, senhaHash)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DIAS * 86400}${seguro(req) ? '; Secure' : ''}`);
}
export function fecharSessaoCliente(req, res, empId) {
  res.setHeader('Set-Cookie', `cli_${empId}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${seguro(req) ? '; Secure' : ''}`);
}
export function clienteLogado(req, empId, senhaHash) {
  if (!SECRET || !senhaHash) return false;
  const [exp, sig] = String(cookies(req)['cli_' + empId] || '').split('.');
  if (!exp || !sig || !(+exp > Date.now())) return false;
  return igual(sig, assinarCli(empId, exp, senhaHash));
}

// ---------- utilidades de resposta ----------
export function rota(fn) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      // bloqueia POST/PUT/DELETE vindos de outros sites
      if (req.method !== 'GET' && req.headers.origin && req.headers.host && new URL(req.headers.origin).host !== req.headers.host)
        throw new HttpError(403, 'Origem não permitida.');
      await fn(req, res);
    } catch (e) {
      if (!e.expose) console.error(e);
      res.status(e.status || 500).json({ erro: e.expose ? e.message : 'Erro no servidor. Tente de novo.' });
    }
  };
}
export function corpo(req) {
  const b = req.body;
  if (b && typeof b === 'object') return b;
  if (typeof b === 'string' && b) { try { return JSON.parse(b); } catch { /* cai abaixo */ } }
  return {};
}
export const texto = (v, max) => (v == null ? '' : String(v)).trim().slice(0, max);
export const CORES = ['#902884', '#566BAF', '#3A2459', '#2E9E5B', '#D9661F', '#B5487A', '#0F7C86', '#7A6500'];
