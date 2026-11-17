import { db, nowIso } from '../db';
import type { BoardContent, WorkRecord } from '../types';
import { loadImageBlob } from '../sync/images';
import { canvasToJpeg, composeWithBoard, loadImageToCanvas, makeThumbnail } from './image';

/** 黒板の内容を修正できるか（要件6.5：「両方」で保存した記録のみ写真を作り直せる） */
export function canFixBoard(r: WorkRecord): boolean {
  return r.mode === 'both' && r.board != null && r.boardLayout != null;
}

/**
 * 黒板を修正して写真を作り直す。原本に新しい黒板を合成し、合成画像とサムネイルを差し替える
 */
export async function fixRecordBoard(record: WorkRecord, board: BoardContent) {
  if (!canFixBoard(record) || !record.boardLayout) throw new Error('この記録は黒板を修正できません');
  // 送信済みの記録は端末に原本がないので、サーバーから取り寄せる
  const original = await loadImageBlob(`${record.id}:original`, record.originalPath).catch(() => null);
  if (!original) throw new Error('原本の写真を取得できません。電波のある場所で試してください');
  const photo = await loadImageToCanvas(original);
  const composite = composeWithBoard(photo, board, record.boardLayout);
  const compositeBlob = await canvasToJpeg(composite);
  const thumbBlob = await makeThumbnail(composite);
  await db.transaction('rw', db.records, db.images, async () => {
    await db.images.put({ key: `${record.id}:composite`, recordId: record.id, kind: 'composite', blob: compositeBlob });
    await db.images.put({ key: `${record.id}:thumb`, recordId: record.id, kind: 'thumb', blob: thumbBlob });
    // 写真が変わったので再送信の対象にする（更新すると自動で未送信になる）
    await db.records.update(record.id, { board, updatedAt: nowIso() });
  });
}
