const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process'), { Readable } = require('stream');
const cache = new Map();
// YouTube blocks datacenter IPs; optional Netscape-format cookies via YT_COOKIES env.
let COOKIES_FILE = null;
if (process.env.YT_COOKIES) { COOKIES_FILE = '/tmp/yt-cookies.txt'; fs.writeFileSync(COOKIES_FILE, process.env.YT_COOKIES); }
const PORT = process.env.PORT || 3000;

function findAudio(q) {
  if (cache.has(q)) return Promise.resolve(cache.get(q));
  return new Promise((ok, no) => {
    const args = ['--js-runtimes', 'node', '--remote-components', 'ejs:github', '-f', 'bestaudio[ext=m4a]/bestaudio/best', '-g', '--no-playlist'];
    if (COOKIES_FILE) args.push('--cookies', COOKIES_FILE);
    if (process.env.YTDLP_PROXY) args.push('--proxy', process.env.YTDLP_PROXY);
    const p = spawn('yt-dlp', [...args, `ytsearch1:${q}`]);
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('error', () => no(new Error('yt-dlp not installed')));
    p.on('close', () => { const u = out.trim().split('\n')[0]; if (u) { cache.set(q, u); return ok(u); }
      const msg = (err.split('\n').filter(l => l.startsWith('ERROR')).pop() || 'not found').slice(0, 300);
      console.error('yt-dlp failed for', q, '->', err.trim().slice(-500));
      no(new Error(msg)); });
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
