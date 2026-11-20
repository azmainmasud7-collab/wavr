const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process'), { Readable } = require('stream');
const cache = new Map();
// YouTube blocks datacenter IPs; optional Netscape-format cookies via YT_COOKIES env.
let COOKIES_FILE = null;
if (process.env.YT_COOKIES) { COOKIES_FILE = '/tmp/yt-cookies.txt'; fs.writeFileSync(COOKIES_FILE, process.env.YT_COOKIES); }
const PORT = process.env.PORT || 3000;

const crypto = require('crypto'), os = require('os');
const DIR = path.join(os.tmpdir(), 'wavr-audio');
fs.mkdirSync(DIR, { recursive: true });
const pending = new Map();
const MIME = { m4a: 'audio/mp4', mp4: 'audio/mp4', webm: 'audio/webm', opus: 'audio/ogg', ogg: 'audio/ogg', mp3: 'audio/mpeg' };

function prune() {
  try {
    const files = fs.readdirSync(DIR).map(f => ({ f, t: fs.statSync(path.join(DIR, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    files.slice(40).forEach(x => fs.rmSync(path.join(DIR, x.f), { force: true }));
  } catch {}
}

function findAudio(q) {
  if (cache.has(q) && fs.existsSync(cache.get(q))) return Promise.resolve(cache.get(q));
  if (pending.has(q)) return pending.get(q);
  const id = crypto.createHash('md5').update(q).digest('hex');
  const pr = new Promise((ok, no) => {
    const args = ['--js-runtimes', 'node', '--remote-components', 'ejs:github', '-f', 'bestaudio[ext=m4a]/bestaudio/best',
      '--no-playlist', '--no-part', '-o', path.join(DIR, id + '.%(ext)s'), '--print', 'after_move:filepath', '--no-simulate'];
    if (COOKIES_FILE) args.push('--cookies', COOKIES_FILE);
    if (process.env.YTDLP_PROXY) args.push('--proxy', process.env.YTDLP_PROXY);
    const p = spawn('yt-dlp', [...args, `ytsearch1:${q}`]);
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('error', () => no(new Error('yt-dlp not installed')));
    p.on('close', () => {
      const f = out.trim().split('\n').pop();
      if (f && fs.existsSync(f)) { cache.set(q, f); prune(); return ok(f); }
      const msg = (err.split('\n').filter(l => l.startsWith('ERROR')).pop() || 'not found').slice(0, 300);
      console.error('yt-dlp failed for', q, '->', err.trim().slice(-500));
      no(new Error(msg));
    });
  });
  pending.set(q, pr);
  const done = () => pending.delete(q);
  pr.then(done, done);
  return pr;
}

function serveFile(req, res, file) {
  const size = fs.statSync(file).size;
  const type = MIME[path.extname(file).slice(1)] || 'application/octet-stream';
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (m) {
    let start = m[1] ? +m[1] : Math.max(0, size - +m[2]);
    let end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
    if (start >= size || start > end) return res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
    res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': size });
  fs.createReadStream(file).pipe(res);
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
      return serveFile(req, res, await findAudio(q));
    } catch (e) { cache.delete(q); if (!res.headersSent) res.writeHead(500); res.end(e.message); }
    return;
  }
  res.writeHead(404).end();
}).listen(PORT, () => console.log(`Wavr running at http://localhost:${PORT}`));
