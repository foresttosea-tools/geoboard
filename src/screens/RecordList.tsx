import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { SLOT_PLACE, SLOT_WORK, SLOT_WORKER } from '../blackboard/model';
import { Icon } from '../components/Icon';
import { useBlobUrl } from '../components/useBlobUrl';
import { db } from '../db';
import { prefs } from '../lib/prefs';
import { Marks, formatShotDate } from '../components/RecordMarks';
import type { Ledger } from '../types';

interface Props {
  ledger: Ledger;
  onShoot: () => void;
  /** ids は一覧の並び順。詳細画面で前後の記録に移動するのに使う */
  onOpen: (id: string, ids: string[]) => void;
  onSettings: () => void;
}

export function RecordList({ ledger, onShoot, onOpen, onSettings }: Props) {
  const [view, setView] = useState(prefs.getListView());
  const [order, setOrder] = useState(prefs.getListOrder());
  const records = useLiveQuery(() => db.records.where('ledgerId').equals(ledger.id).filter((r) => !r.deletedAt).toArray(), [ledger.id]);

  const sorted = useMemo(
    () => [...(records ?? [])].sort((a, b) => (order === 'desc' ? b.shotAt.localeCompare(a.shotAt) : a.shotAt.localeCompare(b.shotAt))),
    [records, order],
  );
  const pending = sorted.filter((r) => r.syncStatus !== 'synced').length;

  return (
    <div className="screen">
      <header className="appbar appbar-home">
        <img src={`${import.meta.env.BASE_URL}brand/logo-mark.png`} alt="" className="brand-mark" />
        <div className="appbar-title">
          <small>{ledger.customerName}</small>
          <h1 title={ledger.name}>{ledger.name}</h1>
        </div>
        <div className="appbar-actions">
          <button
            className="icon-btn"
            aria-label={view === 'list' ? 'グリッド表示' : 'リスト表示'}
            onClick={() => {
              const v = view === 'list' ? 'grid' : 'list';
              setView(v);
              prefs.setListView(v);
            }}
          >
            <Icon name={view === 'list' ? 'grid' : 'list'} />
          </button>
          <button className="icon-btn" aria-label="設定" onClick={onSettings}>
            <Icon name="settings" />
          </button>
        </div>
      </header>

      <div className="statusbar">
        <span className="status-count">
          {sorted.length}件の記録
          {pending > 0 && <span className="badge badge-pending">未送信 {pending}</span>}
        </span>
        <button className="chip" onClick={() => {
            const o = order === 'desc' ? 'asc' : 'desc';
            setOrder(o);
            prefs.setListOrder(o);
          }}>
          <Icon name="sort" size={14} />
          {order === 'desc' ? '新しい順' : '古い順'}
        </button>
      </div>

      <main className="screen-body list-body">
        {records && sorted.length === 0 && <p className="empty">まだ記録がありません。下の撮影ボタンから撮影してください</p>}
        {view === 'list' ? (
          <ul className="rec-list">
            {sorted.map((r) => (
              <li key={r.id}>
                <button className="rec-item" onClick={() => onOpen(r.id, sorted.map((x) => x.id))}>
                  <Thumb id={r.id} />
                  <div className="rec-text">
                    <div className="rec-line1">
                      <span>{formatShotDate(r)}</span>
                      <span className="rec-place">{r.board?.[SLOT_PLACE]?.value || '（作業場所なし）'}</span>
                    </div>
                    <div className="rec-line2">
                      {r.board?.[SLOT_WORK]?.value || (r.mode === 'without_board' ? '黒板なし' : '')}
                      {r.board?.[SLOT_WORKER]?.value ? ` / ${r.board[SLOT_WORKER].value}` : ''}
                    </div>
                    <Marks r={r} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="rec-grid">
            {sorted.map((r) => (
              <li key={r.id}>
                <button className="grid-item" onClick={() => onOpen(r.id, sorted.map((x) => x.id))}>
                  <Thumb id={r.id} />
                  <span className="grid-date">{formatShotDate(r)}</span>
                  {r.syncStatus !== 'synced' && <span className="grid-dot" aria-label="未送信" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>

      <footer className="bottombar">
        <button className="btn btn-primary btn-wide shoot-btn" onClick={onShoot}>
          <Icon name="camera" />
          撮影
        </button>
      </footer>
    </div>
  );
}

function Thumb({ id }: { id: string }) {
  const img = useLiveQuery(() => db.images.get(`${id}:thumb`), [id]);
  const url = useBlobUrl(img?.blob);
  return <div className="thumb">{url && <img src={url} alt="" />}</div>;
}
