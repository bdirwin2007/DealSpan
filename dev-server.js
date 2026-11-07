// Local server: static site from public/ plus the same API Vercel runs.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import handler from './api/dealspan.js';
const root = fileURLToPath(new URL('./public/', import.meta.url));
const mime = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon'};
export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/dealspan') return handler(req, res);
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
    let name = decodeURIComponent(url.pathname); if (name === '/') name = '/index.html'; if (!path.extname(name)) name += '.html';
    const file = path.resolve(root, '.' + name);
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    try { const bytes = await fs.readFile(file); res.writeHead(200, {'Content-Type': (mime[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-store'}); res.end(req.method === 'HEAD' ? undefined : bytes); }
    catch { res.writeHead(404, {'Content-Type': 'text/plain'}); res.end('Not found'); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 4190;
  createServer().listen(port, '127.0.0.1', () => console.log(`DealSpan: http://127.0.0.1:${port}`));
}
