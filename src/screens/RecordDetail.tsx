import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { BOARD_SLOTS, SLOT_DATE, formatBoardDate } from '../blackboard/model';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ExtraPhotos } from '../components/ExtraPhotos';
import { HandoverField } from '../components/HandoverField';
import { Icon } from '../components/Icon';
import { Marks } from '../components/RecordMarks';
import { useImageUrl } from '../sync/images';
import { db, deleteRecord, nowIso } from '../db';
import { canFixBoard, confirmShotDate } from '../lib/editRecord';
import { SLOT_DATE as DATE_SLOT, todayIsoDate } from '../blackboard/model';
import type { Handover, WorkRecord } from '../types';

interface Props {
  id: string;
  /** 一覧の並び順どおりのID。前後の記録へ移動するのに使う */
  ids: string[];
  onNavigate: (id: string) => void;
  onBack: () => void;
  onFixBoard: (id: string) => void;
}

const MODE_LABEL = { with_board: '黒板ありのみ', without_board: '黒板なしのみ', both: '黒板あり＋なし（両方）' } as const;

/** 横スワイプと判定する移動量（px） */
const SWIPE_MIN = 60;

type Notes = Handover & { memo: string };
const savedNotes = (r: WorkRecord): Notes => ({ text: r.handover ?? '', inReport: r.handoverInReport ?? false, memo: r.memo ?? '' });

export function RecordDetail({ id, ids, onNavigate, onBack, onFixBoard }: Props) {
  const record = useLiveQuery(() => db.records.get(id), [id]);
  const [showOriginal, setShowOriginal] = useState(false);
  // 黒板なしのみの記録は原本だけ。両方の記録は切り替えで原本を表示
  const useOriginal = showOriginal || record?.mode === 'without_board';
  const image = useImageUrl(
    record ? `${id}:${useOriginal ? 'original' : 'composite'}` : null,
    useOriginal ? record?.originalPath : record?.compositePath,
  );
  const thumb = useImageUrl(record ? `${id}:thumb` : null, record?.thumbPath);
  const url = image.url ?? thumb.url;

  // 引継ぎ事項・メモの編集中の内容。記録を切り替えたら破棄する
  const [draft, setDraft] = useState<(Notes & { id: string }) | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  // 未保存のまま移動しようとしたときの移動先
  const [pending, setPending] = useState<{ kind: 'back' } | { kind: 'fix' } | { kind: 'go'; id: string; dir: 1 | -1 } | null>(null);
  const [slide, setSlide] = useState<'next' | 'prev' | null>(null);

  const index = ids.indexOf(id);
  const prevId = index > 0 ? ids[index - 1] : null;
  const nextId = index >= 0 && index < ids.length - 1 ? ids[index + 1] : null;

  const touch = useRef<{ x: number; y: number } | null>(null);

  if (!record) return null;

  const saved = savedNotes(record);
  const notes = draft?.id === id ? draft : saved;
  const dirty = notes.text !== saved.text || notes.inReport !== saved.inReport || notes.memo !== saved.memo;

  const saveNotes = async () => {
    await db.records.update(id, { handover: notes.text.trim(), handoverInReport: notes.inReport, memo: notes.memo.trim(), updatedAt: nowIso() });
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
    } else if (target.kind === 'fix') {
      onFixBoard(id);
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
        <div className="detail-img">
          {url && <img src={url} alt="作業記録の写真" draggable={false} />}
          {!image.url && (image.loading || image.error) && (
            <span className="detail-img-note">{image.error ? '圏外のため縮小版を表示しています' : '写真を読み込んでいます…'}</span>
          )}
        </div>
        {record.mode === 'both' && (
          <div className="segmented inline">
            <button className={!showOriginal ? 'on' : ''} onClick={() => setShowOriginal(false)}>黒板あり</button>
            <button className={showOriginal ? 'on' : ''} onClick={() => setShowOriginal(true)}>黒板なし</button>
          </div>
        )}
        <Marks r={record} />
        {record.shotDateNeedsCheck && <ShotDateCheck record={record} />}

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
                ? `${record.latitude.toFixed(6)}, ${record.longitude.toFixed(6)}${record.locationAccuracy ? `（±${Math.round(record.locationAccuracy)}m）` : ''}`
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
        {record.board && (
          canFixBoard(record) ? (
            <button className="btn btn-wide" onClick={() => requestMove({ kind: 'fix' })}>
              <Icon name="edit" size={18} />
              黒板を修正（写真を作り直す）
            </button>
          ) : (
            <p className="hint">「黒板ありのみ」で保存したため、黒板の写真は修正できません。訂正はメモに書いてください</p>
          )
        )}

        <div className="card notes-card">
          <label className="field">
            <span>メモ（補足・訂正。レポートに載ります）</span>
            <textarea
              rows={3}
              value={notes.memo}
              onChange={(e) => {
                setDraft({ ...notes, memo: e.target.value, id });
                setJustSaved(false);
              }}
            />
          </label>
          <HandoverField
            value={notes}
            onChange={(h) => {
              setDraft({ ...notes, ...h, id });
              setJustSaved(false);
            }}
          />
          <button className="btn btn-primary btn-wide" disabled={!dirty} onClick={saveNotes}>
            {justSaved && !dirty ? '保存しました' : 'メモと引継ぎ事項を保存'}
          </button>
        </div>
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
          title="メモ・引継ぎ事項が保存されていません"
          message="編集中の内容は破棄されます。移動してもよろしいですか？"
          onDismiss={() => setPending(null)}
          actions={[
            {
              label: '保存して移動',
              variant: 'primary',
              onClick: async () => {
                await saveNotes();
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

/** 「日付要確認」の記録の撮影日を確定する */
function ShotDateCheck({ record }: { record: WorkRecord }) {
  const initial = record.board?.[DATE_SLOT]?.value || todayIsoDate(new Date(record.shotAt));
  const [date, setDate] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const willRecompose = canFixBoard(record) && date !== record.board?.[DATE_SLOT]?.value;
  return (
    <div className="date-check">
      <p className="date-check-title">撮影日を確認してください</p>
      <p className="date-check-text">
        写真から撮影日を読み取れなかったため、仮の日付が入っています。
        {canFixBoard(record)
          ? '日付を変えると、黒板の撮影日も直して写真を作り直します。'
          : record.board
            ? '「黒板ありのみ」で保存したため、写真の黒板の日付は直せません。記録の撮影日だけを直します。'
            : ''}
      </p>
      <div className="inline-form">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="撮影日" />
        <button
          className="btn btn-primary"
          disabled={!date || busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await confirmShotDate(record, date);
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          {busy ? (willRecompose ? '写真を作り直しています…' : '保存中…') : 'この日付で確定'}
        </button>
      </div>
      {error && <p className="hint danger">{error}</p>}
    </div>
  );
}
