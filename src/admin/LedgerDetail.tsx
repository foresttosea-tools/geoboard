import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { BOARD_SLOTS, SLOT_DATE, SLOT_PLACE, SLOT_WORK, SLOT_WORKER, formatBoardDate } from '../blackboard/model';
import { HistoryList } from '../components/HistoryList';
import { Icon } from '../components/Icon';
import { LocationValue } from '../components/LocationValue';
import { Marks, formatShotDate } from '../components/RecordMarks';
import { db } from '../db';
import { formatTerm, normalizeForSearch } from '../lib/repo';
import { loadImageBlob } from '../sync/images';
import { hasRecordFilter, recordMatches, type AdminFilter } from './filters';
import { reportImageBlob } from './report';
import { useImageUrl } from '../sync/images';
import type { ExtraPhoto, WorkRecord } from '../types';
import { MapView } from './MapView';
import { ReportDialog } from './ReportDialog';
import { buildLedgerZip, fileSafe, saveBlob } from './zip';

interface Props {
  ledgerId: string;
  isAdmin: boolean;
  onBack: () => void;
  /** 最初に開く作業記録（通知から開いたとき） */
  initialRecordId?: string | null;
  /** P02の絞り込み条件（撮影日・施工者・キーワードで記録を絞る） */
  filter?: AdminFilter;
}

type RecordView = 'grid' | 'list';
const VIEW_KEY = 'geoboard.admin.recordView';
function loadView(): RecordView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

