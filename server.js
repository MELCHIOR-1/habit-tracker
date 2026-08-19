// server.js —— 本地静态预览用（部署到 GitHub Pages 后不需要它）
// 用法：node server.js  然后打开 http://localhost:3000
// 需先在本地用 action-sync.mjs 生成 data/checkins.enc（见 DEPLOY.md）
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.enc': 'application/octet-stream',
  '.svg': 'image/svg+xml'
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const fp = join(__dirname, normalize(p));
    if (!fp.startsWith(__dirname)) { res.writeHead(403); return res.end('forbidden'); }
    const buf = await readFile(fp);
    res.writeHead(200, { 'Content-Type': MIME[extname(fp)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(PORT, () => {
  console.log(`本地预览已启动： http://localhost:${PORT}`);
});
