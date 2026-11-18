import type { AppNotification, BoardTemplate, ChangeLog, Customer, DuplicateDismissal, ExtraPhoto, Ledger, Profile, WorkRecord } from '../types';
import type { RemoteProfile, RemoteRow } from './provider';

/**
 * 端末のデータ（camelCase）とサーバーの行（snake_case）の変換。
 * サーバーの列は supabase/migrations の定義と一致させること（scripts/check-mapping.mjs で検査）
 */

const dateOrNull = (d: string) => (d ? d : null);
const str = (v: unknown) => (v == null ? '' : String(v));
const strOrNull = (v: unknown) => (v == null ? null : String(v));
export const toSnake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
export const toCamel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/**
 * 端末で編集した項目の「編集を始めたときの値」をサーバーの列名・形式にする（sync_base）。
 * サーバーにまだない行（新規）は null（行ごと登録する）
 */
function syncBase<T extends { remote?: boolean; fieldBase?: Record<string, unknown> }>(r: T, toRow: (x: T) => RemoteRow): Record<string, unknown> | null {
  if (!r.remote) return null;
  const base = r.fieldBase ?? {};
  const asRow = toRow({ ...r, ...base, remote: false });
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(base)) {
    const s = toSnake(k);
    if (s in asRow) out[s] = asRow[s];
  }
  return out;
}

export const customerToRow = (c: Customer): RemoteRow => ({
  id: c.id,
  name: c.name,
  is_provisional: c.isProvisional,
  merged_into: c.mergedInto ?? null,
  created_at: c.createdAt,
  updated_at: c.updatedAt,
  deleted_at: c.deletedAt,
});

export const customerFromRow = (r: RemoteRow): Customer => ({
  id: str(r.id),
  code: strOrNull(r.code),
  name: str(r.name),
  isProvisional: Boolean(r.is_provisional),
  mergedInto: strOrNull(r.merged_into),
  createdBy: str(r.created_by),
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
  deletedAt: strOrNull(r.deleted_at),
  syncStatus: 'synced',
});

export const ledgerToRow = (l: Ledger): RemoteRow => ({
  id: l.id,
  customer_id: l.customerId,
  name: l.name,
  start_date: dateOrNull(l.startDate),
  end_date: dateOrNull(l.endDate),
  manager: l.manager,
  note: l.note,
  last_board: l.lastBoard,
  created_at: l.createdAt,
  updated_at: l.updatedAt,
  deleted_at: l.deletedAt,
  sync_base: syncBase(l, ledgerToRow),
});

export const ledgerFromRow = (r: RemoteRow): Ledger => ({
  id: str(r.id),
  customerId: str(r.customer_id),
  name: str(r.name),
  startDate: str(r.start_date),
  endDate: str(r.end_date),
  manager: str(r.manager),
  note: str(r.note),
  lastBoard: (r.last_board as Ledger['lastBoard']) ?? null,
  mergedInto: strOrNull(r.merged_into),
  remote: true,
  createdBy: str(r.created_by),
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
  deletedAt: strOrNull(r.deleted_at),
  syncStatus: 'synced',
});

export const recordToRow = (r: WorkRecord): RemoteRow => ({
  id: r.id,
  ledger_id: r.ledgerId,
  mode: r.mode,
  board: r.board,
  board_layout: r.boardLayout,
  memo: r.memo,
  handover: r.handover,
  handover_in_report: r.handoverInReport,
  shot_at: r.shotAt,
  shot_date_needs_check: r.shotDateNeedsCheck,
  source: r.source,
  latitude: r.latitude,
  longitude: r.longitude,
  location_accuracy: r.locationAccuracy,
  image_width: r.imageWidth,
  image_height: r.imageHeight,
  composite_path: r.compositePath ?? null,
  original_path: r.originalPath ?? null,
  thumb_path: r.thumbPath ?? null,
  created_at: r.createdAt,
  updated_at: r.updatedAt,
  deleted_at: r.deletedAt,
  sync_base: syncBase(r, recordToRow),
});

