import { useLiveQuery } from 'dexie-react-hooks';
import { useUnsentRecordIds } from '../sync/hooks';
import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { SyncBar } from '../components/SyncBar';
import { db } from '../db';
import { prefs } from '../lib/prefs';
import { formatTerm, normalizeForSearch } from '../lib/repo';

interface Props {
  customerId: string;
  onBack: () => void;
  onOpen: (ledgerId: string) => void;
  onCreate: () => void;
}

export type LedgerSort = 'updated' | 'start' | 'name';

/** S05 台帳一覧 */
export function LedgerList({ customerId, onBack, onOpen, onCreate }: Props) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<LedgerSort>(prefs.getLedgerSort());
  const customer = useLiveQuery(() => db.customers.get(customerId), [customerId]);
  const ledgers = useLiveQuery(() => db.ledgers.where('customerId').equals(customerId).filter((l) => !l.deletedAt).toArray(), [customerId]);
  const records = useLiveQuery(
    async () => {
      const ids = (ledgers ?? []).map((l) => l.id);
      return ids.length ? db.records.where('ledgerId').anyOf(ids).filter((r) => !r.deletedAt).toArray() : [];
    },
    [ledgers],
  );

  const unsentIds = useUnsentRecordIds();
  const counts = useMemo(() => {
    const m = new Map<string, { total: number; pending: number }>();
    for (const r of records ?? []) {
      const c = m.get(r.ledgerId) ?? { total: 0, pending: 0 };
      c.total++;
      if (unsentIds.has(r.id)) c.pending++;
      m.set(r.ledgerId, c);
    }
    return m;
  }, [records, unsentIds]);

  const list = useMemo(() => {
    const nq = normalizeForSearch(q);
    const filtered = (ledgers ?? []).filter((l) => !nq || [l.name, l.manager, l.note].some((s) => normalizeForSearch(s).includes(nq)));
    return filtered.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, 'ja');
      if (sort === 'start') return (b.startDate || '').localeCompare(a.startDate || '');
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [ledgers, q, sort]);

  return (
    <div className="screen">
      <header className="appbar">
        <button className="icon-btn" onClick={onBack} aria-label="戻る">
          <Icon name="back" />
        </button>
        <h1>{customer?.name ?? ''}</h1>
        <span />
      </header>
      <SyncBar />

      <main className="screen-body">
        <div className="toolbar">
          <input className="search" type="search" placeholder="工事名称・責任者" value={q} onChange={(e) => setQ(e.target.value)} />
          <select
            value={sort}
            onChange={(e) => {
              const v = e.target.value as LedgerSort;
              setSort(v);
              prefs.setLedgerSort(v);
            }}
            aria-label="並び順"
          >
            <option value="updated">最近更新した順</option>
            <option value="start">工期の開始日順</option>
            <option value="name">工事名称順</option>
          </select>
        </div>

        {ledgers && list.length === 0 && (
          <p className="empty">{q ? '一致する台帳がありません' : 'まだ台帳がありません。\n下の「台帳を追加」から作成してください'}</p>
        )}

        <ul className="card-list">
          {list.map((l) => {
            const c = counts.get(l.id);
            return (
              <li key={l.id}>
                <button className="ledger-card" onClick={() => onOpen(l.id)}>
                  <strong>{l.name}</strong>
                  <span className="ledger-term">{formatTerm(l)}</span>
                  <span className="ledger-meta">
                    {l.manager ? `責任者：${l.manager}` : '責任者未設定'}
                    <span className="ledger-count">
                      記録 {c?.total ?? 0}件
                      {c?.pending ? <span className="badge badge-pending">未送信 {c.pending}</span> : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </main>

      <footer className="bottombar">
        <button className="btn btn-primary btn-wide" onClick={onCreate}>
          <Icon name="plus" />
          台帳を追加
        </button>
      </footer>
    </div>
  );
}
