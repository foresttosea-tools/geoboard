import { BOARD_ASPECT, drawBoard } from '../blackboard/render';
import type { BoardContent, BoardLayout } from '../types';

/** 保存する写真の長辺の上限（要件6.5：長辺3000〜4000px前後） */
export const MAX_LONG_EDGE = 4000;
export const JPEG_QUALITY = 0.88;
const THUMB_LONG_EDGE = 480;

function createCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function get2d(c: HTMLCanvasElement) {
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvasが使用できません');
  return ctx;
}

/**
 * カメラ映像から1フレームを切り出す。
 * @param digitalZoom デジタルズーム倍率（中央を切り抜く）。端末のズーム機能を使う場合は1
 */
export function grabVideoFrame(video: HTMLVideoElement, digitalZoom = 1): HTMLCanvasElement {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const sw = vw / digitalZoom;
  const sh = vh / digitalZoom;
  const sx = (vw - sw) / 2;
  const sy = (vh - sh) / 2;
  const scale = Math.min(1, MAX_LONG_EDGE / Math.max(sw, sh));
  const c = createCanvas(sw * scale, sh * scale);
  const ctx = get2d(c);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

/** 写真に黒板を焼き込んだ新しいCanvasを返す */
export function composeWithBoard(photo: HTMLCanvasElement, board: BoardContent, layout: BoardLayout): HTMLCanvasElement {
  const c = createCanvas(photo.width, photo.height);
  const ctx = get2d(c);
  ctx.drawImage(photo, 0, 0);
  const bw = layout.w * photo.width;
  drawBoard(ctx, board, layout.x * photo.width, layout.y * photo.height, bw);
  return c;
}

export function canvasToJpeg(c: HTMLCanvasElement, quality = JPEG_QUALITY): Promise<Blob> {
  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('画像の変換に失敗しました'))), 'image/jpeg', quality);
  });
}

export function makeThumbnail(src: HTMLCanvasElement): Promise<Blob> {
  const scale = Math.min(1, THUMB_LONG_EDGE / Math.max(src.width, src.height));
  const c = createCanvas(src.width * scale, src.height * scale);
  const ctx = get2d(c);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return canvasToJpeg(c, 0.8);
}

/** 黒板の高さ（写真の高さに対する割合） */
export function boardHeightRatio(layout: BoardLayout, photoW: number, photoH: number) {
  return (layout.w * photoW * BOARD_ASPECT) / photoH;
}

/** 黒板が写真からはみ出さないように位置とサイズを補正する */
export function clampLayout(layout: BoardLayout, photoW: number, photoH: number): BoardLayout {
  const maxW = Math.min(1, photoH / (photoW * BOARD_ASPECT));
  const w = Math.min(Math.max(layout.w, 0.12), maxW);
  const hr = (w * photoW * BOARD_ASPECT) / photoH;
  return {
    w,
    x: Math.min(Math.max(layout.x, 0), 1 - w),
    y: Math.min(Math.max(layout.y, 0), 1 - hr),
  };
}

/** 初期配置：左下 */
export function defaultLayout(photoW: number, photoH: number): BoardLayout {
  const landscape = photoW >= photoH;
  const w = landscape ? 0.36 : 0.55;
  const margin = 0.025;
  const hr = (w * photoW * BOARD_ASPECT) / photoH;
  return clampLayout({ x: margin, y: 1 - hr - margin * (photoW / photoH), w }, photoW, photoH);
}

/**
 * 画像ファイル（Blob）を読み込み、長辺を上限内に縮小したCanvasを返す。
 * <img> 経由で描画すると、ブラウザがExifの回転情報を反映してくれる
 */
export async function loadImageToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const scale = Math.min(1, MAX_LONG_EDGE / Math.max(w, h));
    const c = createCanvas(w * scale, h * scale);
    const ctx = get2d(c);
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

/** 画像の縦横サイズ（Exifの回転を反映した表示上のサイズ） */
export async function readImageSize(blob: Blob): Promise<{ w: number; h: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { w: img.naturalWidth, h: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}
