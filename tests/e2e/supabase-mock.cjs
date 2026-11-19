// Supabase のモック（auth / PostgREST / Storage の必要部分のみ）。列名はマイグレーションのSQLと照合する
const fs = require('fs');
const path = require('path');
const migDir = path.join(__dirname, '../../supabase/migrations');
const sql = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort().map((f) => fs.readFileSync(path.join(migDir, f), 'utf8')).join('\n');
const columns = {};
for (const m of sql.matchAll(/create table public\.(\w+) \(([\s\S]*?)\n\);/g)) {
  columns[m[1]] = m[2].split('\n').map((l) => l.trim().split(/\s+/)[0]).filter((c) => c && /^[a-z_]+$/.test(c) && !['primary', 'check', 'unique'].includes(c));
}
for (const m of sql.matchAll(/alter table public\.(\w+) add column (\w+)/g)) columns[m[1]].push(m[2]);

// 台帳名の類似判定（step4 の ledger_names_similar と同じ）
const normName = (s) => (s || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}・「」『』（）【】〔〕［］｛｝〈〉《》、。，．：；！？ー－―‐~～]/gu, '');
function lev(a, b) {
  const x = [...a], y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[y.length];
}
function similar(a, b) {
  const x = normName(a), y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const s = Math.min([...x].length, [...y].length);
  if (s >= 2 && (x.includes(y) || y.includes(x))) return true;
  if (s < 3) return false;
  return lev(x, y) <= (s <= 4 ? 1 : 2);
}
const SILENT = ['last_board', 'composite_path', 'original_path', 'thumb_path', 'image_width', 'image_height'];
const META = ['id', 'created_by', 'created_at', 'updated_at', 'server_updated_at', 'field_updated_at', 'sync_base'];
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function createMock() {
  const users = {
    'ashida@example.com': { id: '11111111-1111-4111-8111-111111111111', password: 'pass-a' },
    'michi@example.com': { id: '22222222-2222-4222-8222-222222222222', password: 'pass-m' },
  };
  const store = { customers: new Map(), ledgers: new Map(), records: new Map(), record_extras: new Map(), blackboard_templates: new Map(), notifications: new Map(), duplicate_dismissals: new Map() };
  const logs = [];
  const profiles = new Map([
    [users['ashida@example.com'].id, { user_id: users['ashida@example.com'].id, display_name: '芦田', role: 'admin', disabled: false, updated_at: new Date().toISOString() }],
    [users['michi@example.com'].id, { user_id: users['michi@example.com'].id, display_name: '道', role: 'member', disabled: false, updated_at: new Date().toISOString() }],
  ]);
  const files = new Map();
  const fileTimes = new Map();
  const errors = [];
  const failRecordIds = new Set();
  let codeSeq = 0;
  let clock = Date.now();
  const tick = () => new Date(++clock).toISOString();
  let suppress = false;
  const log = (uid, table, id, action, field, before, after, overwritten = null) => {
    if (suppress) return;
    logs.push({ id: require('crypto').randomUUID(), target_table: table, target_id: id, action, field, before: before ?? null, after: after ?? null, user_id: uid, overwritten_user_id: overwritten, created_at: tick() });
  };
  const notify = (type, payload, extra = null, skipSelf = null) => {
    for (const p of profiles.values()) {
      if (!((p.role === 'admin' && !p.disabled) || p.user_id === extra)) continue;
      if (skipSelf && p.user_id === skipSelf) continue;
      const id = require('crypto').randomUUID();
      const t = tick();
      store.notifications.set(id, { id, user_id: p.user_id, type, payload, read_at: null, created_at: t, server_updated_at: t });
    }
  };
  const actOf = (f, v) => (f === 'deleted_at' ? (v == null ? 'restore' : 'delete') : 'update');
  // merge_update（項目単位のマージ）と同じ処理
  function mergeUpdate(t, prev, r, uid) {
    const base = r.sync_base;
    const meta = { ...(prev.field_updated_at || {}) };
    if (!base) {
      if (r.updated_at < prev.updated_at) return prev;
      for (const f of Object.keys(r)) {
        if (META.includes(f) || same(r[f], prev[f])) continue;
        if (!SILENT.includes(f)) { const a = actOf(f, r[f]); log(uid, t, prev.id, a, a === 'update' ? f : null, prev[f], r[f]); }
        meta[f] = { at: tick(), by: uid };
      }
      return { ...prev, ...r, field_updated_at: meta, sync_base: null };
    }
    const res = { ...prev };
    for (const f of Object.keys(base)) {
      if (META.includes(f) || !(f in prev) && !columns[t].includes(f)) continue;
      if (same(r[f], prev[f])) continue;
      if (SILENT.includes(f)) { res[f] = r[f]; continue; }
      const lastBy = meta[f]?.by ?? prev.created_by ?? '';
      const a = actOf(f, r[f]);
      if (a === 'update' && !same(prev[f], base[f]) && lastBy !== uid && lastBy) {
        log(uid, t, prev.id, 'conflict_overwrite', f, prev[f], r[f], lastBy);
        if (!suppress) notify('conflict', { table: t, target_id: prev.id, field: f, ledger_id: t === 'records' ? prev.ledger_id : prev.id, by: uid, overwritten: lastBy, label: prev.name ?? null }, lastBy, uid);
      } else {
        log(uid, t, prev.id, a, a === 'update' ? f : null, prev[f], r[f]);
      }
      res[f] = r[f];
      meta[f] = { at: tick(), by: uid };
    }
    res.field_updated_at = meta;
    res.sync_base = null;
    res.updated_at = prev.updated_at > r.updated_at ? prev.updated_at : r.updated_at;
    return res;
  }
  function detectDuplicates(row) {
    if (row.deleted_at || row.merged_into) return;
    for (const o of store.ledgers.values()) {
      if (o.id === row.id || o.customer_id !== row.customer_id || o.deleted_at || o.merged_into || !similar(o.name, row.name)) continue;
      const [a, b] = row.id < o.id ? [row.id, o.id] : [o.id, row.id];
      if (store.duplicate_dismissals.has(`${a}:${b}`)) continue;
      if ([...store.notifications.values()].some((n) => n.type === 'duplicate_candidate' && n.payload.ledger_a === a && n.payload.ledger_b === b)) continue;
      notify('duplicate_candidate', { ledger_a: a, ledger_b: b, customer_id: row.customer_id, names: [row.name, o.name] });
    }
  }
  const tokenFor = (u, email) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
  const userFromAuth = (h) => {
    const t = (h.authorization || '').replace('Bearer ', '');
    try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).sub; } catch { return null; }
  };
  async function handle(route) {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (p === '/auth/v1/token') {
      const { email, password } = JSON.parse(req.postData() || '{}');
      const u = users[email];
      if (!u || u.password !== password) return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 'invalid_credentials' });
      const token = tokenFor(u, email);
      return json(200, { access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r-' + u.id, user: { id: u.id, email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
    }
    if (p === '/auth/v1/user' && req.method() === 'PUT') {
      const uidP = userFromAuth(req.headers());
      const entry = Object.entries(users).find(([, u]) => u.id === uidP);
      if (!entry) return json(401, { msg: 'not authenticated' });
      const { password } = JSON.parse(req.postData() || '{}');
      if (password === entry[1].password) return json(422, { code: 'same_password', msg: 'New password should be different from the old password.' });
      entry[1].password = password;
      return json(200, { id: entry[1].id, email: entry[0], aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });
    }
    if (p.startsWith('/auth/v1/')) return route.fulfill({ status: 204, body: '' });
    const uid = userFromAuth(req.headers());
    if (p.startsWith('/rest/v1/') && !uid) return json(401, { code: 'PGRST301', message: 'JWT expired' });
    const me = profiles.get(uid);
    if (p === '/rest/v1/profiles') {
      if (req.method() === 'PATCH') {
        const id = url.searchParams.get('user_id').replace('eq.', '');
        Object.assign(profiles.get(id), JSON.parse(req.postData()), { updated_at: tick() });
        return route.fulfill({ status: 204, body: '' });
      }
      return json(200, me ? [...profiles.values()] : []);
    }
    if (p === '/rest/v1/change_logs') {
      if (!me || me.disabled) return json(200, []);
      let rows = [...logs].sort((a, b) => b.created_at.localeCompare(a.created_at));
      const tid = url.searchParams.get('target_id');
      if (tid) { const ids = tid.replace(/^in\.\(/, '').replace(/\)$/, '').split(',').map((s) => s.replace(/"/g, '')); rows = rows.filter((r) => ids.includes(r.target_id)); }
      const lt = url.searchParams.get('created_at');
      if (lt) rows = rows.filter((r) => r.created_at < lt.replace('lt.', ''));
      return json(200, rows.slice(0, Number(url.searchParams.get('limit') || 1000)));
    }
    if (p === '/rest/v1/notifications' && req.method() === 'PATCH') {
      const ids = (url.searchParams.get('id') || '').replace(/^in\.\(/, '').replace(/\)$/, '').split(',').map((s) => s.replace(/"/g, ''));
      const body = JSON.parse(req.postData());
      for (const id of ids) { const n = store.notifications.get(id); if (n && n.user_id === uid) Object.assign(n, { read_at: body.read_at, server_updated_at: tick() }); }
      return route.fulfill({ status: 204, body: '' });
    }
    if (p === '/rest/v1/notifications') {
      const since = (url.searchParams.get('server_updated_at') || '').replace('gt.', '');
      const rows = [...store.notifications.values()].filter((n) => n.user_id === uid && (!since || n.server_updated_at > since)).sort((a, b) => a.server_updated_at.localeCompare(b.server_updated_at));
      return json(200, rows.slice(0, Number(url.searchParams.get('limit') || 1000)));
    }
    if (p === '/rest/v1/duplicate_dismissals') {
      if (req.method() === 'POST') {
        if (me?.role !== 'admin') return json(403, { code: '42501', message: 'new row violates row-level security policy' });
        for (const r of JSON.parse(req.postData())) {
          const k = `${r.ledger_a}:${r.ledger_b}`;
          if (!store.duplicate_dismissals.has(k)) store.duplicate_dismissals.set(k, { ...r, dismissed_by: uid, created_at: tick(), server_updated_at: tick() });
        }
        return route.fulfill({ status: 201, body: '' });
      }
      const since = (url.searchParams.get('server_updated_at') || '').replace('gt.', '');
      return json(200, [...store.duplicate_dismissals.values()].filter((r) => !since || r.server_updated_at > since));
    }
    if (p === '/rest/v1/rpc/merge_ledgers' || p === '/rest/v1/rpc/unmerge_ledger') {
      if (me?.role !== 'admin' || me.disabled) return json(400, { code: 'P0001', message: '権限がありません' });
      const a = JSON.parse(req.postData());
      const now = tick();
      if (p.endsWith('merge_ledgers') && !p.endsWith('unmerge_ledger')) {
        const t = store.ledgers.get(a.p_target), s = store.ledgers.get(a.p_source);
        if (!t || !s) return json(400, { message: '台帳が見つかりません' });
        if (t.merged_into || s.merged_into) return json(400, { message: 'すでに統合された台帳です' });
        const before = { name: t.name, start_date: t.start_date, end_date: t.end_date, manager: t.manager, note: t.note };
        const moved = [...store.records.values()].filter((r) => r.ledger_id === s.id).map((r) => r.id);
        const f = a.p_fields;
        Object.assign(t, {
          name: f.name ?? t.name, manager: f.manager ?? t.manager, note: f.note ?? t.note,
          start_date: 'start_date' in f ? f.start_date || null : t.start_date, end_date: 'end_date' in f ? f.end_date || null : t.end_date,
          updated_at: now, server_updated_at: tick(),
        });
        for (const id of moved) Object.assign(store.records.get(id), { ledger_id: t.id, server_updated_at: tick() });
        Object.assign(s, { merged_into: t.id, updated_at: now, server_updated_at: tick() });
        logs.push({ id: require('crypto').randomUUID(), target_table: 'ledgers', target_id: t.id, action: 'merge', field: null, before: { target_fields: before }, after: { source: s.id, source_name: s.name, fields: f, moved_records: moved }, user_id: uid, overwritten_user_id: null, created_at: tick() });
      } else {
        const s = store.ledgers.get(a.p_source);
        if (!s || !s.merged_into) return json(400, { message: '統合されていない台帳です' });
        const t = store.ledgers.get(s.merged_into);
        const m = [...logs].reverse().find((l) => l.action === 'merge' && l.target_id === t.id && l.after.source === s.id);
        if (m) {
          for (const id of m.after.moved_records) { const r = store.records.get(id); if (r && r.ledger_id === t.id) Object.assign(r, { ledger_id: s.id, server_updated_at: tick() }); }
          Object.assign(t, m.before.target_fields, { updated_at: now, server_updated_at: tick() });
        }
        Object.assign(s, { merged_into: null, updated_at: now, server_updated_at: tick() });
        logs.push({ id: require('crypto').randomUUID(), target_table: 'ledgers', target_id: t.id, action: 'unmerge', field: null, before: null, after: { source: s.id, source_name: s.name }, user_id: uid, overwritten_user_id: null, created_at: tick() });
      }
      return route.fulfill({ status: 204, body: '' });
    }
    const tm = p.match(/^\/rest\/v1\/(\w+)$/);
    if (tm && store[tm[1]]) {
      const t = tm[1];
      if (req.method() === 'POST') {
        const rows = JSON.parse(req.postData());
        for (const r of rows) {
          for (const k of Object.keys(r)) if (!columns[t].includes(k)) errors.push(`${t}: unknown column "${k}"`);
          if (t === 'records' && failRecordIds.has(r.id)) return json(500, { message: 'テスト用のサーバーエラー' });
          if (me?.disabled && !['records', 'record_extras'].includes(t)) return json(400, { message: 'アカウントが停止されています' });
          // 外部キー（本物のデータベースと同じく、親がないと登録できない）
          const fk = { ledgers: ['customer_id', 'customers'], records: ['ledger_id', 'ledgers'], record_extras: ['record_id', 'records'] }[t];
          if (fk && !store[fk[1]].has(r[fk[0]])) return json(409, { code: '23503', message: `insert or update on table "${t}" violates foreign key constraint "${t}_${fk[0]}_fkey"` });
          const prev = store[t].get(r.id);
          // 台帳・作業記録は mergeUpdate で判定する（古い更新でも、編集した項目は反映する）
          if (prev && r.updated_at < prev.updated_at && t !== 'ledgers' && t !== 'records') continue;
          // 論理削除の権限（本物のguard_soft_deleteと同じ）
          if (prev && r.deleted_at && !prev.deleted_at && me?.role !== 'admin') {
            const own = ['records', 'record_extras', 'blackboard_templates'].includes(t) && prev.created_by === uid;
            if (!own) return json(400, { code: 'P0001', message: '削除する権限がありません' });
          }
          let row;
          if (prev && (t === 'ledgers' || t === 'records')) {
            row = mergeUpdate(t, prev, r, uid);
            if (row === prev) continue;
          } else {
            if (prev && t !== 'blackboard_templates') {
              for (const f of Object.keys(r)) {
                if (META.includes(f) || SILENT.includes(f) || ['path', 'thumb_path', 'code'].includes(f) || same(r[f], prev[f])) continue;
                const a = actOf(f, r[f]);
                log(uid, t, prev.id, a, a === 'update' ? f : null, prev[f], r[f]);
              }
            }
            row = { ...prev, ...r };
          }
          row = { ...row, server_updated_at: tick() };
          if (!prev) {
            row.created_by = uid;
            if (t === 'ledgers' || t === 'records') row.field_updated_at = {};
            // 統合済みの台帳に送られてきた記録は統合先へ（redirect_merged_ledger）
            if (t === 'records') { let l = store.ledgers.get(row.ledger_id); while (l && l.merged_into) { row.ledger_id = l.merged_into; l = store.ledgers.get(row.ledger_id); } }
            if (t !== 'blackboard_templates') log(uid, t, row.id, 'create', null, null, null);
            if (t === 'customers' && row.is_provisional && !row.deleted_at) notify('provisional_customer', { customer_id: row.id, name: row.name });
          }
          if (t === 'customers' && !row.is_provisional && !row.code) row.code = 'C-' + String(++codeSeq).padStart(4, '0');
          store[t].set(r.id, row);
          if (t === 'ledgers' && (!prev || prev.name !== row.name || prev.customer_id !== row.customer_id || prev.deleted_at !== row.deleted_at || prev.merged_into !== row.merged_into)) detectDuplicates(row);
        }
        return route.fulfill({ status: 201, body: '' });
      }
      if (!me || me.disabled) return json(200, []);
      const since = (url.searchParams.get('server_updated_at') || '').replace('gt.', '');
      const limit = Number(url.searchParams.get('limit') || 1000);
      const rows = [...store[t].values()].filter((r) => !since || r.server_updated_at > since).sort((a, b) => a.server_updated_at.localeCompare(b.server_updated_at)).slice(0, limit);
      return json(200, rows);
    }
    if (p === '/storage/v1/object/list/photos') {
      if (!me || me.disabled) return json(200, []);
      const { prefix = '', limit = 100, offset = 0 } = JSON.parse(req.postData() || '{}');
      const pre = prefix ? prefix.replace(/\/$/, '') + '/' : '';
      const seen = new Map();
      for (const [k, v] of files) {
        if (!k.startsWith(pre)) continue;
        const rest = k.slice(pre.length);
        const [head, ...tail] = rest.split('/');
        if (tail.length) seen.set(head, { name: head, id: null, metadata: null });
        else seen.set(head, { name: head, id: 'f-' + k, created_at: fileTimes.get(k), updated_at: fileTimes.get(k), metadata: { size: v.length } });
      }
      return json(200, [...seen.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(offset, offset + limit));
    }
    if (p === '/storage/v1/object/photos' && req.method() === 'DELETE') {
      if (me?.role !== 'admin' || me.disabled) return json(403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
      const { prefixes = [] } = JSON.parse(req.postData() || '{}');
      const removed = prefixes.filter((k) => files.delete(k)).map((k) => ({ name: k }));
      return json(200, removed);
    }
    const info = p.match(/^\/storage\/v1\/object\/info\/photos\/(.+)$/);
    if (info) {
      const f = files.get(decodeURIComponent(info[1]));
      return f ? json(200, { id: 'x', name: info[1], size: f.length, content_type: 'image/jpeg' }) : json(404, { message: 'not found' });
    }
    const obj = p.match(/^\/storage\/v1\/object\/photos\/(.+)$/);
    if (obj) {
      const path = decodeURIComponent(obj[1]);
      if (req.method() === 'POST' || req.method() === 'PUT') {
        let body = req.postDataBuffer();
        // supabase-js は Blob を multipart/form-data で送るので、ファイル部分を取り出す
        const ct = req.headers()['content-type'] || '';
        const bm = ct.match(/boundary=(.+)$/);
        if (bm) {
          const boundary = Buffer.from('--' + bm[1]);
          const parts = [];
          let i = body.indexOf(boundary);
          while (i !== -1) {
            const next = body.indexOf(boundary, i + boundary.length);
            if (next === -1) break;
            parts.push(body.subarray(i + boundary.length + 2, next - 2));
            i = next;
          }
          const file = parts.find((pt) => /filename=/.test(pt.subarray(0, 300).toString()));
          if (file) body = file.subarray(file.indexOf('\r\n\r\n') + 4);
        }
        files.set(path, body);
        fileTimes.set(path, new Date().toISOString());
        return json(200, { Key: 'photos/' + path, Id: 'x' });
      }
      const f = files.get(path);
      return f ? route.fulfill({ status: 200, contentType: 'image/jpeg', body: f }) : json(404, { message: 'not found' });
    }
    errors.push(`unhandled ${req.method()} ${p}`);
    return json(404, { message: 'mock: unhandled' });
  }
  return { handle, users, store, files, fileTimes, profiles, errors, failRecordIds, columns, logs };
}
module.exports = { createMock };
