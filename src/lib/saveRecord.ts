import { db, newId, nowIso } from '../db';
import type { BoardContent, BoardLayout, CaptureMode, StoredImage, WorkRecord } from '../types';
import { canvasToJpeg, composeWithBoard, makeThumbnail } from './image';
import { prefs } from './prefs';
import type { GeoFix } from './sensors';

interface SaveInput {
  ledgerId: string;
  mode: CaptureMode;
  board: BoardContent;
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
  const composite = withBoard ? composeWithBoard(photo, board, layout) : null;
  const keepOriginal = mode !== 'with_board' || !withBoard;

  const images: StoredImage[] = [];
  if (composite) images.push({ key: `${id}:composite`, recordId: id, kind: 'composite', blob: await canvasToJpeg(composite) });
  if (keepOriginal) images.push({ key: `${id}:original`, recordId: id, kind: 'original', blob: await canvasToJpeg(photo) });
  images.push({ key: `${id}:thumb`, recordId: id, kind: 'thumb', blob: await makeThumbnail(composite ?? photo) });

  const t = nowIso();
  const record: WorkRecord = {
    id,
    ledgerId: input.ledgerId,
    mode: withBoard ? mode : 'without_board',
    board: withBoard ? board : null,
    boardLayout: withBoard ? layout : null,
    memo: '',
    shotAt: input.shotAt,
    shotDateNeedsCheck: input.shotDateNeedsCheck ?? false,
    source: input.source,
    latitude: input.geo?.latitude ?? null,
    longitude: input.geo?.longitude ?? null,
    locationAccuracy: input.geo?.accuracy ?? null,
    imageWidth: photo.width,
    imageHeight: photo.height,
    syncStatus: 'pending',
    createdBy: prefs.getWorkerName(),
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
  };

  await db.transaction('rw', db.records, db.images, db.ledgers, async () => {
    await db.records.add(record);
    await db.images.bulkAdd(images);
    // 次に黒板を開いたとき、この台帳で最後に使った内容を表示する（要件6.4）
    await db.ledgers.update(input.ledgerId, { ...(withBoard ? { lastBoard: board } : {}), updatedAt: t });
  });
  return record;
}
