import { useLiveQuery } from 'dexie-react-hooks';
import { useUnsentRecordIds } from '../sync/hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { diag } from '../lib/diag';
import { SLOT_PLACE, SLOT_WORK, SLOT_WORKER } from '../blackboard/model';
import { NotificationBell } from '../components/NotificationBell';
import { Icon } from '../components/Icon';
import { SyncBar } from '../components/SyncBar';
import { useImageUrl } from '../sync/images';
import { db } from '../db';
import { prefs } from '../lib/prefs';
import { Marks, formatShotDate } from '../components/RecordMarks';
import type { Ledger } from '../types';

interface Props {
  ledger: Ledger;
  customerName: string;
  onBack: () => void;
  onEditLedger: () => void;
  onShoot: () => void;
  /** 端末の写真を選んだとき（S12） */
  onImport: (files: File[]) => void;
  /** ids は一覧の並び順。詳細画面で前後の記録に移動するのに使う */
  onOpen: (id: string, ids: string[]) => void;
  onNotifications: () => void;
}

export function RecordList({ ledger, customerName, onBack, onEditLedger, onShoot, onImport, onOpen, onNotifications }: Props) {
  useEffect(() => diag('screen:records'), []);
  const fileInput = useRef<HTMLInputElement>(null);
  const [view, setView] = useState(prefs.getListView());
  const [order, setOrder] = useState(prefs.getListOrder());
  const records = useLiveQuery(() => db.records.where('ledgerId').equals(ledger.id).filter((r) => !r.deletedAt).toArray(), [ledger.id]);

  const sorted = useMemo(
    () => [...(records ?? [])].sort((a, b) => (order === 'desc' ? b.shotAt.localeCompare(a.shotAt) : a.shotAt.localeCompare(b.shotAt))),
    [records, order],
  );
  const unsentIds = useUnsentRecordIds();
  const pending = sorted.filter((r) => unsentIds.has(r.id)).length;

  return (
    <div className="screen">
      <header className="appbar appbar-sub">
        <button className="icon-btn" onClick={onBack} aria-label="戻る">
          <Icon name="back" />
        </button>
        <div className="appbar-title">
          <small>{customerName}</small>
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
          <NotificationBell onClick={onNotifications} />
          <button className="icon-btn" aria-label="台帳情報" onClick={onEditLedger}>
            <Icon name="info" />
          </button>
        </div>
      </header>
      <SyncBar />

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
                  <Thumb id={r.id} path={r.thumbPath} />
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
                  <Thumb id={r.id} path={r.thumbPath} />
                  <span className="grid-date">{formatShotDate(r)}</span>
                  {unsentIds.has(r.id) && <span className="grid-dot" aria-label="未送信" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>

      <footer className="bottombar">
        <button className="btn shoot-btn import-btn" onClick={() => fileInput.current?.click()}>
          <Icon name="image" />
          写真から登録
        </button>
        <button className="btn btn-primary shoot-btn" onClick={onShoot}>
          <Icon name="camera" />
          撮影
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length) onImport(files);
          }}
        />
      </footer>
    </div>
  );
}

function Thumb({ id, path }: { id: string; path?: string | null }) {
  const { url } = useImageUrl(`${id}:thumb`, path, { persist: { recordId: id, kind: 'thumb' } });
  return <div className="thumb">{url && <img src={url} alt="" />}</div>;
}
