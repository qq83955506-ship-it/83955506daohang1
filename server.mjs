// 本地开发/测试服务器：静态文件 + 真实 Pages Functions 处理器
// 用法: node server.mjs [端口]
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { onRequestGet as pubGet, onRequestPost as pubPost } from './functions/api/public/[[path]].js';
import { onRequestGet as admGet, onRequestPost as admPost } from './functions/api/admin/[[path]].js';

const ROOT = join(process.cwd(), 'public');
const PORT = parseInt(process.argv[2] || '8788', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
};

const env = {
  NAV_KV: (() => {
    const map = new Map();
    return {
      async get(k) { return map.has(k) ? map.get(k) : null; },
      async put(k, v) { map.set(k, String(v)); },
      async delete(k) { map.delete(k); },
      async list({ prefix = '' } = {}) { return { keys: [...map.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }; },
    };
  })(),
};

async function handleApi(req, url) {
  const path = url.pathname;
  const ctx = { request: req, env };
  try {
    if (path.startsWith('/api/public/')) return path.endsWith('/site') || path.endsWith('/meta') ? await pubGet(ctx) : await pubPost(ctx);
    if (path.startsWith('/api/admin/')) return req.method === 'GET' ? await admGet(ctx) : await admPost(ctx);
  } catch (e) {
    return new Response(JSON.stringify({ code: 500, msg: String(e && e.stack || e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // 把 node req 适配成 Web Request
  const body = ['POST', 'PUT'].includes(req.method) ? await new Promise(resolve => {
    const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks)));
  }) : undefined;
  const webReq = new Request('http://localhost' + url.pathname + url.search, {
    method: req.method,
    headers: { 'CF-Connecting-IP': '127.0.0.1', ...(body ? { 'Content-Type': req.headers['content-type'] || 'application/json' } : {}) },
    body,
  });
  // 保留原始 Cookie 头
  if (req.headers.cookie) {
    try { Object.defineProperty(webReq, 'headers', { value: new Headers({ ...Object.fromEntries(webReq.headers), cookie: req.headers.cookie, 'CF-Connecting-IP': '127.0.0.1' }) }); } catch {}
  }

  const apiRes = await handleApi(webReq, url);
  if (apiRes) {
    res.writeHead(apiRes.status, Object.fromEntries(apiRes.headers));
    res.end(await apiRes.text());
    return;
  }

  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  try {
    const full = normalize(join(ROOT, file));
    if (!full.startsWith(ROOT)) throw new Error('forbidden');
    const data = await readFile(full);
    res.writeHead(200, { 'Content-Type': MIME[extname(full)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
});

server.listen(PORT, '127.0.0.1', () => console.log('Dev server: http://127.0.0.1:' + PORT));
