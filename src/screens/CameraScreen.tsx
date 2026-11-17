import { useEffect, useMemo, useRef, useState } from 'react';
import { BoardCanvas } from '../components/BoardCanvas';
import { Icon } from '../components/Icon';
import { containRect, useBoardGestures } from '../components/useBoardGestures';
import { useCamera } from '../lib/camera';
import { clampLayout, defaultLayout, grabVideoFrame } from '../lib/image';
import { diag } from '../lib/diag';
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
  const rect = useMemo(() => containRect(vfSize.w, vfSize.h, videoSize.w, videoSize.h), [vfSize, videoSize]);

  const orientation: Orientation = videoSize.w >= videoSize.h ? 'landscape' : 'portrait';

  // 黒板の配置は縦向き用・横向き用で別々に記憶する（要件6.5）
  const [layout, setLayout] = useState<BoardLayout | null>(null);
  useEffect(() => {
    if (!videoSize.w) return;
    const saved = prefs.getLayout(orientation);
    setLayout(clampLayout(saved ?? defaultLayout(videoSize.w, videoSize.h), videoSize.w, videoSize.h));
  }, [orientation, videoSize.w, videoSize.h]);

  // 黒板の上で始まった操作は黒板の移動・拡縮、それ以外のピンチはズーム
  const zoomStart = useRef(zoom);
  const gestures = useBoardGestures({
    enabled: boardOn,
    rect,
    imageW: videoSize.w,
    imageH: videoSize.h,
    layout,
    onChange: setLayout,
    onCommit: (l) => prefs.setLayout(orientation, l),
    onOtherPinchStart: () => {
      zoomStart.current = zoom;
    },
    onOtherPinch: (scale) => setZoom(zoomStart.current * scale),
  });

  const [busy, setBusy] = useState(false);
  const shoot = async () => {
    const v = videoRef.current;
    if (!v || !ready || busy) return;
    setBusy(true);
    try {
      const photo = grabVideoFrame(v, digitalZoom);
      diag('camera:shoot', { vw: v.videoWidth, vh: v.videoHeight, w: photo.width, h: photo.height, zoom: digitalZoom });
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
        {...gestures}
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
            <div className="cam-board overlay-board" style={{ left: boardPx.left, top: boardPx.top, width: boardPx.width }}>
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