export const recordFromRow = (r: RemoteRow): WorkRecord => ({
  id: str(r.id),
  ledgerId: str(r.ledger_id),
  mode: r.mode as WorkRecord['mode'],
  board: (r.board as WorkRecord['board']) ?? null,
  boardLayout: (r.board_layout as WorkRecord['boardLayout']) ?? null,
  memo: str(r.memo),
  handover: str(r.handover),
  handoverInReport: Boolean(r.handover_in_report),
  shotAt: str(r.shot_at),
  shotDateNeedsCheck: Boolean(r.shot_date_needs_check),
  source: r.source as WorkRecord['source'],
  latitude: (r.latitude as number | null) ?? null,
  longitude: (r.longitude as number | null) ?? null,
  locationAccuracy: (r.location_accuracy as number | null) ?? null,
  imageWidth: Number(r.image_width),
  imageHeight: Number(r.image_height),
  compositePath: strOrNull(r.composite_path),
  originalPath: strOrNull(r.original_path),
  thumbPath: strOrNull(r.thumb_path),
  syncStatus: 'synced',
  remote: true,
  createdBy: str(r.created_by),
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
  deletedAt: strOrNull(r.deleted_at),
});

export const extraToRow = (x: ExtraPhoto): RemoteRow => ({
  id: x.id,
  record_id: x.recordId,
  source: x.source,
  width: x.width,
  height: x.height,
  path: x.path ?? null,
  thumb_path: x.thumbPath ?? null,
  created_at: x.createdAt,
  updated_at: x.updatedAt,
  deleted_at: x.deletedAt,
});

export const extraFromRow = (r: RemoteRow): ExtraPhoto => ({
  id: str(r.id),
  recordId: str(r.record_id),
  source: r.source as ExtraPhoto['source'],
  width: Number(r.width),
  height: Number(r.height),
  path: strOrNull(r.path),
  thumbPath: strOrNull(r.thumb_path),
  syncStatus: 'synced',
  createdBy: str(r.created_by),
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
  deletedAt: strOrNull(r.deleted_at),
});

export const templateToRow = (t: BoardTemplate): RemoteRow => ({
  id: t.id,
  name: t.name,
  content: t.content,
  last_used_at: t.lastUsedAt,
  created_at: t.createdAt,
  updated_at: t.updatedAt,
  deleted_at: t.deletedAt,
});

export const templateFromRow = (r: RemoteRow): BoardTemplate => ({
  id: str(r.id),
  name: str(r.name),
  content: r.content as BoardTemplate['content'],
  lastUsedAt: str(r.last_used_at),
  createdBy: str(r.created_by),
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
  deletedAt: strOrNull(r.deleted_at),
  syncStatus: 'synced',
});

export const profileFromRemote = (p: RemoteProfile): Profile => ({
  userId: p.user_id,
  displayName: p.display_name,
  role: p.role,
  disabled: p.disabled,
  updatedAt: p.updated_at,
});

export const notificationFromRow = (r: RemoteRow): AppNotification => ({
  id: str(r.id),
  type: r.type as AppNotification['type'],
  payload: (r.payload as Record<string, unknown>) ?? {},
  readAt: strOrNull(r.read_at),
  createdAt: str(r.created_at),
});

export const dismissalFromRow = (r: RemoteRow): DuplicateDismissal => ({
  key: `${str(r.ledger_a)}:${str(r.ledger_b)}`,
  ledgerA: str(r.ledger_a),
  ledgerB: str(r.ledger_b),
});

export const changeLogFromRow = (r: RemoteRow): ChangeLog => ({
  id: str(r.id),
  targetTable: str(r.target_table),
  targetId: str(r.target_id),
  action: r.action as ChangeLog['action'],
  field: strOrNull(r.field),
  before: r.before ?? null,
  after: r.after ?? null,
  userId: strOrNull(r.user_id),
  overwrittenUserId: strOrNull(r.overwritten_user_id),
  createdAt: str(r.created_at),
});
