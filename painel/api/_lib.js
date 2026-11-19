// Funções compartilhadas pela API: conexão com o Postgres, login e respostas.
import postgres from 'postgres';
import crypto from 'node:crypto';

const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
const LOCAL = /@(localhost|127\.0\.0\.1)[:/]/.test(DB_URL);

// max:1 porque cada função da Vercel abre a própria conexão.
// prepare:false para funcionar com poolers (Neon, Supabase, PgBouncer).
const sql = DB_URL ? postgres(DB_URL, { max: 1, idle_timeout: 20, connect_timeout: 15, prepare: false, ssl: LOCAL ? false : 'require' }) : null;

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; this.expose = true; }
}

// Cria as tabelas na primeira chamada (não precisa rodar SQL na mão).
let pronto = null;
async function migrar() {
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
export const CORES = ['#1F3A5F', '#2F6DB5', '#2E9E5B', '#6A3FA0', '#D9661F', '#B5487A', '#0F7C86', '#7A6500'];
