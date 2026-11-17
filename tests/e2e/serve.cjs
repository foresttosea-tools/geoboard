// 指定ディレクトリを /geoboard/ で配信する簡易サーバー（同じオリジンで新旧を切り替えるため）
const http = require('http'), fs = require('fs'), path = require('path');
const dir = process.argv[2];
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]).replace(/^\/geoboard/, '');
  if (p === '' || p.endsWith('/')) p += 'index.html';
  let f = path.join(dir, p);
  if (!fs.existsSync(f)) f = path.join(dir, 'index.html');
  const ext = path.extname(f);
  res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }[ext] || 'application/octet-stream');
  fs.createReadStream(f).pipe(res);
}).listen(4173);
