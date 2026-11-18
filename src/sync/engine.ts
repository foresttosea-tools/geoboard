import type { Table } from 'dexie';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTable<T> = Table<T, string, any>;
import { db, onLocalChange, syncTransaction } from '../db';
import { diag } from '../lib/diag';
import { prefs } from '../lib/prefs';
import type { ExtraPhoto, StoredImage, SyncStatus, WorkRecord } from '../types';
import { getProvider } from './config';
import {
  customerFromRow,
  customerToRow,
  extraFromRow,
  extraToRow,
  ledgerFromRow,
  ledgerToRow,
  profileFromRemote,
  recordFromRow,
  recordToRow,
  templateFromRow,
  templateToRow,
} from './mapping';
import { AuthRequiredError, NetworkError, type RemoteRow } from './provider';

/**
 * 同期エンジン（要件7）
 * - 送信：顧客 → 台帳 → 作業記録（画像を送ってから行を登録）→ 追加写真 → 作成した黒板
 * - 受信：ほかの端末が登録・更新したデータを取り込む
 * - 送信済みの作業記録は、端末にはサムネイルだけ残す
 */

export interface SyncState {
  running: boolean;
  /** 作業記録・追加写真の送信の進み具合 */
  progress: { done: number; total: number } | null;
  lastSyncAt: string | null;
  lastError: string | null;
  offline: boolean;
  /** ログインし直しが必要 */
  authRequired: boolean;
  /** 管理者によってアカウントが停止された */
  accountDisabled: boolean;
  /** 利用者に一度だけ知らせたいこと */
  notice: string | null;
}

let state: SyncState = {
  running: false,
  progress: null,
  lastSyncAt: null,
  lastError: null,
  offline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
  authRequired: false,
  accountDisabled: false,
  notice: null,
};
const listeners = new Set<() => void>();
const setState = (patch: Partial<SyncState>) => {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
};
export const syncStore = {
  get: () => state,
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** サーバー側のエラーは間隔を空けて最大3回試す。通信できない・ログインが必要な場合はすぐ中断する（要件7.2） */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  const delays = [1000, 3000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      // 権限やアカウント停止による拒否は、やり直しても結果が変わらないので再試行しない
      const permanent = e instanceof Error && /権限がありません|停止されています/.test(e.message);
      if (e instanceof NetworkError || e instanceof AuthRequiredError || permanent || attempt >= delays.length) throw e;
      await sleep(delays[attempt]);
    }
  }
}

const isAbort = (e: unknown) => e instanceof NetworkError || e instanceof AuthRequiredError;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Syncable {
  id: string;
  updatedAt: string;
  syncStatus: SyncStatus;
}

/** 送信に成功した行を「送信済み」にする。送信中に端末で更新されていたら未送信のまま残す */
async function markSynced<T extends Syncable>(table: AnyTable<T>, sent: T[], extra?: (row: T) => Partial<T>) {
  await syncTransaction([table], async () => {
    for (const r of sent) {
      const cur = await table.get(r.id);
      if (cur && cur.updatedAt === r.updatedAt && cur.syncStatus !== 'synced') {
        await table.update(r.id, { syncStatus: 'synced', syncError: undefined, ...(extra?.(r) ?? {}) } as never);
      }
    }
  });
}

async function markFailed<T extends Syncable>(table: AnyTable<T>, id: string, error: string) {
  // 権限がなくて削除を断られた場合は、送信失敗にせず端末の削除を取り消す（次の受信でサーバーの内容に戻る）
  if (/削除する権限がありません/.test(error)) {
    await syncTransaction([table], async () => {
      await table.update(id, { deletedAt: null, syncStatus: 'synced', syncError: undefined } as never);
    });
    await db.meta.delete(`pull.${tableToRemote(table)}`);
    setState({ notice: '他の人が作成したものは削除できないため、元に戻しました' });
    diag('sync:delete-denied', id);
    return;
  }
  await syncTransaction([table], async () => {
    await table.update(id, { syncStatus: 'failed', syncError: error } as never);
  });
}

function tableToRemote(table: { name: string }): string {
  return ({ customers: 'customers', ledgers: 'ledgers', records: 'records', extras: 'record_extras', templates: 'blackboard_templates' } as Record<string, string>)[table.name] ?? table.name;
}

