import { SLOT_DATE, SLOT_WORKER, todayIsoDate } from '../blackboard/model';
import { normalizeForSearch } from '../lib/repo';
import type { Ledger, WorkRecord } from '../types';

/** PC管理画面の絞り込み条件（要件8.1：工期・撮影日・施工者・キーワード）。日付は YYYY-MM-DD、空欄は条件なし */
export interface AdminFilter {
  termFrom: string;
  termTo: string;
  shotFrom: string;
  shotTo: string;
  worker: string;
  keyword: string;
}

export const EMPTY_FILTER: AdminFilter = { termFrom: '', termTo: '', shotFrom: '', shotTo: '', worker: '', keyword: '' };

export const hasTermFilter = (f: AdminFilter) => !!(f.termFrom || f.termTo);
/** 作業記録の内容で絞り込む条件があるか */
export const hasRecordFilter = (f: AdminFilter) => !!(f.shotFrom || f.shotTo || f.worker.trim() || f.keyword.trim());
export const hasAnyFilter = (f: AdminFilter) => hasTermFilter(f) || hasRecordFilter(f);

/** 記録の撮影日（YYYY-MM-DD）。黒板の撮影日を優先し、なければ撮影日時の日付（一覧の表示と合わせる） */
export function recordDate(r: WorkRecord): string {
  const v = r.board?.[SLOT_DATE]?.value;
  if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return todayIsoDate(new Date(r.shotAt));
}

/** 工期が指定の期間と重なるか。工期が未設定の台帳は、工期で絞り込んだときは出さない */
export function ledgerTermMatches(l: Ledger, f: AdminFilter): boolean {
  if (!hasTermFilter(f)) return true;
  if (!l.startDate && !l.endDate) return false;
  const start = l.startDate || l.endDate;
  const end = l.endDate || l.startDate;
  if (f.termFrom && end < f.termFrom) return false;
  if (f.termTo && start > f.termTo) return false;
  return true;
}

/** 作業記録が撮影日・施工者・キーワードの条件に合うか */
export function recordMatches(r: WorkRecord, f: AdminFilter): boolean {
  const d = recordDate(r);
  if (f.shotFrom && d < f.shotFrom) return false;
  if (f.shotTo && d > f.shotTo) return false;
  const worker = normalizeForSearch(f.worker);
  if (worker && !normalizeForSearch(r.board?.[SLOT_WORKER]?.value ?? '').includes(worker)) return false;
  const kw = normalizeForSearch(f.keyword);
  if (kw) {
    const texts = [...(r.board ?? []).map((it) => it.value), r.memo, r.handover];
    if (!texts.some((s) => normalizeForSearch(s ?? '').includes(kw))) return false;
  }
  return true;
}
