// Servidor próprio (VPS / Oracle Cloud): faz o mesmo papel da Vercel.
// - serve a pasta public/
// - /c/<código> abre o painel do cliente
// - /api/<nome> chama api/<nome>.js
// Rodar: node --env-file=.env server.js   (Node 20.6 ou mais novo)
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(RAIZ, 'public');
const PORTA = +process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const LIMITE = 20 * 1024 * 1024; // 20 MB por requisição (planilhas grandes)

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.webp': 'image/webp' };
const ROTAS = new Set(['contas', 'contratos', 'empresas', 'login', 'publico', 'relatorios']);
const cache = new Map();
const rota = async nome => { if (!cache.has(nome)) cache.set(nome, (await import(`./api/${nome}.js`)).default); return cache.get(nome); };

function lerCorpo(req) {
  return new Promise((ok, falha) => {
    const partes = []; let total = 0;
    req.on('data', c => { total += c.length; if (total > LIMITE) { falha(Object.assign(new Error('grande'), { status: 413 })); req.destroy(); } else partes.push(c); });
    req.on('end', () => ok(Buffer.concat(partes).toString('utf8')));
    req.on('error', falha);
  });
}

// deixa req/res parecidos com os da Vercel (req.query, req.body, res.status().json())
function adaptar(req, res, url) {
  req.query = Object.fromEntries(url.searchParams);
  res.status = c => { res.statusCode = c; return res; };
  res.json = obj => { if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); return res; };
}

async function arquivo(res, rel, status = 200) {
  const alvo = path.normalize(path.join(PUBLIC, rel));
  if (!alvo.startsWith(PUBLIC + path.sep)) return false;
  try {
    const st = await fs.stat(alvo); if (!st.isFile()) return false;
    res.writeHead(status, { 'Content-Type': TIPOS[path.extname(alvo).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size,
      'Cache-Control': /\.(png|jpe?g|svg|ico|webp)$/i.test(alvo) ? 'public, max-age=86400' : 'no-cache' });
    res.end(await fs.readFile(alvo));
    return true;
  } catch { return false; }
}

const servidor = http.createServer(async (req, res) => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { res.statusCode = 400; return res.end(); }
  const p = decodeURIComponent(url.pathname);
  try {
    const m = p.match(/^\/api\/([a-z]+)\/?$/);
    if (m) {
      adaptar(req, res, url);
      if (!ROTAS.has(m[1])) return res.status(404).json({ erro: 'Não encontrado.' });
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const txt = await lerCorpo(req);
        req.body = /json/.test(req.headers['content-type'] || '') && txt ? (() => { try { return JSON.parse(txt); } catch { return txt; } })() : txt;
      }
      return await (await rota(m[1]))(req, res);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; return res.end(); }
    if (/^\/c\/[^/]+\/?$/.test(p)) { res.setHeader('X-Robots-Tag', 'noindex, nofollow'); if (await arquivo(res, 'cliente.html')) return; }
    if (p === '/' && await arquivo(res, 'index.html')) return;
    if (await arquivo(res, p.slice(1))) return;
    if (await arquivo(res, p.slice(1) + '.html')) return;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Página não encontrada.');
  } catch (e) {
    if (e.status !== 413) console.error(e);
    if (!res.headersSent) { res.writeHead(e.status || 500, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ erro: e.status === 413 ? 'Arquivo grande demais.' : 'Erro no servidor.' })); }
  }
});
servidor.listen(PORTA, HOST, () => console.log(`Painel rodando em http://${HOST}:${PORTA}`));
