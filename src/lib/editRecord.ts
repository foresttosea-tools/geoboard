import { db, nowIso } from '../db';
import { SLOT_DATE } from '../blackboard/model';
import type { BoardContent, WorkRecord } from '../types';
import { loadImageBlob } from '../sync/images';
import { canvasToJpeg, composeWithBoard, loadImageToCanvas, makeThumbnail } from './image';

/** 黒板の内容を修正できるか（要件6.5：黒板付きで保存した記録は写真を作り直せる） */
export function canFixBoard(r: WorkRecord): boolean {
  return (r.mode === 'both' || r.mode === 'with_board') && r.board != null && r.boardLayout != null;
}

/**
 * 黒板を修正して写真を作り直し、合成画像とサムネイルを差し替える。
 * - 「両方」：黒板なしの原本に、新しい黒板を重ねる
 * - 「黒板ありのみ」：今の黒板付きの写真に、同じ位置・大きさで新しい黒板を重ねる。
 *   黒板は透けないので、古い黒板は完全に隠れる（黒板の下は元々写っていないため失うものはない）
 */
export async function fixRecordBoard(record: WorkRecord, board: BoardContent) {
  if (!canFixBoard(record) || !record.boardLayout) throw new Error('この記録は黒板を修正できません');
  // 送信済みの記録は端末に大きい画像がないので、サーバーから取り寄せる
  const base =
    record.mode === 'both'
      ? await loadImageBlob(`${record.id}:original`, record.originalPath).catch(() => null)
      : await loadImageBlob(`${record.id}:composite`, record.compositePath).catch(() => null);
  if (!base) throw new Error('写真を取得できません。電波のある場所で試してください');
  const photo = await loadImageToCanvas(base);
  const composite = composeWithBoard(photo, board, record.boardLayout);
  const compositeBlob = await canvasToJpeg(composite);
  const thumbBlob = await makeThumbnail(composite);
  await db.transaction('rw', db.records, db.images, async () => {
    await db.images.put({ key: `${record.id}:composite`, recordId: record.id, kind: 'composite', blob: compositeBlob });
    await db.images.put({ key: `${record.id}:thumb`, recordId: record.id, kind: 'thumb', blob: thumbBlob });
    // 写真が変わったので再送信の対象にする（更新すると自動で未送信になる）。
    // 撮影日を直した場合は「日付要確認」を外し、撮影日時もその日付に合わせる
    const dateChanged = board[SLOT_DATE]?.value !== record.board?.[SLOT_DATE]?.value;
    await db.records.update(record.id, {
      board,
      updatedAt: nowIso(),
      ...(dateChanged && board[SLOT_DATE]?.value
        ? { shotDateNeedsCheck: false, shotAt: shotAtForDate(board[SLOT_DATE].value, record.shotAt) }
        : {}),
    });
  });
}

/** 日付（YYYY-MM-DD）を撮影日時にする。元の撮影日時と同じ日ならそのまま、違えば正午にする */
function shotAtForDate(date: string, current: string): string {
  const d = new Date(current);
  const p = (n: number) => String(n).padStart(2, '0');
  const sameDay = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` === date;
  return sameDay ? current : new Date(`${date}T12:00:00`).toISOString();
}

/**
 * 「日付要確認」の記録の撮影日を確定する（要件6.6）。
 * - 「両方」で保存した記録：黒板の撮影日を直して写真を作り直す
 * - それ以外：写真の黒板は直せないので、記録の撮影日時だけを直す
 */
export async function confirmShotDate(record: WorkRecord, date: string) {
  if (canFixBoard(record) && record.board) {
    const board = record.board.map((it, i) => (i === SLOT_DATE ? { ...it, value: date } : it));
    if (board[SLOT_DATE]?.value !== record.board[SLOT_DATE]?.value) {
      await fixRecordBoard(record, board);
      return;
    }
  }
  await db.records.update(record.id, { shotDateNeedsCheck: false, shotAt: shotAtForDate(date, record.shotAt), updatedAt: nowIso() });
}
