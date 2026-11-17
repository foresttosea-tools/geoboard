import Dexie, { type EntityTable } from 'dexie';
import { LEGACY_HANDOVER_SLOT, migrateLegacyBoard } from './blackboard/model';
import type { BoardTemplate, Customer, ExtraPhoto, Ledger, Profile, StoredImage, WorkRecord } from './types';

export const db = new Dexie('geoboard') as Dexie & {
  customers: EntityTable<Customer, 'id'>;
  ledgers: EntityTable<Ledger, 'id'>;
  records: EntityTable<WorkRecord, 'id'>;
  images: EntityTable<StoredImage, 'key'>;
  templates: EntityTable<BoardTemplate, 'id'>;
  extras: EntityTable<ExtraPhoto, 'id'>;
  profiles: EntityTable<Profile, 'userId'>;
  meta: EntityTable<{ key: string; value: string }, 'key'>;
};

db.version(1).stores({
  ledgers: 'id, updatedAt',
  records: 'id, ledgerId, shotAt, syncStatus',
  images: 'key, recordId',
  templates: 'id, name, lastUsedAt',
});

// v2：黒板から「次回への引継ぎ事項」を外し、作業記録の項目に移す
db.version(2)
  .stores({})
  .upgrade(async (tx) => {
    await tx.table('records').toCollection().modify((r) => {
      const legacy = r.board?.length === 8 ? (r.board[LEGACY_HANDOVER_SLOT]?.value ?? '') : '';
      r.handover = r.handover ?? legacy;
      r.handoverInReport = r.handoverInReport ?? false;
      if (r.board) r.board = migrateLegacyBoard(r.board);
    });
    await tx.table('templates').toCollection().modify((t) => {
      t.content = migrateLegacyBoard(t.content);
    });
    await tx.table('ledgers').toCollection().modify((l) => {
      if (l.lastBoard) l.lastBoard = migrateLegacyBoard(l.lastBoard);
    });
  });

// v3：作業記録ごとの追加写真
db.version(3).stores({
  extras: 'id, recordId, createdAt',
});

// v4：顧客を追加し、台帳は顧客IDで紐づける。旧台帳の顧客名から顧客を作る
db.version(4)
  .stores({
    customers: 'id, name, updatedAt',
    ledgers: 'id, customerId, updatedAt',
  })
  .upgrade(async (tx) => {
    const t = new Date().toISOString();
    const byName = new Map<string, string>();
    const ledgers = await tx.table('ledgers').toArray();
    for (const l of ledgers) {
      if (l.customerId) continue;
      const name: string = l.customerName || '未分類';
      let customerId = byName.get(name);
      if (!customerId) {
        customerId = crypto.randomUUID();
        byName.set(name, customerId);
        await tx.table('customers').add({
          id: customerId, code: null, name, isProvisional: false, createdBy: '', createdAt: t, updatedAt: t, deletedAt: null,
        });
      }
      await tx.table('ledgers').update(l.id, { customerId, customerName: undefined, createdBy: l.createdBy ?? '', deletedAt: l.deletedAt ?? null });
    }
  });

// v5：サーバー同期（ステップ3）。全テーブルに同期状態を持たせる
db.version(5)
  .stores({
    customers: 'id, name, updatedAt, syncStatus',
    ledgers: 'id, customerId, updatedAt, syncStatus',
    records: 'id, ledgerId, shotAt, syncStatus',
    extras: 'id, recordId, createdAt, syncStatus',
    templates: 'id, name, lastUsedAt, syncStatus',
    profiles: 'userId',
    meta: 'key',
  })
  .upgrade(async (tx) => {
    await tx.table('customers').toCollection().modify((c) => {
      c.syncStatus = c.syncStatus ?? 'pending';
    });
    await tx.table('ledgers').toCollection().modify((l) => {
      l.syncStatus = l.syncStatus ?? 'pending';
    });
    await tx.table('templates').toCollection().modify((t) => {
      t.syncStatus = t.syncStatus ?? 'pending';
      t.deletedAt = t.deletedAt ?? null;
    });
    await tx.table('extras').toCollection().modify((x) => {
      x.updatedAt = x.updatedAt ?? x.createdAt;
    });
  });

/**
 * 端末でデータを変更したら、自動で「未送信」にして同期を予約する。
 * 同期処理が書き込むときは syncStatus を明示するので、その場合は何もしない
 */
type ChangeListener = () => void;
const changeListeners = new Set<ChangeListener>();
export function onLocalChange(fn: ChangeListener) {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}
const notifyChange = () => changeListeners.forEach((fn) => fn());

/** 同期処理による書き込みの目印。この印があるトランザクションでは「未送信」にしない */
const SYNC_TX = '__geoboardSync';
const isSyncTx = (tx: unknown) => Boolean(tx && (tx as Record<string, unknown>)[SYNC_TX]);

/** 同期処理からの書き込みに使うトランザクション */
export function syncTransaction<T>(tables: Parameters<typeof db.transaction>[1][], fn: () => Promise<T>): Promise<T> {
  return db.transaction('rw', tables, async (tx) => {
    (tx as unknown as Record<string, unknown>)[SYNC_TX] = true;
    return fn();
  });
}

for (const table of [db.customers, db.ledgers, db.records, db.extras, db.templates]) {
  table.hook('creating', (_pk, obj: { syncStatus?: string }, tx) => {
    if (isSyncTx(tx)) return;
    if (!obj.syncStatus) obj.syncStatus = 'pending';
    if (obj.syncStatus === 'pending') queueMicrotask(notifyChange);
  });
  table.hook('updating', (mods: object, _pk, _obj, tx) => {
    if (isSyncTx(tx) || 'syncStatus' in mods) return undefined;
    queueMicrotask(notifyChange);
    return { syncStatus: 'pending', syncError: undefined };
  });
}

export const nowIso = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();

/** 端末ストレージの永続化を要求する（要件7.1） */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** 論理削除（要件4.3）。画像は復元に備えて残す */
export async function deleteRecord(id: string) {
  const t = nowIso();
  await db.records.update(id, { deletedAt: t, updatedAt: t });
}
