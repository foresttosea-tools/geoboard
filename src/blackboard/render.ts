import type { BoardContent } from '../types';
import { BOARD_SLOTS, SLOT_DATE, formatBoardDate } from './model';

/** 黒板の論理サイズ。描画時は幅に合わせて拡大縮小する */
export const BOARD_W = 1000;
export const BOARD_H = 720;
export const BOARD_ASPECT = BOARD_H / BOARD_W;

/** 外周の余白（木枠なし。要件6.4） */
const FRAME = 12;
const LABEL_RATIO = 0.27;
const PAD_X = 14;
const FONT_FAMILY = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif';

const COLOR_BOARD = '#1f4a36';
const COLOR_LINE = 'rgba(255,255,255,0.85)';
const COLOR_TEXT = '#ffffff';
const COLOR_LABEL = '#f4f1d8';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function font(size: number, bold: boolean) {
  return `${bold ? '700' : '500'} ${size}px ${FONT_FAMILY}`;
}

/**
 * 1行に収める描画。文字サイズを縮小し、それでも収まらなければ横方向に圧縮する（要件6.4）
 */
function drawSingleLine(ctx: Ctx, text: string, x: number, y: number, w: number, h: number, bold: boolean, color: string) {
  if (!text) return;
  const maxSize = h * 0.52;
  const minSize = h * 0.22;
  let size = maxSize;
  ctx.font = font(size, bold);
  let width = ctx.measureText(text).width;
  while (width > w && size > minSize) {
    size = Math.max(minSize, size * 0.94);
    ctx.font = font(size, bold);
    width = ctx.measureText(text).width;
  }
  ctx.save();
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.translate(x, y + h / 2);
  if (width > w) ctx.scale(w / width, 1);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** 文字単位で折り返す（日本語はスペースで区切れないため） */
function wrap(ctx: Ctx, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const ch of Array.from(para)) {
      const next = line + ch;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = ch;
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * 枠内で折り返す描画。収まるまで文字サイズを縮小し、最小サイズでも溢れる場合は末尾を「…」で省略する
 */
function drawMultiLine(ctx: Ctx, text: string, x: number, y: number, w: number, h: number, unitH: number) {
  if (!text) return;
  const maxSize = unitH * 0.46;
  const minSize = unitH * 0.2;
  const lineGap = 1.25;
  const padY = unitH * 0.12;
  const availH = h - padY * 2;
  let size = maxSize;
  let lines: string[] = [];
  for (;;) {
    ctx.font = font(size, false);
    lines = wrap(ctx, text, w);
    if (lines.length * size * lineGap <= availH || size <= minSize) break;
    size = Math.max(minSize, size * 0.93);
  }
  const maxLines = Math.max(1, Math.floor(availH / (size * lineGap)));
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    let last = lines[maxLines - 1];
    while (last && ctx.measureText(last + '…').width > w) last = last.slice(0, -1);
    lines[maxLines - 1] = last + '…';
  }
  ctx.save();
  ctx.fillStyle = COLOR_TEXT;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  // 1行だけなら縦中央、複数行なら上詰め
  const startY = lines.length === 1 ? y + (h - size) / 2 : y + padY;
  lines.forEach((line, i) => ctx.fillText(line, x, startY + i * size * lineGap));
  ctx.restore();
}

function drawFrame(ctx: Ctx) {
  // 黒板面（木枠なし）
  ctx.fillStyle = COLOR_BOARD;
  ctx.beginPath();
  ctx.roundRect(0, 0, BOARD_W, BOARD_H, 10);
  ctx.fill();
  // 外周の罫線
  ctx.strokeStyle = COLOR_LINE;
  ctx.lineWidth = 3;
  ctx.strokeRect(FRAME, FRAME, BOARD_W - FRAME * 2, BOARD_H - FRAME * 2);
}

/**
 * 黒板を描画する。プレビュー・撮影時の合成・取り込み時の合成すべてでこの関数を使い、見た目を一致させる
 * @param x,y 描画先の左上
 * @param width 描画幅（高さは BOARD_ASPECT から決まる）
 */
export function drawBoard(ctx: Ctx, board: BoardContent, x: number, y: number, width: number) {
  const s = width / BOARD_W;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  drawFrame(ctx);

  const innerX = FRAME;
  const innerY = FRAME;
  const innerW = BOARD_W - FRAME * 2;
  const innerH = BOARD_H - FRAME * 2;
  const totalUnits = BOARD_SLOTS.reduce((sum, slot) => sum + slot.rows, 0);
  const unitH = innerH / totalUnits;
  const labelW = innerW * LABEL_RATIO;

  ctx.strokeStyle = COLOR_LINE;
  ctx.lineWidth = 2;
  // 項目名と内容の区切り線
  ctx.beginPath();
  ctx.moveTo(innerX + labelW, innerY);
  ctx.lineTo(innerX + labelW, innerY + innerH);
  ctx.stroke();

  let rowY = innerY;
  BOARD_SLOTS.forEach((slot, i) => {
    const rowH = unitH * slot.rows;
    const item = board[i] ?? { label: slot.defaultLabel, value: '' };
    if (i > 0) {
      ctx.beginPath();
      ctx.moveTo(innerX, rowY);
      ctx.lineTo(innerX + innerW, rowY);
      ctx.stroke();
    }
    // 項目名（常に1行に収める）
    drawSingleLine(ctx, item.label, innerX + PAD_X, rowY, labelW - PAD_X * 2, unitH, true, COLOR_LABEL);
    // 内容
    const vx = innerX + labelW + PAD_X;
    const vw = innerW - labelW - PAD_X * 2;
    if (slot.kind === 'multi') {
      drawMultiLine(ctx, item.value, vx, rowY, vw, rowH, unitH);
    } else {
      const text = i === SLOT_DATE ? formatBoardDate(item.value) : item.value;
      drawSingleLine(ctx, text, vx, rowY, vw, rowH, false, COLOR_TEXT);
    }
    rowY += rowH;
  });
  ctx.restore();
}

/** 指定幅の黒板画像を単体で生成する（プレビュー用） */
export function renderBoardToCanvas(canvas: HTMLCanvasElement, board: BoardContent, cssWidth: number) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const cssHeight = cssWidth * BOARD_ASPECT;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBoard(ctx, board, 0, 0, canvas.width);
}

/** タップ位置から枠番号を求める（黒板編集画面用）。座標は黒板に対する相対値 0〜1 */
export function hitTestSlot(rx: number, ry: number): number | null {
  const fx = FRAME / BOARD_W;
  const fy = FRAME / BOARD_H;
  if (rx < fx || rx > 1 - fx || ry < fy || ry > 1 - fy) return null;
  const innerRy = (ry - fy) / (1 - fy * 2);
  const totalUnits = BOARD_SLOTS.reduce((sum, slot) => sum + slot.rows, 0);
  let acc = 0;
  for (let i = 0; i < BOARD_SLOTS.length; i++) {
    acc += BOARD_SLOTS[i].rows / totalUnits;
    if (innerRy <= acc) return i;
  }
  return BOARD_SLOTS.length - 1;
}
