import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { db } from '../db';
import { addExtraPhotos, deleteExtraPhoto } from '../lib/extraPhotos';
import type { ExtraPhoto } from '../types';
import { Icon } from './Icon';
import { useImageUrl } from '../sync/images';

/** 作業記録の追加写真（黒板なし・複数枚、閲覧用） */
export function ExtraPhotos({ recordId }: { recordId: string }) {
  const extras = useLiveQuery(
    () => db.extras.where('recordId').equals(recordId).filter((x) => !x.deletedAt).sortBy('createdAt'),
    [recordId],
  );
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);

  const onFiles = async (files: FileList | null, source: ExtraPhoto['source']) => {
    if (!files || files.length === 0) return;
    setBusy(`${files.length}枚を保存しています…`);
    setMessage(null);
    const { failed } = await addExtraPhotos(recordId, Array.from(files), source);
    setBusy(null);
    if (failed > 0) setMessage(`${failed}枚の画像を読み込めませんでした`);
  };

  const list = extras ?? [];

  return (
    <section className="card extras">
      <div className="extras-head">
        <h2>追加写真</h2>
        <span className="extras-count">{list.length}枚</span>
      </div>
      <p className="hint">黒板なしの写真を何枚でも追加できます。レポートには載りません</p>

      {list.length > 0 && (
        <ul className="extras-grid">
          {list.map((x, i) => (
            <li key={x.id}>
              <button className="extras-thumb" onClick={() => setViewing(i)} aria-label={`追加写真 ${i + 1}`}>
                <ExtraThumb x={x} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="row-actions">
        <button className="btn" disabled={busy != null} onClick={() => cameraInput.current?.click()}>
          <Icon name="camera" size={18} />
          撮影して追加
        </button>
        <button className="btn" disabled={busy != null} onClick={() => fileInput.current?.click()}>
          <Icon name="image" size={18} />
          写真から追加
        </button>
      </div>
      {busy && <p className="hint">{busy}</p>}
      {message && <p className="hint danger">{message}</p>}

      {/* 撮影はスマホ標準のカメラ、写真からは複数枚選択 */}
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          onFiles(e.target.files, 'camera');
          e.target.value = '';
        }}
      />
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          onFiles(e.target.files, 'import');
          e.target.value = '';
        }}
      />

      {viewing != null && list[viewing] && (
        <ExtraViewer
          extras={list}
          index={viewing}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
          onDelete={async (id) => {
            if (!confirm('この追加写真を削除しますか？')) return;
            await deleteExtraPhoto(id);
            const remaining = list.length - 1;
            setViewing(remaining === 0 ? null : Math.min(viewing, remaining - 1));
          }}
        />
      )}
    </section>
  );
}

function ExtraThumb({ x }: { x: ExtraPhoto }) {
  const { url } = useImageUrl(`${x.id}:extra_thumb`, x.thumbPath, { persist: { recordId: x.recordId, kind: 'extra_thumb' } });
  return url ? <img src={url} alt="" /> : null;
}

interface ViewerProps {
  extras: ExtraPhoto[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onDelete: (id: string) => void;
}

/** 追加写真の全画面表示。左右スワイプで前後の追加写真に移動 */
function ExtraViewer({ extras, index, onIndex, onClose, onDelete }: ViewerProps) {
  const x = extras[index];
  const full = useImageUrl(`${x.id}:extra`, x.path);
  const thumb = useImageUrl(`${x.id}:extra_thumb`, x.thumbPath);
  const url = full.url ?? thumb.url;
  const start = useRef<{ x: number; y: number } | null>(null);
  const prev = index > 0 ? () => onIndex(index - 1) : undefined;
  const next = index < extras.length - 1 ? () => onIndex(index + 1) : undefined;

  // 親（作業記録の詳細画面）のスワイプ操作に伝わらないよう止める
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return createPortal(
    <div
      className="viewer"
      onTouchStart={(e) => {
        stop(e);
        start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }}
      onTouchEnd={(e) => {
        stop(e);
        const s = start.current;
        start.current = null;
        if (!s) return;
        const dx = e.changedTouches[0].clientX - s.x;
        const dy = e.changedTouches[0].clientY - s.y;
        if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        if (dx < 0) next?.();
        else prev?.();
      }}
    >
      <div className="viewer-bar">
        <button className="cam-btn cam-round" onClick={onClose} aria-label="閉じる">
          <Icon name="close" />
        </button>
        <span className="viewer-pos">
          {index + 1} / {extras.length}
        </span>
        <button className="cam-btn cam-round" onClick={() => onDelete(x.id)} aria-label="削除">
          <Icon name="trash" size={18} />
        </button>
      </div>
      <div className="viewer-img">{url && <img key={x.id} src={url} alt={`追加写真 ${index + 1}`} draggable={false} />}</div>
      <div className="viewer-nav">
        <button className="cam-btn cam-round" onClick={prev} disabled={!prev} aria-label="前の写真">
          <Icon name="back" />
        </button>
        <span className="viewer-meta">{new Date(x.createdAt).toLocaleString('ja-JP')}</span>
        <button className="cam-btn cam-round" onClick={next} disabled={!next} aria-label="次の写真">
          <span className="flip">
            <Icon name="back" />
          </span>
        </button>
      </div>
    </div>,
    document.body,
  );
}
