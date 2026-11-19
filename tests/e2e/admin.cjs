const { chromium, devices } = require('playwright');
const fs = require('fs');
const { createMock } = require('./supabase-mock.cjs');
const out = process.argv[2] || require('os').tmpdir(); const img = require('path').join(__dirname, 'fixtures');
(async () => {
  const mock = createMock();
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const route = async (ctx) => { await ctx.route('https://fmmqxpunqxwxrsicfbev.supabase.co/**', (r) => mock.handle(r)); await ctx.route('https://cyberjapandata.gsi.go.jp/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: fs.readFileSync(require('path').join(__dirname, '../../public/icon-192.png')) })); };
  // ---- スマホでデータを作る
  const ph = await b.newContext({ ...devices['Pixel 7'], deviceScaleFactor: 1, permissions: ['camera', 'geolocation'], geolocation: { latitude: 33.66, longitude: 132.91, accuracy: 9 }, serviceWorkers: 'block' });
  await ph.addInitScript(() => sessionStorage.setItem('geoboard.installGuideShown', '1'));
  await route(ph);
  const P = await ph.newPage(); const perr = []; P.on('pageerror', (e) => perr.push(e.message));
  await P.goto('http://localhost:4173/geoboard/');
  await P.getByLabel('メールアドレス').fill('ashida@example.com'); await P.getByLabel('パスワード').fill('pass-a');
  await P.getByRole('button', { name: 'ログイン' }).click(); await P.waitForSelector('text=顧客一覧');
  await P.getByRole('button', { name: '顧客を追加' }).click(); await P.getByPlaceholder('例：〇〇町役場').fill('テスト市役所'); await P.getByRole('button', { name: '保存', exact: true }).click();
  await P.getByRole('button', { name: '台帳を追加' }).click(); await P.getByPlaceholder('例：インフラ設置工事').fill('中継器設置工事');
  await P.locator('input[type=date]').nth(0).fill('2026-10-01'); await P.locator('input[type=date]').nth(1).fill('2026-11-30'); await P.getByPlaceholder('例：芦田').fill('芦田');
  await P.getByRole('button', { name: '保存', exact: true }).click(); await P.waitForSelector('text=まだ記録がありません');
  // 取り込み（GPSあり）
  await P.locator('footer input[type=file]').setInputFiles([`${img}/a-landscape-exif.jpg`, `${img}/b-portrait-exif.jpg`]);
  await P.waitForSelector('.board-canvas');
  const eb = await P.locator('.board-canvas').boundingBox(); const fy = 12 / 720;
  const tap = async (box, i) => P.mouse.click(box.x + box.width * 0.6, box.y + box.height * (fy + (1 - 2 * fy) * ([0.5, 1.5, 2.5, 3.5, 4.5, 6.5, 8.5][i] / 9)));
  await tap(eb, 1); await P.locator('.sheet input').nth(1).fill('〇〇山 山頂'); await P.getByRole('button', { name: '反映' }).click();
  await tap(eb, 2); await P.locator('.sheet input').nth(1).fill('中継器設置'); await P.getByRole('button', { name: '反映' }).click();
  await P.getByText('黒板あり＋なし（両方）').click();
  await P.locator('.handover textarea').fill('バッテリー交換時期の確認'); await P.locator('.handover input[type=checkbox]').check();
  await P.locator('.bottombar .btn-primary').click(); await P.waitForSelector('.import-img');
  await P.locator('.import-panel .btn-primary').click(); await P.waitForSelector('.rec-item');
  // 撮影（位置あり）×2
  for (const place of ['〇〇山 中腹', '麓の役場屋上']) {
    await P.getByRole('button', { name: '撮影', exact: true }).click();
    const b2 = await P.locator('.board-canvas').boundingBox();
    await tap(b2, 1); await P.locator('.sheet input').nth(1).fill(place); await P.getByRole('button', { name: '反映' }).click();
    await P.getByRole('button', { name: '撮影に進む' }).click(); await P.waitForSelector('text=位置 ±'); await P.waitForTimeout(300);
    await P.getByLabel('撮影', { exact: true }).click(); await P.waitForSelector('.confirm-img'); await P.getByRole('button', { name: '保存', exact: true }).click();
    await P.waitForFunction(() => document.querySelectorAll('.rec-item').length >= 2);
  }
  // 圏外で仮顧客＋台帳
  await P.getByLabel('戻る').click(); await P.getByLabel('戻る').click();
  await ph.setOffline(true);
  await P.locator('.bottombar .btn-primary').click(); await P.getByPlaceholder('例：〇〇町役場').fill('テスト市'); await P.getByRole('button', { name: '保存', exact: true }).click();
  await P.getByRole('button', { name: '台帳を追加' }).click(); await P.getByPlaceholder('例：インフラ設置工事').fill('山奥の追加工事'); await P.getByRole('button', { name: '保存', exact: true }).click();
  await ph.setOffline(false); await P.evaluate(() => window.dispatchEvent(new Event('online')));
  await P.waitForTimeout(9000);
  console.log('server:', JSON.stringify({ customers: mock.store.customers.size, ledgers: mock.store.ledgers.size, records: mock.store.records.size, extras: mock.store.record_extras.size }));

  // ---- PC
  const pc = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block', acceptDownloads: true });
  await pc.addInitScript(() => sessionStorage.setItem('geoboard.installGuideShown', '1'));
  await route(pc);
  const A = await pc.newPage(); const aerr = []; A.on('pageerror', (e) => aerr.push(e.message)); A.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && aerr.push(m.text()));
  await A.goto('http://localhost:4173/geoboard/#admin');
  await A.getByLabel('メールアドレス').fill('ashida@example.com'); await A.getByLabel('パスワード').fill('pass-a');
  await A.getByRole('button', { name: 'ログイン' }).click();
  await A.waitForSelector('.admin-list button', { timeout: 20000 }); await A.waitForTimeout(1500);
  console.log('nav:', JSON.stringify(await A.locator('.admin-nav nav button').allTextContents()));
  console.log('customers:', JSON.stringify(await A.locator('.admin-list-main').allTextContents()));
  await A.screenshot({ path: `${out}/pc-1-customers.png` });
  await A.locator('.admin-list button', { hasText: 'テスト市役所' }).click();
  await A.locator('.admin-table tr.clickable').first().click(); await A.waitForSelector('.admin-card'); await A.waitForTimeout(1500);
  console.log('cards:', await A.locator('.admin-card').count());
  await A.screenshot({ path: `${out}/pc-2-ledger.png` });
  await A.locator('.admin-card').first().click(); await A.waitForSelector('.admin-modal'); await A.waitForTimeout(1000);
  await A.screenshot({ path: `${out}/pc-3-record.png` });
  await A.getByLabel('閉じる').click();
  await A.getByRole('tab', { name: '地図' }).click(); await A.waitForSelector('.map-pin', { timeout: 15000 }); await A.waitForTimeout(800);
  console.log('map pins:', await A.locator('.map-pin').count());
  await A.screenshot({ path: `${out}/pc-4-map.png` });
  await A.getByRole('tab', { name: /記録/ }).click();
  // PDF
  await A.getByRole('button', { name: 'PDFレポート' }).click(); await A.waitForSelector('.admin-dialog');
  await A.screenshot({ path: `${out}/pc-5-report.png` });
  await A.getByRole('button', { name: 'PDFを作成' }).click();
  await A.waitForSelector('.admin-dialog >> text=PDFを開く', { timeout: 90000 });
  const [dl] = await Promise.all([A.waitForEvent('download'), A.locator('.admin-dialog').getByRole('button', { name: 'ダウンロード', exact: true }).click()]);
  await dl.saveAs(`${out}/report.pdf`); console.log('pdf saved:', dl.suggestedFilename());
  await A.locator('.admin-dialog').getByRole('button', { name: '閉じる' }).click();
  // ZIP
  const [dz] = await Promise.all([A.waitForEvent('download', { timeout: 60000 }), A.getByRole('button', { name: 'ZIPでダウンロード' }).click()]);
  await dz.saveAs(`${out}/photos.zip`); console.log('zip saved:', dz.suggestedFilename());
  // 写真を1枚ダウンロード（ZIPと同じ名前）
  await A.locator('.admin-card').first().click(); await A.waitForSelector('.admin-modal');
  const [d1] = await Promise.all([A.waitForEvent('download', { timeout: 30000 }), A.getByRole('button', { name: 'この写真をダウンロード' }).click()]);
  console.log('single download:', d1.suggestedFilename(), /^\d{8}_001\.jpg$/.test(d1.suggestedFilename()) ? 'OK' : 'NG');
  await A.getByLabel('閉じる').click();
  // リスト / グリッドの切り替え
  await A.getByLabel('リスト表示').click(); await A.waitForSelector('.admin-record-table');
  console.log('list rows:', await A.locator('.admin-record-table tbody tr').count());
  await A.screenshot({ path: `${out}/pc-2b-ledger-list.png` });
  await A.getByLabel('グリッド表示').click(); await A.waitForSelector('.admin-card');
  // 絞り込み（工期・撮影日・施工者・キーワード）
  await A.getByRole('button', { name: /の台帳一覧/ }).click(); await A.waitForSelector('.admin-filter');
  await A.locator('.admin-filter summary').click();
  await A.getByPlaceholder('施工者名').fill('存在しない人');
  console.log('filter none:', await A.locator('.admin-list li button').count(), (await A.locator('.admin-col.ledgers .empty').textContent()));
  await A.getByPlaceholder('施工者名').fill('');
  await A.getByPlaceholder('黒板・メモ・引継ぎ事項・台帳の内容').fill('中腹');
  console.log('filter keyword:', JSON.stringify(await A.locator('.admin-table tr.clickable td.num').allTextContents()));
  await A.screenshot({ path: `${out}/pc-1b-filter.png` });
  await A.locator('.admin-table tr.clickable').first().click(); await A.waitForSelector('.admin-records-bar');
  console.log('ledger filtered:', (await A.locator('.admin-records-bar .hint').textContent()), 'cards', await A.locator('.admin-card').count());
  await A.getByRole('button', { name: /の台帳一覧/ }).click();
  await A.getByLabel('工期（から）').fill('2027-01-01');
  console.log('filter term+kw:', await A.locator('.admin-list li button').count());
  await A.getByRole('button', { name: '条件をクリア' }).click();
  console.log('filter cleared customers:', await A.locator('.admin-list li button').count());
  // S18 ホーム画面追加の案内（ブラウザのタブで開いたとき、起動ごとに1回）
  const g = await b.newContext({ ...devices['Pixel 7'], deviceScaleFactor: 1, serviceWorkers: 'block' });
  await route(g);
  const G = await g.newPage(); await G.goto('http://localhost:4173/geoboard/');
  await G.getByLabel('メールアドレス').fill('ashida@example.com'); await G.getByLabel('パスワード').fill('pass-a');
  await G.getByRole('button', { name: 'ログイン' }).click(); await G.waitForSelector('text=ホーム画面に追加してください', { timeout: 15000 });
  await G.waitForTimeout(400); await G.screenshot({ path: `${out}/sp-install-guide.png` });
  await G.getByRole('button', { name: 'このままブラウザで使う' }).click();
  await G.reload(); await G.waitForSelector('text=顧客一覧'); await G.waitForTimeout(800);
  console.log('install guide after reload:', await G.getByText('ホーム画面に追加してください').count());
  await g.close();
  // 仮顧客
  await A.getByRole('button', { name: /仮顧客の処理/ }).click(); await A.waitForSelector('.admin-stack .card');
  await A.screenshot({ path: `${out}/pc-6-provisional.png` });
  await A.locator('.admin-stack select').selectOption({ label: '★ テスト市役所' }).catch(async () => { await A.locator('.admin-stack select').selectOption({ index: 1 }); });
  A.once('dialog', (d) => d.accept());
  await A.getByRole('button', { name: '紐づける' }).click(); await A.waitForTimeout(800);
  console.log('provisional left:', await A.locator('.admin-stack .card').count());
  // 削除と復元
  await A.getByRole('button', { name: '顧客・台帳' }).click(); await A.locator('.admin-list button', { hasText: 'テスト市役所' }).click();
  console.log('ledgers of テスト市役所 after link:', JSON.stringify(await A.locator('.admin-table td.strong').allTextContents()));
  A.once('dialog', (d) => d.accept());
  await A.locator('.admin-table').getByLabel('山奥の追加工事を削除').click(); await A.waitForTimeout(500);
  await A.getByRole('button', { name: '削除済みデータ' }).click(); await A.waitForTimeout(500);
  await A.screenshot({ path: `${out}/pc-7-deleted.png` });
  await A.getByRole('button', { name: '元に戻す' }).first().click(); await A.waitForTimeout(800);
  await A.waitForTimeout(6000);
  const prov = [...mock.store.customers.values()].find((c) => c.name === 'テスト市');
  const moved = [...mock.store.ledgers.values()].find((l) => l.name === '山奥の追加工事');
  console.log('server after PC ops:', JSON.stringify({ provisionalMerged: prov?.merged_into != null, provisionalDeleted: prov?.deleted_at != null, ledgerMovedTo: [...mock.store.customers.values()].find((c) => c.id === moved?.customer_id)?.name, ledgerDeleted: moved?.deleted_at != null }));
  console.log('errors:', JSON.stringify(perr), JSON.stringify(aerr), JSON.stringify(mock.errors));
  await b.close();
})();
