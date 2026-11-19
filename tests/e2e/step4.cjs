// ステップ4：項目単位のマージ・衝突の通知と復元、台帳の重複検出・統合・取り消し、重複ではない、操作ログ
const { chromium, devices } = require('playwright');
const { createMock } = require('./supabase-mock.cjs');
const out = process.argv[2] || require('os').tmpdir();
const URL_ = 'http://localhost:4173/geoboard/';
const failures = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'OK ' : 'NG '} ${label}${detail ? ` | ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

(async () => {
  const mock = createMock();
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const mk = async (name, device) => {
    const ctx = await b.newContext({ ...(device ? devices[device] : { viewport: { width: 1360, height: 900 } }), deviceScaleFactor: 1, permissions: ['camera'], serviceWorkers: 'block' });
    await ctx.route('https://fmmqxpunqxwxrsicfbev.supabase.co/**', (r) => mock.handle(r));
    const p = await ctx.newPage();
    p.errs = [];
    p.on('pageerror', (e) => p.errs.push(e.message));
    p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(m.text()) && p.errs.push(m.text()));
    p.on('dialog', (d) => d.accept());
    p.ctx = ctx;
    p.name = name;
    return p;
  };
  const shot = (p, n) => p.screenshot({ path: `${out}/${n}.png` });
  const login = async (p, email, pw, hash = '') => {
    await p.goto(URL_ + hash);
    await p.getByLabel('メールアドレス').fill(email);
    await p.getByLabel('パスワード').fill(pw);
    await p.getByRole('button', { name: 'ログイン' }).click();
  };
  const unsynced = (p) =>
    p.evaluate(async () => {
      const r = indexedDB.open('geoboard');
      await new Promise((res) => (r.onsuccess = res));
      let n = 0;
      for (const t of ['customers', 'ledgers', 'records', 'extras', 'templates']) {
        const q = r.result.transaction(t).objectStore(t).getAll();
        await new Promise((res) => (q.onsuccess = res));
        n += q.result.filter((x) => x.syncStatus !== 'synced').length;
      }
      r.result.close();
      return n;
    });
  const waitSynced = async (p) => {
    for (let i = 0; i < 60; i++) {
      if ((await unsynced(p)) === 0) return;
      await p.waitForTimeout(500);
    }
    throw new Error(`${p.name}: not synced`);
  };
  // 同期を促す（アプリに戻った扱い）して、終わるまで待つ
  const syncNow = async (p) => {
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await p.waitForTimeout(1500);
    await waitSynced(p);
    await p.waitForTimeout(800);
  };
  const shoot = async (p) => {
    await p.getByRole('button', { name: '撮影', exact: true }).click();
    await p.getByRole('button', { name: '撮影に進む' }).click();
    await p.waitForSelector('.overlay-board canvas');
    await p.waitForTimeout(300);
    await p.getByLabel('撮影', { exact: true }).click();
    await p.waitForSelector('.confirm-img');
    await p.getByRole('button', { name: '保存', exact: true }).click();
    await p.waitForSelector('.rec-item');
  };
  const openLedger = async (p, customer, ledger) => {
    await p.locator('.card-main', { hasText: customer }).first().click();
    await p.locator('.ledger-card', { hasText: ledger }).first().click();
    await p.waitForSelector('.statusbar');
  };
  const editMemo = async (p, memo, handover) => {
    await p.locator('.rec-item').first().click();
    await p.getByLabel('メモ（補足・訂正。レポートに載ります）').fill(memo);
    if (handover != null) await p.locator('.notes-card textarea').nth(1).fill(handover);
    await p.getByRole('button', { name: 'メモと引継ぎ事項を保存' }).click();
    await p.waitForTimeout(300);
    await p.getByLabel('戻る').click();
  };
  const serverRecord = () => [...mock.store.records.values()][0];
  const ledgerByName = (n) => [...mock.store.ledgers.values()].find((l) => l.name === n);

  // ---- 準備：A（管理者）が顧客・台帳・記録を作る。B（一般）も同じ台帳を開く
  const A = await mk('A', 'Pixel 7');
  const B = await mk('B', 'Pixel 7');
  await login(A, 'ashida@example.com', 'pass-a');
  await A.waitForSelector('text=顧客一覧');
  await A.getByRole('button', { name: '顧客を追加' }).click();
  await A.getByPlaceholder('例：〇〇町役場').fill('テスト村役場');
  await A.getByRole('button', { name: '保存', exact: true }).click();
  await A.getByRole('button', { name: '台帳を追加' }).click();
  await A.getByPlaceholder('例：インフラ設置工事').fill('中継器設置工事');
  await A.getByRole('button', { name: '保存', exact: true }).click();
  await A.waitForSelector('text=まだ記録がありません');
  await shoot(A);
  await syncNow(A);
  await login(B, 'michi@example.com', 'pass-m');
  await B.waitForSelector('text=テスト村役場');
  await openLedger(B, 'テスト村役場', '中継器設置工事');
  await B.waitForSelector('.rec-item');

  // ---- 1. 同じ項目を圏外で同時に編集 → 後から送った方を採用し、上書きされた人に通知
  await A.ctx.setOffline(true);
  await B.ctx.setOffline(true);
  await editMemo(A, 'Aのメモ');
  await editMemo(B, 'Bのメモ', 'Bの引継ぎ');
  // 違う項目：Aは台帳の工事責任者、Bは台帳の備考を変える
  for (const [p, label, value] of [[A, '工事責任者', '芦田'], [B, '備考', '山頂の中継器']]) {
    await p.getByLabel('台帳情報').click();
    await p.getByLabel(label).fill(value);
    await p.getByRole('button', { name: '保存', exact: true }).click();
    await p.waitForSelector('.statusbar');
  }
  await A.ctx.setOffline(false);
  await syncNow(A);
  await B.ctx.setOffline(false);
  await syncNow(B);
  const rec = serverRecord();
  check('同じ項目は後から送った内容（B）', rec.memo === 'Bのメモ' && rec.handover === 'Bの引継ぎ', `memo=${rec.memo} handover=${rec.handover}`);
  const l1 = ledgerByName('中継器設置工事');
  check('違う項目は両方反映（台帳の責任者と備考）', l1.manager === '芦田' && l1.note === '山頂の中継器', `manager=${l1.manager} note=${l1.note}`);
  const conflicts = mock.logs.filter((l) => l.action === 'conflict_overwrite');
  check('衝突が履歴に残る', conflicts.length === 1 && conflicts[0].field === 'memo' && conflicts[0].before === 'Aのメモ', JSON.stringify(conflicts.map((c) => [c.field, c.before, c.after])));
  const notes = [...mock.store.notifications.values()].filter((n) => n.type === 'conflict');
  check('上書きされたA（管理者）にだけ通知、操作したBには送らない', notes.length === 1 && notes[0].user_id === mock.profiles.get('11111111-1111-4111-8111-111111111111').user_id, notes.map((n) => n.user_id).join(','));

  // ---- 2. Aのスマホ：通知 → 作業記録 → 変更履歴 → 変更前の内容に戻す
  await syncNow(A);
  const bell = A.getByRole('button', { name: /通知/ }).first();
  check('通知アイコンに未読件数', /未読1件/.test((await bell.getAttribute('aria-label')) ?? ''), await bell.getAttribute('aria-label'));
  await bell.click();
  await A.waitForSelector('.notif-item');
  const notifText = await A.locator('.notif-item').first().innerText();
  check('衝突の通知の文面', /同時編集で内容が上書きされました/.test(notifText) && /メモ/.test(notifText) && /芦田さんの入力を、道さんの編集で上書き/.test(notifText), notifText.replace(/\n/g, ' / '));
  await shot(A, 's4-01-notifications');
  await A.getByRole('button', { name: '作業記録を開く' }).click();
  await A.waitForSelector('text=作業記録');
  await A.getByRole('button', { name: '変更履歴' }).click();
  await A.waitForSelector('.history-item');
  await shot(A, 's4-02-history');
  const conflictItem = A.locator('.history-item.conflict');
  check('変更履歴に衝突の項目', (await conflictItem.count()) === 1, await conflictItem.first().innerText().catch(() => ''));
  await conflictItem.getByRole('button', { name: '変更前の内容に戻す' }).click();
  await A.waitForSelector('text=戻しました');
  await syncNow(A);
  check('戻した内容がサーバーに反映', serverRecord().memo === 'Aのメモ', serverRecord().memo);
  check('自分の内容に戻しただけでは衝突にならない', mock.logs.filter((l) => l.action === 'conflict_overwrite').length === 1);
  const unreadAfter = [...mock.store.notifications.values()].filter((n) => n.type === 'conflict' && !n.read_at).length;
  check('開いた通知は既読がサーバーに届く', unreadAfter === 0);

  // ---- 3. 重複の検出：Bが似た名前の台帳を作り、記録を撮る
  await B.getByLabel('戻る').click();
  await B.waitForSelector('text=台帳を追加');
  await B.getByRole('button', { name: '台帳を追加' }).click();
  await B.getByPlaceholder('例：インフラ設置工事').fill('中継器設置');
  await B.getByRole('button', { name: '保存', exact: true }).click();
  await B.waitForSelector('text=まだ記録がありません');
  await shoot(B);
  await syncNow(B);
  const dupNotes = [...mock.store.notifications.values()].filter((n) => n.type === 'duplicate_candidate');
  check('重複候補の通知が管理者に届く', dupNotes.length === 1 && dupNotes[0].user_id === '11111111-1111-4111-8111-111111111111', JSON.stringify(dupNotes.map((n) => n.payload.names)));

  // ---- 4. PCで比較して統合
  const preMerge = Object.fromEntries([...mock.store.ledgers.values()].map((l) => [l.id, { name: l.name, manager: l.manager }]));
  const P = await mk('PC');
  await login(P, 'ashida@example.com', 'pass-a', '#admin');
  await P.waitForSelector('.admin-nav');
  await P.waitForTimeout(2500);
  const dupNav = P.locator('.admin-nav button', { hasText: '重複候補・統合' });
  check('PCのメニューに重複候補のバッジ', (await dupNav.locator('.admin-badge').innerText().catch(() => '')) === '1');
  await P.locator('.admin-nav button', { hasText: '通知' }).click();
  await P.waitForSelector('.notif-item');
  await shot(P, 's4-03-pc-notifications');
  await P.getByRole('button', { name: '比較して統合' }).first().click();
  await P.waitForSelector('.merge-table');
  // 工事名称は「中継器設置工事」、責任者は「芦田」を残す（初期値は記録の多い方。同数なら先の方）
  // Aが最初に作った「中継器設置工事」を残す台帳にする（Bが開いている「中継器設置」が統合される側）
  const nameCells = await P.locator('.merge-table tbody tr', { hasText: '工事名称' }).locator('td').allInnerTexts();
  const col = nameCells.findIndex((t) => t.trim() === '中継器設置工事');
  await P.locator('.merge-table thead th').nth(col + 1).locator('input').check();
  const targetHead = await P.locator('.merge-table thead th').nth(col + 1).innerText();
  await shot(P, 's4-04-merge');
  await P.getByRole('button', { name: '統合する' }).click();
  await P.waitForSelector('text=重複候補はありません', { timeout: 15000 });
  const source = [...mock.store.ledgers.values()].find((l) => l.merged_into);
  const target = source && mock.store.ledgers.get(source.merged_into);
  check('統合：統合された台帳に merged_into、選んだ工事名称が残る', !!source && preMerge[source.id].name === '中継器設置' && target?.name === '中継器設置工事', `${preMerge[source?.id]?.name} → ${target?.name} / ${targetHead}`);
  check('統合：作業記録が統合先にまとまる', [...mock.store.records.values()].every((r) => r.ledger_id === target.id), [...mock.store.records.values()].map((r) => r.ledger_id === target.id).join(','));

  // ---- 5. Bは統合を知らないまま圏外で旧台帳に撮影 → 送ると統合先に入る。開いていた台帳は統合先に切り替わる
  await B.ctx.setOffline(true);
  await shoot(B);
  await B.ctx.setOffline(false);
  await syncNow(B);
  await B.waitForTimeout(1000);
  check('統合後に旧台帳へ送られた記録も統合先へ', [...mock.store.records.values()].every((r) => r.ledger_id === target.id), `${mock.store.records.size}件`);
  const bTitle = await B.locator('.appbar-title h1').innerText();
  const bCount = await B.locator('.rec-item').count();
  check('Bの画面は統合先の台帳に切り替わり、記録がまとまっている', bTitle === '中継器設置工事' && bCount === 3, `${bTitle} ${bCount}件`);
  await shot(B, 's4-05-b-merged');

  // ---- 6. 統合の取り消し
  await P.locator('.admin-nav button', { hasText: '重複候補・統合' }).click();
  await P.getByRole('button', { name: '統合の取り消し' }).click();
  await P.waitForTimeout(2500);
  const src2 = mock.store.ledgers.get(source.id);
  const moved = [...mock.store.records.values()].filter((r) => r.ledger_id === source.id).length;
  check('取り消し：台帳が戻り、統合で移した記録が戻る', !src2.merged_into && moved === 1, `merged_into=${src2.merged_into} 戻った記録=${moved}`);
  const t2 = mock.store.ledgers.get(target.id);
  check('取り消し：統合先の台帳情報が統合前の値に戻る', t2.name === preMerge[target.id].name && t2.manager === preMerge[target.id].manager, `${t2.name} / ${t2.manager}`);
  await P.waitForSelector('.dup-card');

  // ---- 7. 重複ではない → 以後候補に出ない
  await P.getByRole('button', { name: '重複ではない' }).click();
  await P.waitForSelector('text=重複候補はありません', { timeout: 10000 });
  check('重複ではないペアはサーバーに保存', mock.store.duplicate_dismissals.size === 1);
  await P.reload();
  await P.waitForSelector('.admin-nav');
  await P.waitForTimeout(2500);
  await P.locator('.admin-nav button', { hasText: '重複候補・統合' }).click();
  check('再読み込み後も候補に出ない', (await P.locator('.dup-card').count()) === 0);

  // ---- 8. 操作ログ
  await P.locator('.admin-nav button', { hasText: '操作ログ' }).click();
  await P.waitForSelector('.history-item');
  const logText = await P.locator('.history-list').innerText();
  check('操作ログに作成・変更・衝突・統合・取り消し', ['作成', '変更', '同時編集で上書き', '統合', '統合の取り消し'].every((w) => logText.includes(w)));
  await shot(P, 's4-06-pc-logs');
  // 作業記録の変更履歴（PC）
  await P.locator('.admin-nav button', { hasText: '顧客・台帳' }).click();
  await P.locator('.admin-table tr', { hasText: '中継器設置工事' }).click();
  await P.locator('.admin-card').first().click();
  await P.locator('.admin-record-history summary').click();
  await P.waitForSelector('.admin-record-history .history-item');
  check('PCの作業記録に変更履歴', (await P.locator('.admin-record-history .history-item').count()) >= 3);
  await shot(P, 's4-07-pc-record-history');

  // ---- 9. 保存容量と古い写真のお掃除
  const rec0 = [...mock.store.records.values()].find((r) => r.composite_path);
  const dir = rec0.composite_path.split('/').slice(0, -1).join('/');
  const old = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
  const put = (name, iso, size = 3000) => { mock.files.set(`${dir}/${name}`, Buffer.alloc(size)); mock.fileTimes.set(`${dir}/${name}`, iso); };
  put(`${rec0.id}_composite_oldrev1.jpg`, old); // 黒板修正前の古い版（消してよい）
  put(`${rec0.id}_thumb_oldrev1.jpg`, old, 500); // 同上
  put(`${rec0.id}_composite_newrev.jpg`, new Date().toISOString()); // 24時間以内（送信途中の可能性があるので残す）
  put(`aaaaaaaa-0000-4000-8000-000000000000_composite_x.jpg`, old); // 記録がサーバーにない（残す）
  const deletedRec = { ...rec0, id: 'bbbbbbbb-0000-4000-8000-000000000000', deleted_at: old, composite_path: `${dir}/bbbbbbbb-0000-4000-8000-000000000000_composite_r.jpg` };
  mock.store.records.set(deletedRec.id, { ...deletedRec, server_updated_at: new Date().toISOString() });
  put(`bbbbbbbb-0000-4000-8000-000000000000_composite_r.jpg`, old); // 削除済みの記録の写真（復元用に残す）
  const before = new Set(mock.files.keys());
  await P.locator('.admin-modal-backdrop').click({ position: { x: 5, y: 5 } });
  await P.locator('.admin-nav button', { hasText: '保存容量' }).click();
  await P.getByRole('button', { name: '使用量を調べる' }).click();
  await P.waitForSelector('.storage-card');
  const storageText = await P.locator('.admin-page').innerText();
  check('使用量と古い写真の件数', /古い写真|使われなくなった写真が 2ファイル/.test(storageText) && /2ファイル/.test(storageText), storageText.replace(/\n/g, ' / ').slice(0, 300));
  await shot(P, 's4-08-storage');
  await P.getByRole('button', { name: '古い写真を削除' }).click();
  await P.waitForSelector('text=使われなくなった古い写真はありません', { timeout: 10000 });
  const removed = [...before].filter((k) => !mock.files.has(k));
  check('古い版だけ削除し、表示中・24時間以内・未登録・削除済みの写真は残す', removed.length === 2 && removed.every((k) => /oldrev1/.test(k)), removed.join(','));

  // ---- 10. パスワードの変更（B）
  await B.getByLabel('戻る').click();
  await B.getByLabel('戻る').click();
  await B.getByLabel('設定').click();
  await B.getByRole('button', { name: 'パスワードを変更' }).click();
  await B.getByLabel('今のパスワード').fill('wrong-pass');
  await B.getByLabel('新しいパスワード（8文字以上）').fill('new-pass-123');
  await B.getByLabel('新しいパスワード（確認）').fill('new-pass-123');
  await B.getByRole('button', { name: '変更する' }).click();
  await B.waitForSelector('.password-form .danger');
  check('今のパスワードが違うと変更できない', (await B.locator('.password-form .danger').innerText()).includes('今のパスワードが違います') && mock.users['michi@example.com'].password === 'pass-m');
  await B.getByLabel('今のパスワード').fill('pass-m');
  await B.getByRole('button', { name: '変更する' }).click();
  await B.waitForSelector('text=パスワードを変更しました');
  check('パスワードを変更できる', mock.users['michi@example.com'].password === 'new-pass-123');
  await shot(B, 's4-09-password');
  await B.getByRole('button', { name: 'ログアウト' }).click();
  await B.waitForSelector('.login-form');
  await B.getByLabel('メールアドレス').fill('michi@example.com');
  await B.getByLabel('パスワード').fill('new-pass-123');
  await B.getByRole('button', { name: 'ログイン' }).click();
  await B.waitForSelector('text=顧客一覧');
  check('新しいパスワードでログインできる', true);

  check('画面のエラーなし', A.errs.length + B.errs.length + P.errs.length === 0, JSON.stringify([A.errs, B.errs, P.errs]));
  check('モックの列・経路エラーなし', mock.errors.length === 0, JSON.stringify(mock.errors));
  await b.close();
  console.log(failures.length ? `FAILED: ${failures.length}` : 'ALL PASSED');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
