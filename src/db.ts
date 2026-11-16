import Dexie, { type EntityTable } from 'dexie';
import { LEGACY_HANDOVER_SLOT, migrateLegacyBoard } from './blackboard/model';
import type { BoardTemplate, Customer, ExtraPhoto, Ledger, StoredImage, WorkRecord } from './types';

export const db = new Dexie('geoboard') as Dexie & {
  customers: EntityTable<Customer, 'id'>;
  ledgers: EntityTable<Ledger, 'id'>;
  records: EntityTable<WorkRecord, 'id'>;
  images: EntityTable<StoredImage, 'key'>;
  templates: EntityTable<BoardTemplate, 'id'>;
  extras: EntityTable<ExtraPhoto, 'id'>;
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
