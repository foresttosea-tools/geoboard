import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { BOARD_SLOTS, SLOT_DATE, formatBoardDate } from '../blackboard/model';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ExtraPhotos } from '../components/ExtraPhotos';
import { HandoverField } from '../components/HandoverField';
import { Icon } from '../components/Icon';
import { Marks } from '../components/RecordMarks';
import { useBlobUrl } from '../components/useBlobUrl';
import { db, deleteRecord, nowIso } from '../db';
import type { Handover, WorkRecord } from '../types';

interface Props {
  id: string;
  /** 一覧の並び順どおりのID。前後の記録へ移動するのに使う */
  ids: string[];
  onNavigate: (id: string) => void;
  onBack: () => void;
}

const MODE_LABEL = { with_board: '黒板ありのみ', without_board: '黒板なしのみ', both: '黒板あり＋なし（両方）' } as const;

/** 横スワイプと判定する移動量（px） */
const SWIPE_MIN = 60;

const savedHandover = (r: WorkRecord): Handover => ({ text: r.handover ?? '', inReport: r.handoverInReport ?? false });

export function RecordDetail({ id, ids, onNavigate, onBack }: Props) {
  const record = useLiveQuery(() => db.records.get(id), [id]);
  const composite = useLiveQuery(() => db.images.get(`${id}:composite`), [id]);
  const original = useLiveQuery(() => db.images.get(`${id}:original`), [id]);
  const [showOriginal, setShowOriginal] = useState(false);
  const blob = showOriginal ? original?.blob : (composite?.blob ?? original?.blob);
  const url = useBlobUrl(blob);

  // 引継ぎ事項の編集中の内容。記録を切り替えたら破棄する
  const [draft, setDraft] = useState<(Handover & { id: string }) | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  // 未保存のまま移動しようとしたときの移動先
  const [pending, setPending] = useState<{ kind: 'back' } | { kind: 'go'; id: string; dir: 1 | -1 } | null>(null);
  const [slide, setSlide] = useState<'next' | 'prev' | null>(null);

  const index = ids.indexOf(id);
  const prevId = index > 0 ? ids[index - 1] : null;
  const nextId = index >= 0 && index < ids.length - 1 ? ids[index + 1] : null;

  const touch = useRef<{ x: number; y: number } | null>(null);

  if (!record) return null;

  const saved = savedHandover(record);
  const handover = draft?.id === id ? draft : saved;
  const dirty = handover.text !== saved.text || handover.inReport !== saved.inReport;

  const saveHandover = async () => {
    const text = handover.text.trim();
    await db.records.update(id, { handover: text, handoverInReport: handover.inReport, updatedAt: nowIso() });
    setDraft(null);
    setJustSaved(true);
  };

  const doMove = (target: NonNullable<typeof pending>) => {
    setDraft(null);
    setJustSaved(false);
    setShowOriginal(false);
    setPending(null);
    if (target.kind === 'back') {
      onBack();
    } else {
      setSlide(target.dir === 1 ? 'next' : 'prev');
      onNavigate(target.id);
    }
  };

  const requestMove = (target: NonNullable<typeof pending>) => {
    if (dirty) setPending(target);
    else doMove(target);
  };

  const goPrev = () => prevId && requestMove({ kind: 'go', id: prevId, dir: -1 });
  const goNext = () => nextId && requestMove({ kind: 'go', id: nextId, dir: 1 });

  const onTouchStart = (e: React.TouchEvent) => {
    // 入力欄の操作（文字選択など）はスワイプとみなさない
    if ((e.target as HTMLElement).closest('textarea, input')) return;
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) goNext();
    else goPrev();
  };

  return (
    <div className="screen">
      <header className="appbar">
        <button className="icon-btn" onClick={() => requestMove({ kind: 'back' })} aria-label="戻る">
          <Icon name="back" />
        </button>
        <h1>作業記録</h1>
        <button
          className="icon-btn danger"
          aria-label="削除"
          onClick={async () => {
            if (confirm('この記録を削除しますか？')) {
              await deleteRecord(id);
              onBack();
            }
          }}
        >
          <Icon name="trash" />
        </button>
      </header>

      <main
        key={id}
        className={`screen-body ${slide ? `slide-${slide}` : ''}`}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onAnimationEnd={() => setSlide(null)}
      >
        <div className="detail-img">{url && <img src={url} alt="作業記録の写真" draggable={false} />}</div>
        {record.mode === 'both' && (
          <div className="segmented inline">
            <button className={!showOriginal ? 'on' : ''} onClick={() => setShowOriginal(false)}>黒板あり</button>
            <button className={showOriginal ? 'on' : ''} onClick={() => setShowOriginal(true)}>黒板なし</button>
          </div>
        )}
        <Marks r={record} />

        <ExtraPhotos recordId={id} />

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

        <div className="card">
          <HandoverField
            value={handover}
            onChange={(h) => {
              setDraft({ ...h, id });
              setJustSaved(false);
            }}
          />
          <button className="btn btn-primary btn-wide" disabled={!dirty} onClick={saveHandover}>
            {justSaved && !dirty ? '保存しました' : '引継ぎ事項を保存'}
          </button>
        </div>
        <p className="hint">黒板の修正・メモの追記はステップ2で対応予定です</p>
      </main>

      {ids.length > 1 && (
        <footer className="pager">
          <button className="pager-btn" onClick={goPrev} disabled={!prevId} aria-label="前の記録">
            <Icon name="back" size={20} />
            前へ
          </button>
          <span className="pager-pos">
            {index + 1} / {ids.length}
          </span>
          <button className="pager-btn" onClick={goNext} disabled={!nextId} aria-label="次の記録">
            次へ
            <span className="flip">
              <Icon name="back" size={20} />
            </span>
          </button>
        </footer>
      )}

      {pending && (
        <ConfirmDialog
          title="引継ぎ事項が保存されていません"
          message="編集中の内容は破棄されます。移動してもよろしいですか？"
          onDismiss={() => setPending(null)}
          actions={[
            {
              label: '保存して移動',
              variant: 'primary',
              onClick: async () => {
                await saveHandover();
                doMove(pending);
              },
            },
            { label: '保存せずに移動', variant: 'danger', onClick: () => doMove(pending) },
            { label: 'キャンセル', onClick: () => setPending(null) },
          ]}
        />
      )}
    </div>
  );
}
