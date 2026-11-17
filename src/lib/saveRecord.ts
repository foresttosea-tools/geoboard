import { db, newId, nowIso } from '../db';
import type { BoardContent, BoardLayout, CaptureMode, Handover, StoredImage, WorkRecord } from '../types';
import { canvasToJpeg, composeWithBoard, makeThumbnail, releaseCanvas, yieldToUi } from './image';
import { diag, diagStep } from './diag';
import { prefs } from './prefs';
import type { GeoFix } from './sensors';

interface SaveInput {
  ledgerId: string;
  mode: CaptureMode;
  board: BoardContent;
  handover: Handover;
  layout: BoardLayout | null;
  photo: HTMLCanvasElement;
  geo: GeoFix | null;
  shotAt: string;
  source: 'camera' | 'import';
  shotDateNeedsCheck?: boolean;
}

/** 撮影モードに応じて合成画像・原本・サムネイルを作り、端末内に保存する（要件6.5） */
export async function saveCapture(input: SaveInput): Promise<WorkRecord> {
  const { mode, board, layout, photo } = input;
  const id = newId();
  const withBoard = mode !== 'without_board' && layout != null;
  diag('save:begin', { mode, w: photo.width, h: photo.height, source: input.source });
  const composite = withBoard ? composeWithBoard(photo, board, layout) : null;
  const keepOriginal = mode !== 'with_board' || !withBoard;

  // 重い変換の合間に画面の更新を挟み、使い終わった大きい画像はすぐに解放する
  const images: StoredImage[] = [];
  await yieldToUi();
  images.push({ key: `${id}:thumb`, recordId: id, kind: 'thumb', blob: await diagStep('save:thumb', () => makeThumbnail(composite ?? photo)) });
  if (composite) {
    images.push({ key: `${id}:composite`, recordId: id, kind: 'composite', blob: await diagStep('save:composite', () => canvasToJpeg(composite)) });
    releaseCanvas(composite);
    await yieldToUi();
  }
  if (keepOriginal) images.push({ key: `${id}:original`, recordId: id, kind: 'original', blob: await diagStep('save:original', () => canvasToJpeg(photo)) });
  diag('save:sizes', images.map((i) => `${i.kind}=${Math.round(i.blob.size / 1024)}KB`).join(' '));

  const t = nowIso();
  const record: WorkRecord = {
    id,
    ledgerId: input.ledgerId,
    mode: withBoard ? mode : 'without_board',
    board: withBoard ? board : null,
    boardLayout: withBoard ? layout : null,
    memo: '',
    handover: input.handover.text.trim(),
    handoverInReport: input.handover.inReport,
    shotAt: input.shotAt,
    shotDateNeedsCheck: input.shotDateNeedsCheck ?? false,
    source: input.source,
    latitude: input.geo?.latitude ?? null,
    longitude: input.geo?.longitude ?? null,
    locationAccuracy: input.geo?.accuracy ?? null,
    imageWidth: photo.width,
    imageHeight: photo.height,
    syncStatus: 'pending',
    createdBy: prefs.getUserId(),
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
  };

  await diagStep('save:db', () => db.transaction('rw', db.records, db.images, db.ledgers, async () => {
    await db.records.add(record);
    await db.images.bulkAdd(images);
    // 次に黒板を開いたとき、この台帳で最後に使った内容を表示する（要件6.4）
    await db.ledgers.update(input.ledgerId, { ...(withBoard ? { lastBoard: board } : {}), updatedAt: t });
  }));
  diag('save:end', id);
  return record;
}
