import { formatShotDate } from '../components/RecordMarks';
import { db } from '../db';
import { loadImageBlob } from '../sync/images';
import type { Customer, Ledger, WorkRecord } from '../types';
import { reportImageBlob } from './report';

/** ファイル名に使えない文字を置き換える */
const safe = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || '無題';

/**
 * 台帳の写真をZIPにまとめる（要件5.4・8.1）。
 * {顧客名}_{工事名称}/{撮影日}_{連番}.jpg、両方保存した記録は _黒板なし、追加写真は _追加{n}
 */
export async function buildLedgerZip(
  customer: Customer,
  ledger: Ledger,
  records: WorkRecord[],
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const folder = zip.folder(`${safe(customer.name)}_${safe(ledger.name)}`)!;
  let n = 0;
  for (const r of records) {
    n++;
    const base = `${formatShotDate(r).replaceAll('/', '')}_${String(n).padStart(3, '0')}`;
    const main = await reportImageBlob(r, true);
    if (main) folder.file(`${base}.jpg`, main);
    if (r.mode === 'both') {
      const original = await loadImageBlob(`${r.id}:original`, r.originalPath).catch(() => null);
      if (original) folder.file(`${base}_黒板なし.jpg`, original);
    }
    const extras = await db.extras.where('recordId').equals(r.id).filter((x) => !x.deletedAt).sortBy('createdAt');
    let k = 0;
    for (const x of extras) {
      k++;
      const blob = await loadImageBlob(`${x.id}:extra`, x.path).catch(() => null);
      if (blob) folder.file(`${base}_追加${k}.jpg`, blob);
    }
    onProgress?.(n, records.length);
  }
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

/** ブラウザでファイルとして保存させる */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const fileSafe = safe;
