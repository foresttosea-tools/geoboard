import exifr from 'exifr';
import type { GeoFix } from './sensors';

export interface PhotoMeta {
  /** 撮影日時（Exifにない場合はnull） */
  takenAt: Date | null;
  geo: GeoFix | null;
}

/** 画像のExifから撮影日時と位置情報を読む。読めなくてもエラーにしない（要件6.6） */
export async function readPhotoMeta(file: Blob): Promise<PhotoMeta> {
  let takenAt: Date | null = null;
  let geo: GeoFix | null = null;
  try {
    const tags = await exifr.parse(file, { pick: ['DateTimeOriginal', 'CreateDate'] });
    const d = tags?.DateTimeOriginal ?? tags?.CreateDate;
    if (d instanceof Date && !Number.isNaN(d.getTime())) takenAt = d;
  } catch {
    /* Exifなし */
  }
  try {
    const g = await exifr.gps(file);
    if (g && Number.isFinite(g.latitude) && Number.isFinite(g.longitude)) {
      geo = { latitude: g.latitude, longitude: g.longitude, accuracy: 0, at: takenAt?.getTime() ?? Date.now() };
    }
  } catch {
    /* 位置情報なし */
  }
  return { takenAt, geo };
}
