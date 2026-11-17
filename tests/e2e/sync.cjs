const { chromium, devices } = require('playwright');
const { createMock } = require('./supabase-mock.cjs');
const out = process.argv[2] || require('os').tmpdir();
const URL_ = 'http://localhost:4173/geoboard/';
(async () => {
  const mock = createMock();
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const mkPhone = async (name) => {
    const ctx = await b.newContext({ ...devices['Pixel 7'], deviceScaleFactor: 2, permissions: ['camera'], serviceWorkers: 'block' });
    await ctx.route('https://fmmqxpunqxwxrsicfbev.supabase.co/**', (r) => { if (process.env.DBG && r.request().method() !== 'GET') console.log('  REQ', name, r.request().method(), r.request().url().split('.co')[1].slice(0, 70)); return mock.handle(r); });
    const p = await ctx.newPage();
    p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(m.text()) && p.errs.push(m.text()));
    p.ctx = ctx; p.name = name;
    return p;
  };
  const shot = (p, n) => p.screenshot({ path: `${out}/${n}.png` });
  const login = async (p, email, pw) => {
    await p.goto(URL_);
    await p.waitForSelector('.login-form');
    await p.getByLabel('メールアドレス').fill(email);
    await p.getByLabel('パスワード').fill(pw);
    await p.getByRole('button', { name: 'ログイン' }).click();
    await p.waitForSelector('text=顧客一覧');
  };
  const unsyncedCount = (p) => p.evaluate(async () => {
    const r = indexedDB.open('geoboard'); await new Promise((res) => (r.onsuccess = res)); const d = r.result;
    let n = 0;
    for (const t of ['customers', 'ledgers', 'records', 'extras', 'templates']) {
      const q = d.transaction(t).objectStore(t).getAll(); await new Promise((res) => (q.onsuccess = res));
      n += q.result.filter((x) => x.syncStatus !== 'synced').length;
    }
    d.close();
    return n;
  });
  const waitSynced = async (p) => {
    for (let i = 0; i < 60; i++) {
      if ((await unsyncedCount(p)) === 0) return;
      await p.waitForTimeout(500);
    }
    throw new Error(p.name + ': not synced within 30s');
  };
  const localImages = (p) => p.evaluate(async () => {
    const r = indexedDB.open('geoboard'); await new Promise((res) => (r.onsuccess = res)); const d = r.result;
    const q = d.transaction('images').objectStore('images').getAll(); await new Promise((res) => (q.onsuccess = res));
    d.close(); return q.result.map((i) => i.kind).sort().join(',');
  });
  const shoot = async (p, mode) => {
    await p.getByRole('button', { name: '撮影', exact: true }).click();
    if (mode === 'both') await p.getByText('黒板あり＋なし（両方）').click();
    await p.getByRole('button', { name: '撮影に進む' }).click();
    await p.waitForSelector('.overlay-board canvas'); await p.waitForTimeout(400);
    await p.getByLabel('撮影', { exact: true }).click(); await p.waitForSelector('.confirm-img');
    await p.getByRole('button', { name: '保存', exact: true }).click(); await p.waitForSelector('.rec-item');
  };

  // ---- 端末A（管理者）
  const A = await mkPhone('A');
  await A.goto(URL_); await A.waitForSelector('.login-form'); await shot(A, '01-login');
  await A.getByLabel('メールアドレス').fill('ashida@example.com'); await A.getByLabel('パスワード').fill('wrong');
  await A.getByRole('button', { name: 'ログイン' }).click(); await A.waitForSelector('.login-form .danger');
  console.log('1 wrong password message:', await A.locator('.login-form .danger').textContent());
  await A.getByLabel('パスワード').fill('pass-a'); await A.getByRole('button', { name: 'ログイン' }).click();
  await A.waitForSelector('text=顧客一覧');
  await A.getByRole('button', { name: '顧客を追加' }).click();
  await A.getByPlaceholder('例：〇〇町役場').fill('テスト市役所'); await A.getByRole('button', { name: '保存', exact: true }).click();
  await A.getByRole('button', { name: '台帳を追加' }).click();
  await A.getByPlaceholder('例：GeoChat中継器設置工事').fill('中継器設置工事'); await A.getByRole('button', { name: '保存', exact: true }).click();
  await A.waitForSelector('text=まだ記録がありません');
  await shoot(A, 'both');
  await waitSynced(A);
  console.log('2 A synced. server:', JSON.stringify({ customers: [...mock.store.customers.values()].map((c) => c.code), records: mock.store.records.size, files: [...mock.files.keys()].map((k) => k.split('_').pop()) }));
  console.log('  A local images after sync:', await localImages(A));
  await A.locator('.rec-item').first().click(); await A.waitForSelector('.detail-img img'); await A.waitForTimeout(800);
  // 追加写真
  await A.locator('input[type=file][multiple]').setInputFiles([require('path').join(__dirname, '../../public/icon-512.png')]);
  await A.waitForSelector('.extras-thumb img'); await waitSynced(A);
  console.log('3 extras on server:', mock.store.record_extras.size, 'detail img src is blob:', (await A.locator('.detail-img img').getAttribute('src')).startsWith('blob:'));
  await shot(A, '02-detail-after-sync');
  await A.getByLabel('戻る').click(); await A.getByLabel('戻る').click(); await A.getByLabel('戻る').click();
  await A.waitForSelector('text=顧客一覧'); await A.waitForTimeout(800);
  console.log('4 customer code shown on A:', await A.locator('.card-main span').first().textContent());

  // ---- 端末B（一般）：Aのデータが届く
  const B = await mkPhone('B');
  await login(B, 'michi@example.com', 'pass-m');
  await B.waitForSelector('.card-row', { timeout: 15000 });
  await B.locator('.card-main').first().click(); await B.locator('.ledger-card').first().click();
  await B.waitForSelector('.rec-item'); await B.waitForTimeout(1200);
  console.log('5 B sees records:', await B.locator('.rec-item').count(), 'thumb loaded:', await B.locator('.rec-item .thumb img').count(), 'extras badge:', await B.locator('.badge-brand').count());
  await shot(B, '03-B-records');

  // ---- 端末B：圏外で撮影 → 仮顧客 → 復帰で自動送信
  await B.ctx.setOffline(true);
  await shoot(B, 'board');
  await B.waitForTimeout(500);
  console.log('6 offline syncbar:', JSON.stringify(await B.locator('.syncbar-item').allTextContents()));
  await shot(B, '04-B-offline');
  await B.getByLabel('戻る').click(); await B.getByLabel('戻る').click();
  console.log('  offline add button:', await B.locator('.bottombar .btn-primary').textContent());
  await B.locator('.bottombar .btn-primary').click(); await B.getByPlaceholder('例：〇〇町役場').fill('山奥の現場'); await B.getByRole('button', { name: '保存', exact: true }).click();
  await B.getByLabel('戻る').click(); await B.waitForTimeout(300);
  await shot(B, '05-B-provisional');
  await B.ctx.setOffline(false);
  await B.evaluate(() => window.dispatchEvent(new Event('online')));
  await waitSynced(B);
  const prov = [...mock.store.customers.values()].find((c) => c.name === '山奥の現場');
  console.log('7 after online: server records', mock.store.records.size, 'provisional on server:', prov?.is_provisional, 'code:', prov?.code);

  // ---- 送信失敗と再送
  await B.locator('.card-main', { hasText: 'テスト市役所' }).click(); await B.locator('.ledger-card').first().click(); await B.waitForSelector('.rec-item');
  mock.failNext = true;
  const before = new Set(mock.store.records.keys());
  await shoot(B, 'board');
  const newId = await B.evaluate(async () => { const r = indexedDB.open('geoboard'); await new Promise((res) => (r.onsuccess = res)); const q = r.result.transaction('records').objectStore('records').getAll(); await new Promise((res) => (q.onsuccess = res)); return q.result.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0].id; });
  mock.failRecordIds.add(newId);
  await B.waitForSelector('.syncbar-item.tone-error', { timeout: 30000 });
  console.log('8 failed syncbar:', JSON.stringify(await B.locator('.syncbar-item.tone-error').allTextContents()));
  await shot(B, '06-B-failed');
  mock.failRecordIds.delete(newId);
  await B.getByRole('button', { name: '再送' }).click();
  await waitSynced(B);
  console.log('  after retry, on server:', mock.store.records.has(newId), 'syncbar items:', await B.locator('.syncbar-item').count());

  // ---- 設定：管理者メニュー、Bを停止 → Bは送信後にログアウト
  await A.locator('.appbar-actions .icon-btn[aria-label="設定"]').click(); await A.waitForSelector('text=ユーザー管理');
  await shot(A, '07-A-settings');
  await A.screenshot({ path: `${out}/08-A-settings-full.png`, fullPage: true });
  A.once('dialog', (d) => d.accept());
  await A.locator('.user-list li', { hasText: '道' }).getByRole('button', { name: '停止' }).click();
  await A.waitForTimeout(500);
  console.log('9 B disabled on server:', mock.profiles.get('22222222-2222-4222-8222-222222222222').disabled);
  await shoot(B, 'board');
  await B.waitForSelector('.login-notice', { timeout: 30000 });
  console.log('  B notice:', await B.locator('.login-notice').textContent(), '| last record reached server:', mock.store.records.size);
  await shot(B, '09-B-disabled');

  // ---- ログイン状態の保持（再読み込み・圏外での起動）
  // サーバーに届かない状態（圏外相当）で開き直してもログイン画面に戻らないこと
  await A.ctx.unrouteAll();
  await A.ctx.route('https://fmmqxpunqxwxrsicfbev.supabase.co/**', (r) => r.abort('internetdisconnected'));
  await A.reload(); await A.waitForTimeout(2500);
  console.log('10 A reload without server stays logged in:', await A.locator('.login-form').count() === 0, '| screen:', await A.locator('.appbar h1').first().textContent());

  console.log('column/route errors:', JSON.stringify(mock.errors));
  console.log('page errors A:', JSON.stringify(A.errs), 'B:', JSON.stringify(B.errs));
  await b.close();
})();
