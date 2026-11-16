import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { BOARD_SLOTS, SLOT_DATE, formatBoardDate } from '../blackboard/model';
import { useBlobUrl } from '../components/useBlobUrl';
import { db, deleteRecord } from '../db';
import { Marks } from '../components/RecordMarks';

interface Props {
  id: string;
  onBack: () => void;
}

const MODE_LABEL = { with_board: '黒板ありのみ', without_board: '黒板なしのみ', both: '黒板あり＋なし（両方）' } as const;

export function RecordDetail({ id, onBack }: Props) {
  const record = useLiveQuery(() => db.records.get(id), [id]);
  const composite = useLiveQuery(() => db.images.get(`${id}:composite`), [id]);
  const original = useLiveQuery(() => db.images.get(`${id}:original`), [id]);
  const [showOriginal, setShowOriginal] = useState(false);
  const blob = showOriginal ? original?.blob : (composite?.blob ?? original?.blob);
  const url = useBlobUrl(blob);

  if (!record) return null;

  return (
    <div className="screen">
      <header className="appbar">
        <button className="icon-btn" onClick={onBack} aria-label="戻る">←</button>
        <h1>作業記録</h1>
        <button
          className="text-btn danger"
          onClick={async () => {
            if (confirm('この記録を削除しますか？')) {
              await deleteRecord(id);
              onBack();
            }
          }}
        >
          削除
        </button>
      </header>
      <main className="screen-body">
        <div className="detail-img">{url && <img src={url} alt="作業記録の写真" />}</div>
        {record.mode === 'both' && (
          <div className="segmented inline">
            <button className={!showOriginal ? 'on' : ''} onClick={() => setShowOriginal(false)}>黒板あり</button>
            <button className={showOriginal ? 'on' : ''} onClick={() => setShowOriginal(true)}>黒板なし</button>
          </div>
        )}
        <Marks r={record} />
        <dl className="detail-list">
          {record.board?.map((it, i) => (
            <div key={i}>
              <dt>{it.label || BOARD_SLOTS[i].defaultLabel}</dt>
              <dd>{(i === SLOT_DATE ? formatBoardDate(it.value) : it.value) || '—'}</dd>
            </div>
          ))}
          <div>
            <dt>撮影日時</dt>
            <dd>{new Date(record.shotAt).toLocaleString('ja-JP')}</dd>
          </div>
          <div>
            <dt>保存方法</dt>
            <dd>{MODE_LABEL[record.mode]}</dd>
          </div>
          <div>
            <dt>位置情報</dt>
            <dd>
              {record.latitude != null && record.longitude != null
                ? `${record.latitude.toFixed(6)}, ${record.longitude.toFixed(6)}（±${Math.round(record.locationAccuracy ?? 0)}m）`
                : 'なし'}
            </dd>
          </div>
          <div>
            <dt>画像サイズ</dt>
            <dd>
              {record.imageWidth}×{record.imageHeight}
            </dd>
          </div>
        </dl>
        <p className="hint">黒板の修正・メモの追記はステップ2で対応予定です</p>
      </main>
    </div>
  );
}
