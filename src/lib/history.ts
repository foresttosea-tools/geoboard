import { BOARD_SLOTS, formatBoardDate, SLOT_DATE } from '../blackboard/model';
import { db, nowIso } from '../db';
import { getProvider } from '../sync/config';
import { changeLogFromRow, customerFromRow, customerToRow, ledgerFromRow, ledgerToRow, recordFromRow, recordToRow, toCamel } from '../sync/mapping';
import type { BoardContent, ChangeLog } from '../types';
import { canFixBoard, fixRecordBoard } from './editRecord';

/** 変更履歴・操作ログ（要件4.3・7.3）。サーバーにだけあるので、表示にはオンラインが必要 */

export const TABLE_LABEL: Record<string, string> = {
  customers: '顧客',
  ledgers: '台帳',
  records: '作業記録',
  record_extras: '追加写真',
};

export const FIELD_LABEL: Record<string, Record<string, string>> = {
  customers: { name: '顧客名', is_provisional: '仮顧客', merged_into: '統合先の顧客' },
  ledgers: { name: '工事名称', start_date: '工事開始日', end_date: '工事終了日', manager: '工事責任者', note: '備考', customer_id: '顧客' },
  records: {
    board: '黒板',
    board_layout: '黒板の位置',
    memo: 'メモ',
    handover: '次回への引継ぎ事項',
    handover_in_report: '引継ぎ事項のレポート掲載',
    shot_at: '撮影日時',
    shot_date_needs_check: '日付要確認',
    latitude: '緯度',
    longitude: '経度',
    location_accuracy: '位置の精度',
    mode: '撮影モード',
    ledger_id: '台帳',
  },
  record_extras: {},
};

export const ACTION_LABEL: Record<ChangeLog['action'], string> = {
  create: '作成',
  update: '変更',
  delete: '削除',
  restore: '復元',
  merge: '統合',
  unmerge: '統合の取り消し',
  conflict_overwrite: '同時編集で上書き',
};

/** 以前の内容に戻せる項目 */
const RESTORABLE: Record<string, string[]> = {
  customers: ['name'],
  ledgers: ['name', 'start_date', 'end_date', 'manager', 'note'],
  records: ['board', 'memo', 'handover', 'handover_in_report', 'shot_at', 'shot_date_needs_check'],
};

export const fieldLabel = (table: string, field: string | null) => (field ? (FIELD_LABEL[table]?.[field] ?? field) : '');

