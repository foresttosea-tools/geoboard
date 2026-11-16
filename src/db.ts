import Dexie, { type EntityTable } from 'dexie';
import { LEGACY_HANDOVER_SLOT, migrateLegacyBoard } from './blackboard/model';
import type { BoardTemplate, Ledger, StoredImage, WorkRecord } from './types';

export const db = new Dexie('geoboard') as Dexie & {
  ledgers: EntityTable<Ledger, 'id'>;
  records: EntityTable<WorkRecord, 'id'>;
  images: EntityTable<StoredImage, 'key'>;
  templates: EntityTable<BoardTemplate, 'id'>;
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

export const nowIso = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();

/** ステップ1用：台帳管理（ステップ2）ができるまでの仮の台帳 */
export const SAMPLE_LEDGER_ID = '00000000-0000-4000-8000-000000000001';

export async function ensureSampleLedger(): Promise<Ledger> {
  const existing = await db.ledgers.get(SAMPLE_LEDGER_ID);
  if (existing) return existing;
  const ledger: Ledger = {
    id: SAMPLE_LEDGER_ID,
    customerName: 'サンプル町役場',
    name: 'テスト台帳（ステップ1）',
    startDate: '',
    endDate: '',
    manager: '',
    note: '',
    lastBoard: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await db.ledgers.put(ledger);
  return ledger;
}

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
