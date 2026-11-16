import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useBlobUrl } from '../components/useBlobUrl';
import { db } from '../db';
import { prefs } from '../lib/prefs';
import { Marks, formatShotDate } from '../components/RecordMarks';
import type { Ledger } from '../types';

interface Props {
  ledger: Ledger;
  onShoot: () => void;
  onOpen: (id: string) => void;
  onSettings: () => void;
}

export function RecordList({ ledger, onShoot, onOpen, onSettings }: Props) {
  const [view, setView] = useState(prefs.getListView());
  const [order, setOrder] = useState<'desc' | 'asc'>('desc');
  const records = useLiveQuery(() => db.records.where('ledgerId').equals(ledger.id).filter((r) => !r.deletedAt).toArray(), [ledger.id]);

  const sorted = useMemo(
    () => [...(records ?? [])].sort((a, b) => (order === 'desc' ? b.shotAt.localeCompare(a.shotAt) : a.shotAt.localeCompare(b.shotAt))),
    [records, order],
  );
  const pending = sorted.filter((r) => r.syncStatus !== 'synced').length;

  return (
    <div className="screen">
      <header className="appbar">
        <span />
        <h1 title={ledger.name}>{ledger.name}</h1>
        <div className="appbar-actions">
          <button
            className="text-btn"
            onClick={() => {
              const v = view === 'list' ? 'grid' : 'list';
              setView(v);
              prefs.setListView(v);
            }}
          >
            {view === 'list' ? 'グリッド' : 'リスト'}
          </button>
          <button className="text-btn" onClick={onSettings}>設定</button>
        </div>
      </header>

      <div className="statusbar">
        <span>
          {ledger.customerName} / {sorted.length}件
          {pending > 0 && <span className="badge badge-pending">未送信 {pending}</span>}
        </span>
        <button className="text-btn small" onClick={() => setOrder(order === 'desc' ? 'asc' : 'desc')}>
          {order === 'desc' ? '新しい順' : '古い順'}
        </button>
      </div>

      <main className="screen-body list-body">
        {records && sorted.length === 0 && <p className="empty">まだ記録がありません。下の撮影ボタンから撮影してください</p>}
        {view === 'list' ? (
          <ul className="rec-list">
            {sorted.map((r) => (
              <li key={r.id}>
                <button className="rec-item" onClick={() => onOpen(r.id)}>
                  <Thumb id={r.id} />
                  <div className="rec-text">
                    <div className="rec-line1">
                      <span>{formatShotDate(r)}</span>
                      <span className="rec-place">{r.board?.[1]?.value || '（作業場所なし）'}</span>
                    </div>
                    <div className="rec-line2">
                      {r.board?.[2]?.value || (r.mode === 'without_board' ? '黒板なし' : '')}
                      {r.board?.[7]?.value ? ` / ${r.board[7].value}` : ''}
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
                <button className="grid-item" onClick={() => onOpen(r.id)}>
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
        <button className="btn btn-primary btn-wide shoot-btn" onClick={onShoot}>撮影</button>
      </footer>
    </div>
  );
}

function Thumb({ id }: { id: string }) {
  const img = useLiveQuery(() => db.images.get(`${id}:thumb`), [id]);
  const url = useBlobUrl(img?.blob);
  return <div className="thumb">{url && <img src={url} alt="" />}</div>;
}
