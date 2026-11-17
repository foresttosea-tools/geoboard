import { db, newId, nowIso } from '../db';
import type { ExtraPhoto, StoredImage } from '../types';
import { canvasToJpeg, loadImageToCanvas, makeThumbnail } from './image';
import { prefs } from './prefs';

/** 追加写真を保存する（黒板なし・複数枚） */
export async function addExtraPhotos(recordId: string, files: File[], source: ExtraPhoto['source']): Promise<{ saved: number; failed: number }> {
  let saved = 0;
  let failed = 0;
  for (const file of files) {
    try {
      const canvas = await loadImageToCanvas(file);
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
        createdBy: prefs.getUserId(),
        createdAt: nowIso(),
        updatedAt: nowIso(),
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
  const t = nowIso();
  await db.extras.update(id, { deletedAt: t, updatedAt: t });
}
