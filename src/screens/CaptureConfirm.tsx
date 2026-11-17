import { useEffect, useState } from 'react';
import { canvasToJpeg, composeWithBoard, releaseCanvas, scaledCopy } from '../lib/image';
import type { BoardContent, CaptureMode } from '../types';
import type { CaptureResult } from './CameraScreen';

interface Props {
  result: CaptureResult;
  board: BoardContent;
  mode: CaptureMode;
  onRetake: () => void;
  onSave: () => Promise<void>;
}

export function CaptureConfirm({ result, board, mode, onRetake, onSave }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // プレビューは縮小した写真で作る（大きい写真のまま変換すると数秒固まる端末があるため）
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    const small = scaledCopy(result.photo, 1600);
    const c = result.layout && mode !== 'without_board' ? composeWithBoard(small, board, result.layout) : small;
    canvasToJpeg(c, 0.8).then((blob) => {
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setPreview(url);
    });
    if (c !== small) releaseCanvas(small);
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [result, board, mode]);

  return (
    <div className="screen screen-dark">
      <header className="appbar appbar-dark">
        <h1>撮影確認</h1>
      </header>
      <main className="confirm-body">
        {preview ? <img src={preview} alt="撮影した写真" className="confirm-img" /> : <p className="confirm-meta">プレビューを作成しています…</p>}
        <p className="confirm-meta">
          {mode === 'without_board' ? '黒板なし' : mode === 'both' ? '黒板あり＋なし（両方）を保存' : '黒板ありを保存'}
          {' / '}
          {result.geo ? `位置情報あり（±${Math.round(result.geo.accuracy)}m）` : '位置情報なし'}
          {' / '}
          {result.photo.width}×{result.photo.height}
        </p>
        {error && <p className="error">{error}</p>}
      </main>
      <footer className="bottombar bottombar-dark">
        <button className="btn" onClick={onRetake} disabled={saving}>撮り直し</button>
        <button
          className="btn btn-primary"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            setError(null);
            try {
              await onSave();
            } catch (e) {
              setError(`保存に失敗しました：${(e as Error).message}`);
              setSaving(false);
            }
          }}
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </footer>
    </div>
  );
}