/** 顧客・台帳・作成した黒板：まとめて送り、失敗したら1件ずつ送って原因の行を特定する */
async function pushSimple<T extends Syncable>(
  table: AnyTable<T>,
  remote: 'customers' | 'ledgers' | 'blackboard_templates',
  toRow: (r: T) => RemoteRow,
) {
  const provider = getProvider();
  const rows = (await table.where('syncStatus').equals('pending').toArray()).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    try {
      await withRetry(() => provider.upsert(remote, chunk.map(toRow)));
      await markSynced(table, chunk);
    } catch (e) {
      if (isAbort(e)) throw e;
      for (const r of chunk) {
        try {
          await provider.upsert(remote, [toRow(r)]);
          await markSynced(table, [r]);
        } catch (e2) {
          if (isAbort(e2)) throw e2;
          await markFailed(table, r.id, message(e2));
        }
      }
    }
  }
}

/** 画像の保存場所：{顧客ID}/{台帳ID}/{記録ID}_{種類}.jpg（要件5.4） */
async function basePathFor(ledgerId: string) {
  const ledger = await db.ledgers.get(ledgerId);
  return `${ledger?.customerId ?? 'unknown'}/${ledgerId}`;
}

/**
 * 画像を送信する。送るたびにファイル名に版の印を付ける。
 * 同じファイル名に上書きすると、アプリやサーバーの一時保存（キャッシュ）から古い写真が出てしまうため
 * （黒板を修正して写真を作り直したときなど）
 */
async function uploadImages(
  images: StoredImage[],
  pathOf: (img: StoredImage, rev: string) => string,
  existing: Partial<Record<StoredImage['kind'], string | null | undefined>>,
): Promise<Record<string, string>> {
  const provider = getProvider();
  const paths: Record<string, string> = {};
  const rev = Date.now().toString(36);
  for (const img of images) {
    if (img.uploaded) {
      const known = img.path ?? existing[img.kind];
      if (known) {
        paths[img.kind] = known;
        continue;
      }
    }
    const path = pathOf(img, rev);
    diag('sync:upload', `${img.kind} ${Math.round(img.blob.size / 1024)}KB`);
    await withRetry(() => provider.uploadFile(path, img.blob));
    await db.images.update(img.key, { uploaded: true, path });
    paths[img.kind] = path;
  }
  return paths;
}

/** 送信済みになった記録の、端末内の大きい画像を消す（サムネイルは残す。要件7.1） */
async function dropFullImages(keys: string[]) {
  await db.images.bulkDelete(keys);
}

async function pushRecords(onProgress: () => void) {
  const pending = (await db.records.where('syncStatus').equals('pending').toArray()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const rec of pending) {
    try {
      const base = `${await basePathFor(rec.ledgerId)}/${rec.id}`;
      const images = await db.images
        .where('recordId')
        .equals(rec.id)
        .filter((i) => i.kind === 'composite' || i.kind === 'original' || i.kind === 'thumb')
        .toArray();
      const uploaded = await uploadImages(images, (img, rev) => `${base}_${img.kind}_${rev}.jpg`, {
        composite: rec.compositePath,
        original: rec.originalPath,
        thumb: rec.thumbPath,
      });
      const withPaths: WorkRecord = {
        ...rec,
        compositePath: uploaded.composite ?? rec.compositePath ?? null,
        originalPath: uploaded.original ?? rec.originalPath ?? null,
        thumbPath: uploaded.thumb ?? rec.thumbPath ?? null,
      };
      await withRetry(() => getProvider().upsert('records', [recordToRow(withPaths)]));
      await markSynced(db.records, [rec], () => ({
        compositePath: withPaths.compositePath,
        originalPath: withPaths.originalPath,
        thumbPath: withPaths.thumbPath,
      }));
      const now = await db.records.get(rec.id);
      if (now?.syncStatus === 'synced') {
        await dropFullImages(images.filter((i) => i.kind !== 'thumb').map((i) => i.key));
      }
    } catch (e) {
      if (isAbort(e)) throw e;
      await markFailed(db.records, rec.id, message(e));
    }
    onProgress();
  }
}

