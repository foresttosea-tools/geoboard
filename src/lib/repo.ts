import { db, newId, nowIso } from '../db';
import type { Customer, Ledger } from '../types';
import { prefs } from './prefs';

/**
 * 顧客を作成する。顧客コードはサーバーへ送信した時点で採番される。
 * 圏外では仮顧客として作成し、管理者があとで確定する（要件6.1）
 */
export async function createCustomer(name: string, provisional = false): Promise<Customer> {
  const t = nowIso();
  const c: Customer = {
    id: newId(),
    code: null,
    name: name.trim(),
    isProvisional: provisional,
    createdBy: prefs.getUserId(),
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
    syncStatus: 'pending',
  };
  await db.customers.add(c);
  return c;
}

export async function renameCustomer(id: string, name: string) {
  await db.customers.update(id, { name: name.trim(), updatedAt: nowIso() });
}

export type LedgerInput = Pick<Ledger, 'name' | 'startDate' | 'endDate' | 'manager' | 'note'>;

export async function createLedger(customerId: string, input: LedgerInput): Promise<Ledger> {
  const t = nowIso();
  const l: Ledger = {
    id: newId(),
    customerId,
    ...trimLedger(input),
    lastBoard: null,
    createdBy: prefs.getUserId(),
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
    syncStatus: 'pending',
  };
  await db.ledgers.add(l);
  return l;
}

export async function updateLedger(id: string, input: LedgerInput) {
  await db.ledgers.update(id, { ...trimLedger(input), updatedAt: nowIso() });
}

function trimLedger(i: LedgerInput): LedgerInput {
  return { name: i.name.trim(), startDate: i.startDate, endDate: i.endDate, manager: i.manager.trim(), note: i.note.trim() };
}

/** 工期の表示（YYYY/MM/DD〜YYYY/MM/DD） */
export function formatTerm(l: Pick<Ledger, 'startDate' | 'endDate'>): string {
  const f = (d: string) => d.replaceAll('-', '/');
  if (!l.startDate && !l.endDate) return '工期未設定';
  return `${l.startDate ? f(l.startDate) : '未定'}〜${l.endDate ? f(l.endDate) : '未定'}`;
}

/** 検索用に表記ゆれを吸収する（全角半角・大文字小文字・空白） */
export function normalizeForSearch(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

/** 顧客を論理削除する（管理者のみ。要件4.2） */
export async function deleteCustomer(id: string) {
  const t = nowIso();
  await db.customers.update(id, { deletedAt: t, updatedAt: t });
}

/** 台帳を論理削除する（管理者のみ） */
export async function deleteLedger(id: string) {
  const t = nowIso();
  await db.ledgers.update(id, { deletedAt: t, updatedAt: t });
}

/** 削除済みのデータを元に戻す（管理者のみ。要件4.3） */
export async function restoreItem(kind: 'customer' | 'ledger' | 'record', id: string) {
  const patch = { deletedAt: null, updatedAt: nowIso() };
  if (kind === 'customer') await db.customers.update(id, patch);
  else if (kind === 'ledger') await db.ledgers.update(id, patch);
  else await db.records.update(id, patch);
}

/** 仮顧客を正式な顧客にする。顧客コードは送信時にサーバーで採番される（要件6.1） */
export async function confirmProvisionalCustomer(id: string, name: string) {
  await db.customers.update(id, { isProvisional: false, name: name.trim(), updatedAt: nowIso() });
}

/** 仮顧客を既存の顧客に紐づける。仮顧客の台帳を紐づけ先に移し、仮顧客は統合済みとして非表示にする */
export async function linkProvisionalCustomer(provisionalId: string, targetId: string) {
  const t = nowIso();
  await db.transaction('rw', db.ledgers, db.customers, async () => {
    const ledgers = await db.ledgers.where('customerId').equals(provisionalId).toArray();
    for (const l of ledgers) await db.ledgers.update(l.id, { customerId: targetId, updatedAt: t });
    await db.customers.update(provisionalId, { mergedInto: targetId, deletedAt: t, updatedAt: t });
  });
}
