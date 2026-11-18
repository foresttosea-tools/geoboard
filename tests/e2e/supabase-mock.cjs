// Supabase のモック（auth / PostgREST / Storage の必要部分のみ）。列名はマイグレーションのSQLと照合する
const fs = require('fs');
const sql = fs.readFileSync(require('path').join(__dirname, '../../supabase/migrations/20261116000000_initial.sql'), 'utf8');
const columns = {};
for (const m of sql.matchAll(/create table public\.(\w+) \(([\s\S]*?)\n\);/g)) {
  columns[m[1]] = m[2].split('\n').map((l) => l.trim().split(/\s+/)[0]).filter((c) => c && /^[a-z_]+$/.test(c));
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function createMock() {
  const users = {
    'ashida@example.com': { id: '11111111-1111-4111-8111-111111111111', password: 'pass-a' },
    'michi@example.com': { id: '22222222-2222-4222-8222-222222222222', password: 'pass-m' },
  };
  const store = { customers: new Map(), ledgers: new Map(), records: new Map(), record_extras: new Map(), blackboard_templates: new Map() };
  const profiles = new Map([
    [users['ashida@example.com'].id, { user_id: users['ashida@example.com'].id, display_name: '芦田', role: 'admin', disabled: false, updated_at: new Date().toISOString() }],
    [users['michi@example.com'].id, { user_id: users['michi@example.com'].id, display_name: '道', role: 'member', disabled: false, updated_at: new Date().toISOString() }],
  ]);
  const files = new Map();
  const errors = [];
  const failRecordIds = new Set();
  let codeSeq = 0;
  let clock = Date.now();
  const tick = () => new Date(++clock).toISOString();
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
          if (prev && r.updated_at < prev.updated_at) continue;
          // 論理削除の権限（本物のguard_soft_deleteと同じ）
          if (prev && r.deleted_at && !prev.deleted_at && me?.role !== 'admin') {
            const own = ['records', 'record_extras', 'blackboard_templates'].includes(t) && prev.created_by === uid;
            if (!own) return json(400, { code: 'P0001', message: '削除する権限がありません' });
          }
          const row = { ...prev, ...r, server_updated_at: tick() };
          if (!prev) row.created_by = uid;
          if (t === 'customers' && !row.is_provisional && !row.code) row.code = 'C-' + String(++codeSeq).padStart(4, '0');
          store[t].set(r.id, row);
        }
        return route.fulfill({ status: 201, body: '' });
      }
      if (!me || me.disabled) return json(200, []);
      const since = (url.searchParams.get('server_updated_at') || '').replace('gt.', '');
      const limit = Number(url.searchParams.get('limit') || 1000);
      const rows = [...store[t].values()].filter((r) => !since || r.server_updated_at > since).sort((a, b) => a.server_updated_at.localeCompare(b.server_updated_at)).slice(0, limit);
      return json(200, rows);
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
        return json(200, { Key: 'photos/' + path, Id: 'x' });
      }
      const f = files.get(path);
      return f ? route.fulfill({ status: 200, contentType: 'image/jpeg', body: f }) : json(404, { message: 'not found' });
    }
    errors.push(`unhandled ${req.method()} ${p}`);
    return json(404, { message: 'mock: unhandled' });
  }
  return { handle, store, files, profiles, errors, failRecordIds, columns };
}
module.exports = { createMock };