async function pushExtras(onProgress: () => void) {
  const pending = (await db.extras.where('syncStatus').equals('pending').toArray()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const x of pending) {
    try {
      const parent = await db.records.get(x.recordId);
      if (!parent) throw new Error('親の作業記録が見つかりません');
      if (parent.syncStatus !== 'synced') {
        // 親の記録がまだサーバーにない場合は次回に回す
        onProgress();
        continue;
      }
      const base = `${await basePathFor(parent.ledgerId)}/${x.recordId}_extra_${x.id}`;
      const images = await db.images.bulkGet([`${x.id}:extra`, `${x.id}:extra_thumb`]);
      const present = images.filter((i): i is StoredImage => i != null);
      const uploaded = await uploadImages(present, (img, rev) => (img.kind === 'extra' ? `${base}_${rev}.jpg` : `${base}_thumb_${rev}.jpg`), {
        extra: x.path,
        extra_thumb: x.thumbPath,
      });
      const withPaths: ExtraPhoto = { ...x, path: uploaded.extra ?? x.path ?? null, thumbPath: uploaded.extra_thumb ?? x.thumbPath ?? null };
      await withRetry(() => getProvider().upsert('record_extras', [extraToRow(withPaths)]));
      await markSynced(db.extras, [x], () => ({ path: withPaths.path, thumbPath: withPaths.thumbPath }));
      const now = await db.extras.get(x.id);
      if (now?.syncStatus === 'synced') await dropFullImages([`${x.id}:extra`]);
    } catch (e) {
      if (isAbort(e)) throw e;
      await markFailed(db.extras, x.id, message(e));
    }
    onProgress();
  }
}

async function push() {
  const total = (await db.records.where('syncStatus').equals('pending').count()) + (await db.extras.where('syncStatus').equals('pending').count());
  let done = 0;
  const onProgress = () => setState({ progress: { done: ++done, total } });
  if (total > 0) setState({ progress: { done: 0, total } });
  await pushSimple(db.customers, 'customers', customerToRow);
  await pushSimple(db.ledgers, 'ledgers', ledgerToRow);
  await pushRecords(onProgress);
  await pushExtras(onProgress);
  await pushSimple(db.templates, 'blackboard_templates', templateToRow);
}

// ---------------------------------------------------------------------------
// 受信
// ---------------------------------------------------------------------------

const PULL_PAGE = 500;
/** 同時刻付近の更新の取りこぼしを防ぐため、前回より少し前から取り直す */
const PULL_OVERLAP_MS = 30_000;

async function pullTable<T extends Syncable>(
  remote: 'customers' | 'ledgers' | 'records' | 'record_extras' | 'blackboard_templates',
  table: AnyTable<T>,
  fromRow: (r: RemoteRow) => T,
) {
  const provider = getProvider();
  const metaKey = `pull.${remote}`;
  const last = (await db.meta.get(metaKey))?.value ?? null;
  let since = last ? new Date(Date.parse(last) - PULL_OVERLAP_MS).toISOString() : null;
  for (;;) {
    const rows = await withRetry(() => provider.pull(remote, since, PULL_PAGE));
    if (rows.length === 0) break;
    await syncTransaction([table, db.meta], async () => {
      for (const row of rows) {
        const incoming = fromRow(row);
        const local = await table.get(incoming.id);
        // 端末に未送信の変更があり、そちらが新しい場合は端末を優先（項目単位のマージはステップ4）
        if (local && local.syncStatus !== 'synced' && local.updatedAt >= incoming.updatedAt) continue;
        await table.put(incoming);
      }
      const maxSeen = String(rows[rows.length - 1].server_updated_at);
      await db.meta.put({ key: metaKey, value: maxSeen });
    });
    if (rows.length < PULL_PAGE) break;
    since = String(rows[rows.length - 1].server_updated_at);
  }
}

async function pull() {
  await pullTable('customers', db.customers, customerFromRow);
  await pullTable('ledgers', db.ledgers, ledgerFromRow);
  await pullTable('records', db.records, recordFromRow);
  await pullTable('record_extras', db.extras, extraFromRow);
  await pullTable('blackboard_templates', db.templates, templateFromRow);
}

/** ユーザー一覧を取り込み、自分の表示名・停止状態を反映する */
async function pullProfiles(userId: string) {
  const profiles = (await withRetry(() => getProvider().fetchProfiles())).map(profileFromRemote);
  await db.transaction('rw', db.profiles, async () => {
    await db.profiles.clear();
    await db.profiles.bulkPut(profiles);
  });
  const me = profiles.find((p) => p.userId === userId);
  if (me) prefs.setWorkerName(me.displayName);
  return me;
}

// ---------------------------------------------------------------------------
// 実行の管理
// ---------------------------------------------------------------------------

let rerun = false;

