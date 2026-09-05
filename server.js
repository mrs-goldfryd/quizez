const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

async function start() {
  const { createAPI } = await import('./lib/api.mjs');
  const { localStore } = await import('./lib/local-store.mjs');
  const dataDirectory = process.env.QUIZ_DATA_DIR || path.join(__dirname, 'data/runtime');
  const handler = createAPI({
    store: localStore(dataDirectory), seedQuizzes: require('./data/quizzes.json'),
    seedSubmissions: process.env.QUIZ_DATA_DIR ? [] : require('./data/submissions.json'),
    adminPin: process.env.ADMIN_PIN || '1234'
  });
  const publicDirectory = path.join(__dirname, 'public');
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
  http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 100000) { res.writeHead(413); res.end(); return; }
          chunks.push(chunk);
        }
        const request = new Request(url, { method: req.method, headers: req.headers,
          ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
        const response = await handler(request);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(await response.text());
        return;
      }
      const name = ['/', '/index.html', '/admin'].includes(url.pathname) || url.pathname.startsWith('/quiz/') ? 'index.html' : url.pathname.slice(1);
      if (!['index.html', 'app.js', 'style.css'].includes(name)) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(name)] });
      res.end(fs.readFileSync(path.join(publicDirectory, name)));
    } catch (error) { console.error(error.message); res.writeHead(500); res.end('Server error'); }
  }).listen(process.env.PORT || 3000, process.env.HOST || '127.0.0.1', () => {
    console.log(`Quiz app: http://localhost:${process.env.PORT || 3000}`);
    if (!process.env.ADMIN_PIN) console.log('Local development teacher code: 1234. Netlify requires ADMIN_PIN.');
  });
}
start();
