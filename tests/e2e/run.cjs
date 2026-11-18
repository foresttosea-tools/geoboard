// ビルド済みの dist を配信し、モックのSupabaseに対して同期のE2Eテストを実行する
const { spawn } = require('child_process');
const path = require('path');
const server = spawn(process.execPath, [path.join(__dirname, 'serve.cjs'), path.join(__dirname, '../../dist')], { stdio: 'ignore' });
setTimeout(() => {
  const admin = process.argv.includes('--admin');
  const step4 = process.argv.includes('--step4');
  const args = process.argv.slice(2).filter((a) => a !== '--admin' && a !== '--step4');
  const t = spawn(process.execPath, [path.join(__dirname, admin ? 'admin.cjs' : step4 ? 'step4.cjs' : 'sync.cjs'), ...args], { stdio: 'inherit' });
  t.on('exit', (code) => {
    server.kill();
    process.exit(code ?? 1);
  });
}, 800);