export async function syncNow(): Promise<void> {
  if (state.running) {
    rerun = true;
    return;
  }
  if (!navigator.onLine) {
    setState({ offline: true });
    return;
  }
  const session = await getProvider().getSession();
  if (!session) return;

  setState({ running: true, offline: false, lastError: null });
  const started = performance.now();
  diag('sync:start');
  try {
    // 停止されていても、未送信のデータは先に送る（要件4.1）
    await push();
    const me = await pullProfiles(session.userId);
    if (me?.disabled) {
      setState({ accountDisabled: true });
      return;
    }
    await pull();
    setState({ lastSyncAt: new Date().toISOString(), authRequired: false });
    diag('sync:done', `${Math.round(performance.now() - started)}ms`);
  } catch (e) {
    diag('sync:error', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    if (e instanceof NetworkError) setState({ offline: !navigator.onLine, lastError: e.message });
    else if (e instanceof AuthRequiredError) setState({ authRequired: true, lastError: e.message });
    else setState({ lastError: message(e) });
  } finally {
    setState({ running: false, progress: null });
    if (rerun) {
      rerun = false;
      void syncNow();
    }
  }
}

/** 送信に失敗したデータを未送信に戻して、もう一度送る（要件7.2：手動の再送） */
export async function retryFailed() {
  const tables = [db.customers, db.ledgers, db.records, db.extras, db.templates] as AnyTable<Syncable>[];
  await syncTransaction(tables, async () => {
    for (const t of tables) {
      await t.where('syncStatus').equals('failed').modify({ syncStatus: 'pending', syncError: undefined });
    }
  });
  await syncNow();
}

let started = false;
let debounce: ReturnType<typeof setTimeout> | undefined;

/** 自動同期を開始する：起動時、端末での変更後、オンライン復帰時、アプリに戻ったとき、定期的に（要件7.2） */
export function startAutoSync() {
  if (started) return;
  started = true;
  const schedule = (ms: number) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => void syncNow(), ms);
  };
  onLocalChange(() => schedule(1500));
  window.addEventListener('online', () => {
    setState({ offline: false });
    schedule(500);
  });
  window.addEventListener('offline', () => setState({ offline: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') schedule(300);
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') void syncNow();
  }, 5 * 60_000);
  void syncNow();
}

/** ログアウト時などに状態を初期化する */
export function clearSyncNotice() {
  setState({ notice: null });
}

export function resetSyncState() {
  setState({ authRequired: false, accountDisabled: false, lastError: null, lastSyncAt: null });
}

/** 未送信・送信失敗の件数（作業記録・追加写真・顧客・台帳・作成した黒板の合計） */
export async function countUnsent(): Promise<{ pending: number; failed: number }> {
  const tables = [db.customers, db.ledgers, db.records, db.extras, db.templates] as AnyTable<Syncable>[];
  let pending = 0;
  let failed = 0;
  for (const t of tables) {
    pending += await t.where('syncStatus').equals('pending').count();
    failed += await t.where('syncStatus').equals('failed').count();
  }
  return { pending, failed };
}

/**
 * 端末のデータを消して、サーバーから取り直す（設定画面）。
 * サーバーを管理画面で直接操作したあとなど、端末に古いデータが残っている場合に使う。
 * ログイン状態と、黒板の配置などの端末の設定は残す
 */
export async function resetLocalData() {
  // 同期の途中なら終わるのを待つ（書き込み中に消さないため）
  for (let i = 0; i < 100 && state.running; i++) await sleep(200);
  diag('reset-local');
  await db.transaction('rw', [db.customers, db.ledgers, db.records, db.images, db.templates, db.extras, db.profiles, db.meta], async () => {
    await Promise.all([db.customers, db.ledgers, db.records, db.images, db.templates, db.extras, db.profiles, db.meta].map((t) => t.clear()));
  });
  prefs.setLastLedger(null);
}

/** 実行中の同期が終わるまで待つ */
async function waitIdle(timeoutMs = 60_000) {
  const start = Date.now();
  while (state.running && Date.now() - start < timeoutMs) await sleep(200);
}

/**
 * 未送信・送信失敗のデータをすべて送り直し、残った件数と理由を返す（端末のデータを取り直す前などに使う）
 */
export async function sendAllPending(): Promise<{ pending: number; failed: number; reasons: string[] }> {
  await waitIdle();
  await retryFailed();
  // 同期が予約・実行中なら、それも終わるのを待つ
  await sleep(300);
  await waitIdle();
  const { pending, failed } = await countUnsent();
  const reasons = new Set<string>();
  const tables = [db.customers, db.ledgers, db.records, db.extras, db.templates] as AnyTable<Syncable & { syncError?: string }>[];
  for (const t of tables) {
    const rows = await t.where('syncStatus').equals('failed').limit(5).toArray();
    rows.forEach((r) => r.syncError && reasons.add(/foreign key/i.test(r.syncError) ? '属する顧客・台帳がサーバーにありません' : r.syncError));
  }
  if (state.offline) reasons.add('圏外のため送信できませんでした');
  return { pending, failed, reasons: [...reasons].slice(0, 3) };
}
