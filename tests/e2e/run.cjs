// ビルド済みの dist を配信し、モックのSupabaseに対して同期のE2Eテストを実行する
const { spawn } = require('child_process');
const path = require('path');
const server = spawn(process.execPath, [path.join(__dirname, 'serve.cjs'), path.join(__dirname, '../../dist')], { stdio: 'ignore' });
setTimeout(() => {
  const t = spawn(process.execPath, [path.join(__dirname, 'sync.cjs'), ...process.argv.slice(2)], { stdio: 'inherit' });
  t.on('exit', (code) => {
    server.kill();
    process.exit(code ?? 1);
  });
}, 800);
