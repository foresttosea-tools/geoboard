import { useEffect, useRef } from 'react';
import { BOARD_ASPECT } from '../blackboard/render';
import { clampLayout } from '../lib/image';
import type { BoardLayout } from '../types';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

type Gesture =
  | { kind: 'board-move'; startX: number; startY: number; start: BoardLayout }
  | { kind: 'board-pinch'; startDist: number; start: BoardLayout }
  | { kind: 'other-pinch'; startDist: number }
  | null;

const dist = (a: PointerEvent, b: PointerEvent) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

interface Options {
  enabled: boolean;
  /** 画面上の写真（映像）の表示範囲 */
  rect: Rect | null;
  /** 写真（映像）の実サイズ */
  imageW: number;
  imageH: number;
  layout: BoardLayout | null;
  onChange: (l: BoardLayout) => void;
  /** 黒板の移動・拡縮が終わったとき */
  onCommit?: (l: BoardLayout) => void;
  /** 黒板以外でのピンチ（カメラのズーム用）。scale は開始時からの倍率 */
  onOtherPinchStart?: () => void;
  onOtherPinch?: (scale: number) => void;
  /** 黒板とみなす要素のセレクター */
  boardSelector?: string;
}

/**
 * 黒板のドラッグ移動・ピンチ拡縮。撮影画面と取り込み画面で共通（要件6.5, 6.6）。
 * 黒板の上で始まった操作は黒板に、それ以外のピンチは onOtherPinch に渡す
 */
export function useBoardGestures(o: Options) {
  const pointers = useRef(new Map<number, PointerEvent>());
  const gesture = useRef<Gesture>(null);
  const latest = useRef(o.layout);
  useEffect(() => {
    latest.current = o.layout;
  }, [o.layout]);

  const selector = o.boardSelector ?? '.overlay-board';

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, e.nativeEvent);
    const pts = [...pointers.current.values()];
    const l = latest.current;
    if (pts.length === 1) {
      const onBoard = (e.target as HTMLElement).closest(selector) != null;
      gesture.current = o.enabled && l && onBoard ? { kind: 'board-move', startX: e.clientX, startY: e.clientY, start: l } : null;
    } else if (pts.length === 2) {
      const d = dist(pts[0], pts[1]);
      if (gesture.current?.kind === 'board-move' && l) {
        gesture.current = { kind: 'board-pinch', startDist: d, start: l };
      } else if (o.onOtherPinch) {
        o.onOtherPinchStart?.();
        gesture.current = { kind: 'other-pinch', startDist: d };
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, e.nativeEvent);
    const g = gesture.current;
    const { rect, imageW: w, imageH: h } = o;
    if (!g || !rect || !w) return;
    const pts = [...pointers.current.values()];
    if (g.kind === 'board-move') {
      const nx = g.start.x + (e.clientX - g.startX) / rect.width;
      const ny = g.start.y + (e.clientY - g.startY) / rect.height;
      o.onChange(clampLayout({ ...g.start, x: nx, y: ny }, w, h));
    } else if (g.kind === 'board-pinch' && pts.length >= 2) {
      const scale = dist(pts[0], pts[1]) / g.startDist;
      const bw = g.start.w * scale;
      // 黒板の中心を保ったまま拡縮
      const startHr = (g.start.w * w * BOARD_ASPECT) / h;
      const hr = (bw * w * BOARD_ASPECT) / h;
      const cx = g.start.x + g.start.w / 2;
      const cy = g.start.y + startHr / 2;
      o.onChange(clampLayout({ x: cx - bw / 2, y: cy - hr / 2, w: bw }, w, h));
    } else if (g.kind === 'other-pinch' && pts.length >= 2) {
      o.onOtherPinch?.(dist(pts[0], pts[1]) / g.startDist);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if ((g?.kind === 'board-move' || g?.kind === 'board-pinch') && latest.current) {
      o.onCommit?.(latest.current);
    }
    if (pointers.current.size === 0 || g?.kind === 'board-pinch') gesture.current = null;
  };

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp };
}

/** 枠の中に写真を収めたときの表示範囲（object-fit: contain 相当） */
export function containRect(boxW: number, boxH: number, imgW: number, imgH: number): Rect | null {
  if (!boxW || !boxH || !imgW || !imgH) return null;
  const s = Math.min(boxW / imgW, boxH / imgH);
  const width = imgW * s;
  const height = imgH * s;
  return { left: (boxW - width) / 2, top: (boxH - height) / 2, width, height };
}
