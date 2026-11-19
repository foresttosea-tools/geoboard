import { getProvider } from '../sync/config';
import type { RemoteFile, RemoteRow } from '../sync/provider';

/**
 * 写真の保存場所の使用量と、古い写真（使われなくなったファイル）のお掃除（管理者・PC管理画面）。
 *
 * 黒板を修正して写真を作り直すと、新しい写真は別のファイル名で保存され、古い版が残る（キャッシュ対策。engine.ts の uploadImages）。
 * 安全のため、次の条件をすべて満たすファイルだけを「古い写真」とする：
 * - ファイル名から分かる作業記録（または追加写真）がサーバーに登録済み（削除済みも含む。削除済みの写真は復元に備えて残す）
 * - その記録・追加写真が今参照しているファイルではない
 * - 保存から24時間以上たっている（送信の途中で、まだ記録に反映されていない新しい写真を消さないため）
 * 記録がサーバーにまだないファイル（送信の途中で止まっている端末の写真など）は消さない
 */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const MIN_AGE_MS = 24 * 60 * 60 * 1000;

export interface StorageScan {
  files: number;
  bytes: number;
  /** 消してよい古い写真 */
  stale: RemoteFile[];
  staleBytes: number;
  /** 記録がまだサーバーにないため残しているファイル */
  unknown: number;
}

async function pullAll(table: 'records' | 'record_extras'): Promise<RemoteRow[]> {
  const provider = getProvider();
  const rows: RemoteRow[] = [];
  let since: string | null = null;
  for (;;) {
    const page = await provider.pull(table, since, 500);
    rows.push(...page);
    if (page.length < 500) break;
    since = String(page[page.length - 1].server_updated_at);
  }
  return rows;
}

export async function scanStorage(now = Date.now()): Promise<StorageScan> {
  const provider = getProvider();
  // 判定はサーバーの最新の内容で行う（PCの端末内のデータは古い可能性があるため）
  const [files, records, extras] = await Promise.all([provider.listFiles(), pullAll('records'), pullAll('record_extras')]);
  const recordIds = new Set(records.map((r) => String(r.id)));
  const extraIds = new Set(extras.map((x) => String(x.id)));
  const referenced = new Set<string>();
  for (const r of records) for (const k of ['composite_path', 'original_path', 'thumb_path']) if (r[k]) referenced.add(String(r[k]));
  for (const x of extras) for (const k of ['path', 'thumb_path']) if (x[k]) referenced.add(String(x[k]));

  const stale: RemoteFile[] = [];
  let unknown = 0;
  for (const f of files) {
    if (referenced.has(f.path)) continue;
    const name = f.path.split('/').pop() ?? '';
    const ids = name.match(UUID) ?? [];
    // 追加写真：{記録ID}_extra_{追加写真ID}_…、メイン写真：{記録ID}_{種類}_…
    const owner = name.includes('_extra_') ? ids[1] : ids[0];
    const known = owner != null && (name.includes('_extra_') ? extraIds.has(owner) : recordIds.has(owner));
    if (!known) {
      unknown++;
      continue;
    }
    const created = Date.parse(f.createdAt);
    if (Number.isNaN(created) || now - created < MIN_AGE_MS) continue;
    stale.push(f);
  }
  return {
    files: files.length,
    bytes: files.reduce((s, f) => s + f.size, 0),
    stale,
    staleBytes: stale.reduce((s, f) => s + f.size, 0),
    unknown,
  };
}

export async function deleteStaleFiles(stale: RemoteFile[]) {
  await getProvider().deleteFiles(stale.map((f) => f.path));
}

export const formatBytes = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)}GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)}MB` : `${Math.max(0, Math.round(n / 1024))}KB`);