const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** 値を画面に出す文字にする */
export function formatValue(table: string, field: string | null, v: unknown): string {
  if (v == null || v === '') return '（空欄）';
  if (typeof v === 'boolean') {
    if (field === 'handover_in_report') return v ? '載せる' : '載せない';
    return v ? 'はい' : 'いいえ';
  }
  if (field === 'shot_at') return fmtDateTime(String(v));
  if (field === 'start_date' || field === 'end_date') return String(v).replaceAll('-', '/');
  if (field === 'mode') return ({ with_board: '黒板ありのみ', without_board: '黒板なしのみ', both: '両方' } as Record<string, string>)[String(v)] ?? String(v);
  if (table === 'records' && field === 'board' && Array.isArray(v)) return boardText(v as BoardContent);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function boardText(b: BoardContent): string {
  return b
    .map((it, i) => {
      const label = it.label || BOARD_SLOTS[i]?.defaultLabel || '';
      const value = i === SLOT_DATE ? formatBoardDate(it.value) : it.value;
      return value ? `${label}：${value}` : '';
    })
    .filter(Boolean)
    .join('／');
}

/** 黒板の変更は、変わった枠だけを「項目：前 → 後」で示す */
export function boardDiff(before: unknown, after: unknown): { label: string; before: string; after: string }[] | null {
  if (!Array.isArray(before) || !Array.isArray(after)) return null;
  const out: { label: string; before: string; after: string }[] = [];
  const n = Math.max(before.length, after.length);
  for (let i = 0; i < n; i++) {
    const b = before[i] as { label?: string; value?: string } | undefined;
    const a = after[i] as { label?: string; value?: string } | undefined;
    if ((b?.value ?? '') === (a?.value ?? '') && (b?.label ?? '') === (a?.label ?? '')) continue;
    const label = a?.label || b?.label || BOARD_SLOTS[i]?.defaultLabel || '';
    const fmt = (s?: string) => (s ? (i === SLOT_DATE ? formatBoardDate(s) : s) : '（空欄）');
    out.push({ label, before: fmt(b?.value), after: fmt(a?.value) });
  }
  return out;
}

export async function fetchHistory(targetIds: string[], limit = 100): Promise<ChangeLog[]> {
  const rows = await getProvider().fetchChangeLogs({ targetIds, limit });
  return rows.map(changeLogFromRow);
}

export async function fetchLogs(limit: number, before: string | null): Promise<ChangeLog[]> {
  const rows = await getProvider().fetchChangeLogs({ limit, before });
  return rows.map(changeLogFromRow);
}

/** この履歴の「変更前の内容」に戻せるか */
export function canRestore(log: ChangeLog): boolean {
  return (log.action === 'update' || log.action === 'conflict_overwrite') && !!log.field && (RESTORABLE[log.targetTable] ?? []).includes(log.field);
}

/**
 * 項目を履歴の「変更前の内容」に戻す。端末の編集として保存し、通常どおり送信する。
 * 黒板付きの写真の黒板を戻す場合は、写真も作り直す
 */
export async function restoreFromLog(log: ChangeLog): Promise<void> {
  const field = log.field!;
  const value = log.before;
  const id = log.targetId;
  if (log.targetTable === 'records') {
    const rec = await db.records.get(id);
    if (!rec) throw new Error('この端末に作業記録がありません');
    if (field === 'board' && Array.isArray(value) && canFixBoard(rec)) {
      await fixRecordBoard(rec, value as BoardContent);
      return;
    }
    const row = { ...recordToRow(rec), [field]: value };
    const key = toCamel(field) as keyof typeof rec;
    await db.records.update(id, { [key]: recordFromRow(row)[key], updatedAt: nowIso() });
  } else if (log.targetTable === 'ledgers') {
    const l = await db.ledgers.get(id);
    if (!l) throw new Error('この端末に台帳がありません');
    const row = { ...ledgerToRow(l), [field]: value };
    const key = toCamel(field) as keyof typeof l;
    await db.ledgers.update(id, { [key]: ledgerFromRow(row)[key], updatedAt: nowIso() });
  } else if (log.targetTable === 'customers') {
    const c = await db.customers.get(id);
    if (!c) throw new Error('この端末に顧客がありません');
    const row = { ...customerToRow(c), [field]: value };
    const key = toCamel(field) as keyof typeof c;
    await db.customers.update(id, { [key]: customerFromRow(row)[key], updatedAt: nowIso() });
  }
}

/** 現在の値（端末の内容）がこの履歴の「変更前」と同じか（戻す必要がない） */
export async function currentEqualsBefore(log: ChangeLog): Promise<boolean> {
  if (!log.field) return false;
  const get = async () => {
    if (log.targetTable === 'records') {
      const r = await db.records.get(log.targetId);
      return r ? recordToRow(r) : null;
    }
    if (log.targetTable === 'ledgers') {
      const l = await db.ledgers.get(log.targetId);
      return l ? ledgerToRow(l) : null;
    }
    if (log.targetTable === 'customers') {
      const c = await db.customers.get(log.targetId);
      return c ? customerToRow(c) : null;
    }
    return null;
  };
  const row = await get();
  if (!row) return false;
  return JSON.stringify(row[log.field] ?? null) === JSON.stringify(log.before ?? null);
}

/** 対象の名前（履歴・通知に出す） */
export async function targetName(table: string, id: string): Promise<string> {
  if (table === 'customers') return (await db.customers.get(id))?.name ?? '（不明な顧客）';
  if (table === 'ledgers') return (await db.ledgers.get(id))?.name ?? '（不明な台帳）';
  if (table === 'records') {
    const r = await db.records.get(id);
    if (!r) return '（不明な作業記録）';
    const l = await db.ledgers.get(r.ledgerId);
    const place = r.board?.[1]?.value;
    const d = new Date(r.shotAt);
    return `${l?.name ?? ''} ${d.getMonth() + 1}/${d.getDate()}${place ? ` ${place}` : ''}`.trim();
  }
  if (table === 'record_extras') return '追加写真';
  return '';
}
