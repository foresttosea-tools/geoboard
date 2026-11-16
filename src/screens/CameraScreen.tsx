import { useEffect, useMemo, useRef, useState } from 'react';
import { BOARD_ASPECT } from '../blackboard/render';
import { BoardCanvas } from '../components/BoardCanvas';
import { Icon } from '../components/Icon';
import { useCamera } from '../lib/camera';
import { clampLayout, defaultLayout, grabVideoFrame } from '../lib/image';
import { prefs, type Orientation } from '../lib/prefs';
import { useGeolocation, useLevel, type GeoFix } from '../lib/sensors';
import type { BoardContent, BoardLayout, CaptureMode } from '../types';

export interface CaptureResult {
  photo: HTMLCanvasElement;
  layout: BoardLayout | null;
  geo: GeoFix | null;
  shotAt: string;
}

interface Props {
  board: BoardContent;
  mode: CaptureMode;
  onBack: () => void;
  onCaptured: (r: CaptureResult) => void;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

type Gesture =
  | { kind: 'board-move'; startX: number; startY: number; start: BoardLayout }
  | { kind: 'board-pinch'; startDist: number; start: BoardLayout }
  | { kind: 'zoom'; startDist: number; startZoom: number }
  | null;

const dist = (a: PointerEvent, b: PointerEvent) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

export function CameraScreen({ board, mode, onBack, onCaptured }: Props) {
  const { videoRef, ready, error, hardwareZoom, zoom, setZoom, digitalZoom } = useCamera(true);
  const { fix: geo } = useGeolocation(true);
  const [showGrid, setShowGrid] = useState(prefs.getGrid());
  const [showLevel, setShowLevel] = useState(prefs.getLevel());
  const level = useLevel(showLevel);
  const boardOn = mode !== 'without_board';

  const vfRef = useRef<HTMLDivElement>(null);
  const [vfSize, setVfSize] = useState({ w: 0, h: 0 });
  const [videoSize, setVideoSize] = useState({ w: 0, h: 0 });

  // ビューファインダーの大きさを監視
  useEffect(() => {
    const el = vfRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setVfSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 映像の縦横（端末を回転すると変わる）を監視
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const update = () => v.videoWidth && setVideoSize({ w: v.videoWidth, h: v.videoHeight });
    update();
    v.addEventListener('resize', update);
    v.addEventListener('loadedmetadata', update);
    return () => {
      v.removeEventListener('resize', update);
      v.removeEventListener('loadedmetadata', update);
    };
  }, [videoRef, ready]);

  /** 画面内に収めた映像の表示範囲（＝撮影される範囲） */
  const rect: Rect | null = useMemo(() => {
    if (!vfSize.w || !videoSize.w) return null;
    const s = Math.min(vfSize.w / videoSize.w, vfSize.h / videoSize.h);
    const width = videoSize.w * s;
    const height = videoSize.h * s;
    return { left: (vfSize.w - width) / 2, top: (vfSize.h - height) / 2, width, height };
  }, [vfSize, videoSize]);

  const orientation: Orientation = videoSize.w >= videoSize.h ? 'landscape' : 'portrait';

  // 黒板の配置は縦向き用・横向き用で別々に記憶する（要件6.5）
  const [layout, setLayout] = useState<BoardLayout | null>(null);
  useEffect(() => {
    if (!videoSize.w) return;
    const saved = prefs.getLayout(orientation);
    setLayout(clampLayout(saved ?? defaultLayout(videoSize.w, videoSize.h), videoSize.w, videoSize.h));
  }, [orientation, videoSize.w, videoSize.h]);

  const layoutRef = useRef(layout);
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  // ジェスチャー：黒板の上で始まった操作は黒板の移動・拡縮、それ以外のピンチはズーム
  const pointers = useRef(new Map<number, PointerEvent>());
  const gesture = useRef<Gesture>(null);

  const isOnBoard = (e: React.PointerEvent) => (e.target as HTMLElement).closest('.cam-board') != null;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, e.nativeEvent);
    const pts = [...pointers.current.values()];
    const l = layoutRef.current;
    if (pts.length === 1) {
      gesture.current = boardOn && l && isOnBoard(e) ? { kind: 'board-move', startX: e.clientX, startY: e.clientY, start: l } : null;
    } else if (pts.length === 2) {
      const d = dist(pts[0], pts[1]);
      if (gesture.current?.kind === 'board-move' && l) {
        gesture.current = { kind: 'board-pinch', startDist: d, start: l };
      } else {
        gesture.current = { kind: 'zoom', startDist: d, startZoom: zoom };
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, e.nativeEvent);
    const g = gesture.current;
    if (!g || !rect || !videoSize.w) return;
    const pts = [...pointers.current.values()];
    if (g.kind === 'board-move') {
      const nx = g.start.x + (e.clientX - g.startX) / rect.width;
      const ny = g.start.y + (e.clientY - g.startY) / rect.height;
      setLayout(clampLayout({ ...g.start, x: nx, y: ny }, videoSize.w, videoSize.h));
    } else if (g.kind === 'board-pinch' && pts.length >= 2) {
      const scale = dist(pts[0], pts[1]) / g.startDist;
      const w = g.start.w * scale;
      // 黒板の中心を保ったまま拡縮
      const startHr = (g.start.w * videoSize.w * BOARD_ASPECT) / videoSize.h;
      const hr = (w * videoSize.w * BOARD_ASPECT) / videoSize.h;
      const cx = g.start.x + g.start.w / 2;
      const cy = g.start.y + startHr / 2;
      setLayout(clampLayout({ x: cx - w / 2, y: cy - hr / 2, w }, videoSize.w, videoSize.h));
    } else if (g.kind === 'zoom' && pts.length >= 2) {
      setZoom(g.startZoom * (dist(pts[0], pts[1]) / g.startDist));
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if ((g?.kind === 'board-move' || g?.kind === 'board-pinch') && layoutRef.current) {
      prefs.setLayout(orientation, layoutRef.current);
    }
    if (pointers.current.size === 0) gesture.current = null;
    else if (g?.kind === 'board-pinch') gesture.current = null;
  };

  const [busy, setBusy] = useState(false);
  const shoot = async () => {
    const v = videoRef.current;
    if (!v || !ready || busy) return;
    setBusy(true);
    try {
      const photo = grabVideoFrame(v, digitalZoom);
      const l = boardOn && layout ? clampLayout(layout, photo.width, photo.height) : null;
      onCaptured({ photo, layout: l, geo, shotAt: new Date().toISOString() });
    } finally {
      setBusy(false);
    }
  };

  const boardPx = rect && layout ? { left: layout.x * rect.width, top: layout.y * rect.height, width: layout.w * rect.width } : null;
  const levelOk = level != null && Math.abs(level) < 1;

  return (
    <div className={`camera camera-${orientation}`}>
      <div className="cam-topbar">
        <button className="cam-btn" onClick={onBack} aria-label="戻る"><Icon name="back" /></button>
        <button
          className={`cam-btn ${showGrid ? 'on' : ''}`}
          onClick={() => {
            setShowGrid(!showGrid);
            prefs.setGrid(!showGrid);
          }}
        >
          グリッド
        </button>
        <button
          className={`cam-btn ${showLevel ? 'on' : ''}`}
          onClick={() => {
            setShowLevel(!showLevel);
            prefs.setLevel(!showLevel);
          }}
        >
          水平器
        </button>
        <button className="cam-btn zoom-label" onClick={() => setZoom(hardwareZoom ? Math.max(1, hardwareZoom.min) : 1)}>
          ×{zoom.toFixed(1)}
        </button>
      </div>

      <div
        className="viewfinder"
        ref={vfRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="cam-frame" style={rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : { inset: 0 }}>
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            style={{ transform: digitalZoom > 1 ? `scale(${digitalZoom})` : undefined }}
          />
          {showGrid && <div className="cam-grid" />}
          {showLevel && level != null && (
            <div className={`cam-level ${levelOk ? 'ok' : ''}`} style={{ transform: `translate(-50%, -50%) rotate(${-level}deg)` }}>
              <span className="cam-level-deg" style={{ transform: `rotate(${level}deg)` }}>{levelOk ? '水平' : `${level.toFixed(1)}°`}</span>
            </div>
          )}
          {boardOn && boardPx && boardPx.width > 0 && (
            <div className="cam-board" style={{ left: boardPx.left, top: boardPx.top, width: boardPx.width }}>
              <BoardCanvas board={board} width={Math.round(boardPx.width)} />
            </div>
          )}
        </div>
        {error && <div className="cam-error">{error}</div>}
        {!ready && !error && <div className="cam-loading">カメラを起動しています…</div>}
      </div>

      <div className="cam-bottombar">
        <span className="cam-status">
          {mode === 'without_board' ? '黒板なし' : mode === 'both' ? '黒板あり＋なし' : '黒板あり'}
          {' / '}
          {geo ? `位置 ±${Math.round(geo.accuracy)}m` : '位置 取得中'}
        </span>
        <button className="shutter" onClick={shoot} disabled={!ready || busy} aria-label="撮影" />
        <span className="cam-hint">{boardOn ? '黒板はドラッグで移動、ピンチで拡大縮小' : ''}</span>
      </div>
    </div>
  );
}
