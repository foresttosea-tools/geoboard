import { db, newId, nowIso } from '../db';
import type { ExtraPhoto, StoredImage } from '../types';
import { MAX_LONG_EDGE, canvasToJpeg, makeThumbnail } from './image';
import { prefs } from './prefs';

/**
 * 画像ファイルを読み込み、長辺を上限内に縮小したCanvasを返す。
 * <img> 経由で描画すると、ブラウザがExifの回転情報を反映してくれる
 */
async function fileToCanvas(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const scale = Math.min(1, MAX_LONG_EDGE / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('Canvasが使用できません');
    // 透過PNG（スクリーンショットなど）がJPEG変換で黒くならないよう白で塗っておく
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 追加写真を保存する（黒板なし・複数枚） */
export async function addExtraPhotos(recordId: string, files: File[], source: ExtraPhoto['source']): Promise<{ saved: number; failed: number }> {
  let saved = 0;
  let failed = 0;
  for (const file of files) {
    try {
      const canvas = await fileToCanvas(file);
      const id = newId();
      const images: StoredImage[] = [
        { key: `${id}:extra`, recordId, kind: 'extra', blob: await canvasToJpeg(canvas) },
        { key: `${id}:extra_thumb`, recordId, kind: 'extra_thumb', blob: await makeThumbnail(canvas) },
      ];
      const extra: ExtraPhoto = {
        id,
        recordId,
        source,
        width: canvas.width,
        height: canvas.height,
        syncStatus: 'pending',
        createdBy: prefs.getWorkerName(),
        createdAt: nowIso(),
        deletedAt: null,
      };
      await db.transaction('rw', db.extras, db.images, db.records, async () => {
        await db.extras.add(extra);
        await db.images.bulkAdd(images);
        await db.records.update(recordId, { updatedAt: extra.createdAt });
      });
      saved++;
    } catch {
      failed++;
    }
  }
  return { saved, failed };
}

/** 論理削除（要件4.3） */
export async function deleteExtraPhoto(id: string) {
  await db.extras.update(id, { deletedAt: nowIso() });
}
