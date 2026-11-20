const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process'), { Readable } = require('stream');
const cache = new Map();
const PORT = process.env.PORT || 3000;

function findAudio(q) {
  if (cache.has(q)) return Promise.resolve(cache.get(q));
  return new Promise((ok, no) => {
    const p = spawn('yt-dlp', ['-f', 'bestaudio[ext=m4a]/bestaudio', '-g', '--no-playlist', `ytsearch1:${q}`]);
    let out = '';
    p.stdout.on('data', d => out += d);
    p.on('error', () => no(new Error('yt-dlp not installed')));
    p.on('close', () => { const u = out.trim().split('\n')[0]; u ? (cache.set(q, u), ok(u)) : no(new Error('not found')); });
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
  }
  if (url.pathname === '/stream') {
    const q = url.searchParams.get('q');
    try {
      const src = await findAudio(q);
      const r = await fetch(src, { headers: req.headers.range ? { Range: req.headers.range } : {} });
      const h = { 'Accept-Ranges': 'bytes' };
      for (const k of ['content-type', 'content-length', 'content-range']) if (r.headers.get(k)) h[k] = r.headers.get(k);
      res.writeHead(r.status, h);
      Readable.fromWeb(r.body).pipe(res);
    } catch (e) { cache.delete(q); res.writeHead(500).end(e.message); }
    return;
  }
  res.writeHead(404).end();
}).listen(PORT, () => console.log(`Wavr running at http://localhost:${PORT}`));