/** P03 台帳詳細 */
export function LedgerDetail({ ledgerId, onBack, initialRecordId, filter }: Props) {
  const ledger = useLiveQuery(() => db.ledgers.get(ledgerId), [ledgerId]);
  const customer = useLiveQuery(async () => (ledger ? await db.customers.get(ledger.customerId) : undefined), [ledger?.customerId]);
  const recordsRaw = useLiveQuery(() => db.records.where('ledgerId').equals(ledgerId).filter((r) => !r.deletedAt).toArray(), [ledgerId]);
  const records = useMemo(() => [...(recordsRaw ?? [])].sort((a, b) => a.shotAt.localeCompare(b.shotAt)), [recordsRaw]);
  const [tab, setTab] = useState<'records' | 'map' | 'history'>('records');
  const [openId, setOpenId] = useState<string | null>(initialRecordId ?? null);
  const [reporting, setReporting] = useState(false);
  const [zipState, setZipState] = useState<string | null>(null);
  const [view, setViewState] = useState<RecordView>(loadView);
  const setView = (v: RecordView) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* 保存できなくても表示は切り替える */
    }
  };
  // 絞り込み条件。キーワードが台帳の内容に含まれる場合は、記録はキーワード以外の条件だけで見る（P02と同じ判定）
  const recordFilter = useMemo(() => {
    if (!filter || !ledger) return null;
    const kw = normalizeForSearch(filter.keyword);
    const ledgerHit = !!kw && [ledger.name, ledger.manager, ledger.note].some((s) => normalizeForSearch(s).includes(kw));
    const f = ledgerHit ? { ...filter, keyword: '' } : filter;
    return hasRecordFilter(f) ? f : null;
  }, [filter, ledger]);
  const [showAll, setShowAll] = useState(false);
  const filtered = !showAll && recordFilter != null;
  const shown = useMemo(() => (filtered && recordFilter ? records.filter((r) => recordMatches(r, recordFilter)) : records), [records, filtered, recordFilter]);
  // ZIPと同じ連番（台帳内の撮影日時順）
  const numberOf = useMemo(() => new Map(records.map((r, i) => [r.id, i + 1])), [records]);

  if (!ledger || !customer) return <div className="admin-page">読み込んでいます…</div>;
  if (ledger.mergedInto) return <MergedNotice ledgerName={ledger.name} targetId={ledger.mergedInto} onBack={onBack} />;

  return (
    <div className="admin-page">
      <button className="text-btn back-link" onClick={onBack}>
        <Icon name="back" size={16} />
        {customer.name}の台帳一覧
      </button>
      <div className="admin-head">
        <div>
          <span className="admin-sub">{customer.name}</span>
          <h1>{ledger.name}</h1>
          <dl className="ledger-info">
            <div>
              <dt>工期</dt>
              <dd>{formatTerm(ledger)}</dd>
            </div>
            <div>
              <dt>工事責任者</dt>
              <dd>{ledger.manager || '—'}</dd>
            </div>
            <div>
              <dt>記録</dt>
              <dd>{records.length}件</dd>
            </div>
            {ledger.note && (
              <div>
                <dt>備考</dt>
                <dd>{ledger.note}</dd>
              </div>
            )}
          </dl>
        </div>
        <div className="admin-actions">
          <button className="btn btn-primary" disabled={records.length === 0} onClick={() => setReporting(true)}>
            PDFレポート
          </button>
          <button
            className="btn"
            disabled={records.length === 0 || zipState != null}
            onClick={async () => {
              setZipState('写真を集めています…');
              try {
                const blob = await buildLedgerZip(customer, ledger, records, (d, t) => setZipState(`写真を集めています（${d}/${t}）…`));
                saveBlob(blob, `${fileSafe(customer.name)}_${fileSafe(ledger.name)}.zip`);
                setZipState(null);
              } catch (e) {
                setZipState(null);
                alert(`ZIPを作成できませんでした：${(e as Error).message}`);
              }
            }}
          >
            {zipState ?? 'ZIPでダウンロード'}
          </button>
        </div>
      </div>

      <div className="admin-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'records'} className={tab === 'records' ? 'on' : ''} onClick={() => setTab('records')}>
          記録（{records.length}）
        </button>
        <button role="tab" aria-selected={tab === 'map'} className={tab === 'map' ? 'on' : ''} onClick={() => setTab('map')}>
          地図
        </button>
        <button role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>
          台帳の変更履歴
        </button>
      </div>

      {tab === 'records' && (
        <div className="admin-records-bar">
          <span className="hint">
            {recordFilter ? (
              filtered ? (
                <>
                  絞り込み中：{shown.length} / {records.length}件
                  <button className="text-btn" onClick={() => setShowAll(true)}>
                    すべて表示
                  </button>
                </>
              ) : (
                <>
                  すべての記録を表示中
                  <button className="text-btn" onClick={() => setShowAll(false)}>
                    絞り込み条件に戻す
                  </button>
                </>
              )
            ) : null}
          </span>
          <div className="segmented inline view-toggle" role="group" aria-label="表示の切り替え">
            <button className={view === 'grid' ? 'on' : ''} aria-pressed={view === 'grid'} onClick={() => setView('grid')} aria-label="グリッド表示">
              <Icon name="grid" size={18} />
            </button>
            <button className={view === 'list' ? 'on' : ''} aria-pressed={view === 'list'} onClick={() => setView('list')} aria-label="リスト表示">
              <Icon name="list" size={18} />
            </button>
          </div>
        </div>
      )}

      {tab === 'records' ? (
        shown.length === 0 ? (
          <p className="empty">{records.length === 0 ? '記録がありません' : '条件に合う記録がありません'}</p>
        ) : view === 'list' ? (
          <table className="admin-table admin-record-table">
            <thead>
              <tr>
                <th className="num">No</th>
                <th />
                <th>撮影日</th>
                <th>作業場所</th>
                <th>作業内容</th>
                <th>施工者</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => setOpenId(r.id)}>
                  <td className="num">{numberOf.get(r.id)}</td>
                  <td className="thumb-cell">
                    <CardThumb r={r} />
                  </td>
                  <td>{formatShotDate(r)}</td>
                  <td className="strong">{r.board?.[SLOT_PLACE]?.value || '—'}</td>
                  <td>{r.board?.[SLOT_WORK]?.value || (r.mode === 'without_board' ? '黒板なし' : '—')}</td>
                  <td>{r.board?.[SLOT_WORKER]?.value || '—'}</td>
                  <td>
                    <Marks r={r} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <ul className="admin-cards">
            {shown.map((r) => (
              <li key={r.id}>
                <button className="admin-card" onClick={() => setOpenId(r.id)}>
                  <CardThumb r={r} />
                  <span className="admin-card-no">{numberOf.get(r.id)}</span>
                  <span className="admin-card-body">
                    <span className="admin-card-date">{formatShotDate(r)}</span>
                    <strong>{r.board?.[SLOT_PLACE]?.value || '（作業場所なし）'}</strong>
                    <span>{r.board?.[SLOT_WORK]?.value || (r.mode === 'without_board' ? '黒板なし' : '')}</span>
                    <Marks r={r} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : tab === 'map' ? (
        <MapView records={records} onOpen={setOpenId} />
      ) : (
        <div className="admin-history">
          <HistoryList targetIds={[ledgerId]} />
        </div>
      )}

      {openId && (
        <RecordModal
          ids={(shown.some((r) => r.id === openId) ? shown : records).map((r) => r.id)}
          id={openId}
          number={numberOf.get(openId) ?? 0}
          onChange={setOpenId}
          onClose={() => setOpenId(null)}
        />
      )}
      {reporting && <ReportDialog customer={customer} ledger={ledger} records={records} onClose={() => setReporting(false)} />}
    </div>
  );
}

function CardThumb({ r }: { r: WorkRecord }) {
  const { url } = useImageUrl(`${r.id}:thumb`, r.thumbPath, { persist: { recordId: r.id, kind: 'thumb' } });
  return <span className="admin-card-thumb">{url && <img src={url} alt="" />}</span>;
}

const MODE_LABEL = { with_board: '黒板ありのみ', without_board: '黒板なしのみ', both: '黒板あり＋なし（両方）' } as const;

/** P04 作業記録の詳細（PCでは閲覧のみ。編集はスマホで行う） */
function RecordModal({ ids, id, number, onChange, onClose }: { ids: string[]; id: string; number: number; onChange: (id: string) => void; onClose: () => void }) {
  const r = useLiveQuery(() => db.records.get(id), [id]);
  const extras = useLiveQuery(() => db.extras.where('recordId').equals(id).filter((x) => !x.deletedAt).sortBy('createdAt'), [id]);
  const [showOriginal, setShowOriginal] = useState(false);
  const [extra, setExtra] = useState<ExtraPhoto | null>(null);
  const [downloading, setDownloading] = useState(false);
  const useOriginal = showOriginal || r?.mode === 'without_board';
  const image = useImageUrl(r ? `${id}:${useOriginal ? 'original' : 'composite'}` : null, useOriginal ? r?.originalPath : r?.compositePath);
  const thumb = useImageUrl(r ? `${id}:thumb` : null, r?.thumbPath);
  const extraImg = useImageUrl(extra ? `${extra.id}:extra` : null, extra?.path);
  const index = ids.indexOf(id);
  if (!r) return null;
  const url = extra ? extraImg.url : (image.url ?? thumb.url);

  // 表示中の写真を1枚ダウンロードする（要件8.1）。ファイル名はZIPと同じ {撮影日}_{連番}.jpg
  const download = async () => {
    setDownloading(true);
    try {
      const base = `${formatShotDate(r).replaceAll('/', '')}_${String(number).padStart(3, '0')}`;
      let blob: Blob | null;
      let name: string;
      if (extra) {
        const k = (extras ?? []).findIndex((x) => x.id === extra.id) + 1;
        blob = await loadImageBlob(`${extra.id}:extra`, extra.path);
        name = `${base}_追加${k}.jpg`;
      } else if (r.mode === 'both' && showOriginal) {
        blob = await loadImageBlob(`${r.id}:original`, r.originalPath);
        name = `${base}_黒板なし.jpg`;
      } else {
        blob = await reportImageBlob(r, r.mode !== 'without_board');
        name = `${base}.jpg`;
      }
      if (!blob) throw new Error('写真がサーバーにまだありません');
      saveBlob(blob, name);
    } catch (e) {
      alert(`写真をダウンロードできませんでした：${(e as Error).message}`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="admin-modal-backdrop" onClick={onClose}>
      <div className="admin-modal" role="dialog" aria-modal="true" aria-label="作業記録" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-image">
          {url ? <img src={url} alt="作業記録の写真" /> : <span className="hint">写真を読み込んでいます…</span>}
          <div className="admin-modal-imagebar">
            {extra ? (
              <button className="btn" onClick={() => setExtra(null)}>
                メイン写真に戻る
              </button>
            ) : r.mode === 'both' ? (
              <div className="segmented inline">
                <button className={!showOriginal ? 'on' : ''} onClick={() => setShowOriginal(false)}>黒板あり</button>
                <button className={showOriginal ? 'on' : ''} onClick={() => setShowOriginal(true)}>黒板なし</button>
              </div>
            ) : null}
            <button className="btn" onClick={download} disabled={downloading}>
              <Icon name="download" size={16} />
              {downloading ? '準備しています…' : 'この写真をダウンロード'}
            </button>
          </div>
        </div>
        <div className="admin-modal-side">
          <div className="admin-modal-head">
            <span>
              {index + 1} / {ids.length}
            </span>
            <div>
              <button className="icon-btn" disabled={index <= 0} onClick={() => onChange(ids[index - 1])} aria-label="前の記録">
                <Icon name="back" />
              </button>
              <button className="icon-btn" disabled={index >= ids.length - 1} onClick={() => onChange(ids[index + 1])} aria-label="次の記録">
                <span className="flip">
                  <Icon name="back" />
                </span>
              </button>
              <button className="icon-btn" onClick={onClose} aria-label="閉じる">
                <Icon name="close" />
              </button>
            </div>
          </div>
          <Marks r={r} />
          <dl className="detail-list">
            {r.board?.map((it, i) => (
              <div key={i}>
                <dt>{it.label || BOARD_SLOTS[i].defaultLabel}</dt>
                <dd>{(i === SLOT_DATE ? formatBoardDate(it.value) : it.value) || '—'}</dd>
              </div>
            ))}
            <div>
              <dt>撮影日時</dt>
              <dd>{new Date(r.shotAt).toLocaleString('ja-JP')}</dd>
            </div>
            <div>
              <dt>保存方法</dt>
              <dd>{MODE_LABEL[r.mode]}</dd>
            </div>
            <div>
              <dt>位置情報</dt>
              <dd>{r.latitude != null && r.longitude != null ? <LocationValue latitude={r.latitude} longitude={r.longitude} accuracy={r.locationAccuracy} /> : 'なし'}</dd>
            </div>
            {r.memo && (
              <div>
                <dt>メモ</dt>
                <dd>{r.memo}</dd>
              </div>
            )}
            {r.handover && (
              <div>
                <dt>引継ぎ事項</dt>
                <dd>
                  {r.handover}
                  <br />
                  <small className="hint">{r.handoverInReport ? 'レポートに載せる' : 'レポートには載せない'}</small>
                </dd>
              </div>
            )}
          </dl>
          {extras && extras.length > 0 && (
            <div className="admin-extras">
              <h3>追加写真（{extras.length}）</h3>
              <ul>
                {extras.map((x) => (
                  <li key={x.id}>
                    <ExtraThumbButton x={x} active={extra?.id === x.id} onClick={() => setExtra(x)} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          <details className="admin-record-history">
            <summary>変更履歴</summary>
            <HistoryList key={r.id} targetIds={[r.id]} />
          </details>
          <p className="hint">記録の修正はスマホのアプリで行います（変更履歴から以前の内容に戻すことはここでもできます）</p>
        </div>
      </div>
    </div>
  );
}

function ExtraThumbButton({ x, active, onClick }: { x: ExtraPhoto; active: boolean; onClick: () => void }) {
  const { url } = useImageUrl(`${x.id}:extra_thumb`, x.thumbPath, { persist: { recordId: x.recordId, kind: 'extra_thumb' } });
  return (
    <button className={`admin-extra-thumb ${active ? 'on' : ''}`} onClick={onClick} aria-label="追加写真を表示">
      {url && <img src={url} alt="" />}
    </button>
  );
}

function MergedNotice({ ledgerName, targetId, onBack }: { ledgerName: string; targetId: string; onBack: () => void }) {
  const target = useLiveQuery(() => db.ledgers.get(targetId), [targetId]);
  return (
    <div className="admin-page">
      <button className="text-btn back-link" onClick={onBack}>
        <Icon name="back" size={16} />
        台帳一覧
      </button>
      <p className="merged-banner">台帳「{ledgerName}」は「{target?.name ?? ''}」に統合されました。作業記録は統合先の台帳にあります</p>
    </div>
  );
}
