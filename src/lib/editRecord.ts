import { db, nowIso } from '../db';
import type { BoardContent, WorkRecord } from '../types';
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
  const original = await db.images.get(`${record.id}:original`);
  if (!original) throw new Error('原本の写真が見つかりません');
  const photo = await loadImageToCanvas(original.blob);
  const composite = composeWithBoard(photo, board, record.boardLayout);
  const compositeBlob = await canvasToJpeg(composite);
  const thumbBlob = await makeThumbnail(composite);
  await db.transaction('rw', db.records, db.images, async () => {
    await db.images.put({ key: `${record.id}:composite`, recordId: record.id, kind: 'composite', blob: compositeBlob });
    await db.images.put({ key: `${record.id}:thumb`, recordId: record.id, kind: 'thumb', blob: thumbBlob });
    // 写真が変わったので再送信の対象にする
    await db.records.update(record.id, { board, updatedAt: nowIso(), syncStatus: 'pending' });
  });
}
