import { db, newId, nowIso } from '../db';
import type { Customer, Ledger } from '../types';
import { prefs } from './prefs';

/** 顧客を作成する。ステップ3まではオフラインでも作成でき、顧客コードは未採番（null） */
export async function createCustomer(name: string): Promise<Customer> {
  const t = nowIso();
  const c: Customer = {
    id: newId(),
    code: null,
    name: name.trim(),
    isProvisional: false,
    createdBy: prefs.getWorkerName(),
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
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
    createdBy: prefs.getWorkerName(),
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
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
