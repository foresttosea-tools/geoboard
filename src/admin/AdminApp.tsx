import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { SyncBar } from '../components/SyncBar';
import { db } from '../db';
import { deleteCustomer, deleteLedger, formatTerm, normalizeForSearch, renameCustomer } from '../lib/repo';
import { getProvider } from '../sync/config';
import { resetSyncState } from '../sync/engine';
import { useMyProfile, useOnline } from '../sync/hooks';
import type { AuthSession } from '../sync/provider';
import { UserAdmin } from '../screens/Settings';
import { DeletedPane, ProvisionalPane } from './AdminPanes';
import { LedgerDetail } from './LedgerDetail';

type View = 'ledgers' | 'provisional' | 'deleted' | 'users';

/** PC管理画面（#admin。要件8） */
export function AdminApp({ session }: { session: AuthSession }) {
  const me = useMyProfile();
  const isAdmin = me?.role === 'admin' && !me.disabled;
  const online = useOnline();
  const [view, setView] = useState<View>('ledgers');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [ledgerId, setLedgerId] = useState<string | null>(null);
  const provisionalCount = useLiveQuery(() => db.customers.filter((c) => c.isProvisional && !c.deletedAt).count(), []);

  const nav: { id: View; label: string; icon: Parameters<typeof Icon>[0]['name']; admin?: boolean; badge?: number }[] = [
    { id: 'ledgers', label: '顧客・台帳', icon: 'list' },
    { id: 'provisional', label: '仮顧客の処理', icon: 'info', admin: true, badge: provisionalCount || undefined },
    { id: 'deleted', label: '削除済みデータ', icon: 'trash', admin: true },
    { id: 'users', label: 'ユーザー管理', icon: 'settings', admin: true },
  ];

  return (
    <div className="admin">
      <aside className="admin-nav">
        <div className="admin-brand">
          <img src={`${import.meta.env.BASE_URL}brand/logo-mark.png`} alt="" />
          <div>
            <strong>GeoBoard</strong>
            <span>管理画面</span>
          </div>
        </div>
        <nav>
          {nav
            .filter((n) => !n.admin || isAdmin)
            .map((n) => (
              <button
                key={n.id}
                className={view === n.id ? 'on' : ''}
                onClick={() => {
                  setView(n.id);
                  if (n.id === 'ledgers') setLedgerId(null);
                }}
              >
                <Icon name={n.icon} size={18} />
                {n.label}
                {n.badge ? <span className="admin-badge">{n.badge}</span> : null}
              </button>
            ))}
        </nav>
        <div className="admin-account">
          <span>{me?.displayName || session.email}</span>
          <small>
            {isAdmin ? '管理者' : '一般'}・{online ? 'オンライン' : 'オフライン'}
          </small>
          <a href="#" onClick={() => (location.hash = '')}>
            スマホ用の画面へ
          </a>
          <button
            className="text-btn"
            onClick={async () => {
              await getProvider().signOut();
              resetSyncState();
            }}
          >
            ログアウト
          </button>
        </div>
      </aside>

      <main className="admin-main">
        <SyncBar />
        {view === 'ledgers' &&
          (ledgerId ? (
            <LedgerDetail ledgerId={ledgerId} isAdmin={isAdmin} onBack={() => setLedgerId(null)} />
          ) : (
            <CustomersLedgers
              isAdmin={isAdmin}
              customerId={customerId}
              onSelectCustomer={setCustomerId}
              onOpenLedger={setLedgerId}
            />
          ))}
        {view === 'provisional' && isAdmin && <ProvisionalPane />}
        {view === 'deleted' && isAdmin && <DeletedPane />}
        {view === 'users' && isAdmin && (
          <div className="admin-page narrow">
            <h1>ユーザー管理</h1>
            <UserAdmin myId={session.userId} online={online} />
          </div>
        )}
      </main>
    </div>
  );
}

interface CLProps {
  isAdmin: boolean;
  customerId: string | null;
  onSelectCustomer: (id: string) => void;
  onOpenLedger: (id: string) => void;
}

/** P02 顧客・台帳一覧 */
function CustomersLedgers({ isAdmin, customerId, onSelectCustomer, onOpenLedger }: CLProps) {
  const [q, setQ] = useState('');
  const [lq, setLq] = useState('');
  const customers = useLiveQuery(() => db.customers.filter((c) => !c.deletedAt).toArray(), []);
  const ledgers = useLiveQuery(() => db.ledgers.filter((l) => !l.deletedAt).toArray(), []);
  const records = useLiveQuery(() => db.records.filter((r) => !r.deletedAt).toArray(), []);

  const ledgerCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of ledgers ?? []) m.set(l.customerId, (m.get(l.customerId) ?? 0) + 1);
    return m;
  }, [ledgers]);
  const recordCount = useMemo(() => {
    const m = new Map<string, { total: number; pending: number; latest: string }>();
    for (const r of records ?? []) {
      const c = m.get(r.ledgerId) ?? { total: 0, pending: 0, latest: '' };
      c.total++;
      if (r.syncStatus !== 'synced') c.pending++;
      if (r.shotAt > c.latest) c.latest = r.shotAt;
      m.set(r.ledgerId, c);
    }
    return m;
  }, [records]);

  const list = useMemo(() => {
    const nq = normalizeForSearch(q);
    return (customers ?? [])
      .filter((c) => !nq || normalizeForSearch(c.name).includes(nq) || (c.code ?? '').toLowerCase().includes(nq))
      .sort((a, b) => (a.code ?? 'zzz').localeCompare(b.code ?? 'zzz') || a.name.localeCompare(b.name, 'ja'));
  }, [customers, q]);

  const selected = (customers ?? []).find((c) => c.id === customerId) ?? list[0] ?? null;
  const myLedgers = useMemo(() => {
    const nq = normalizeForSearch(lq);
    return (ledgers ?? [])
      .filter((l) => selected && l.customerId === selected.id)
      .filter((l) => !nq || [l.name, l.manager, l.note].some((s) => normalizeForSearch(s).includes(nq)))
      .sort((a, b) => (b.startDate || b.updatedAt).localeCompare(a.startDate || a.updatedAt));
  }, [ledgers, selected, lq]);

  return (
    <div className="admin-split">
      <section className="admin-col customers">
        <h1>顧客</h1>
        <input className="search" type="search" placeholder="顧客名・コードで検索" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="admin-list">
          {list.map((c) => (
            <li key={c.id}>
              <button className={selected?.id === c.id ? 'on' : ''} onClick={() => onSelectCustomer(c.id)}>
                <span className="admin-list-main">
                  {c.isProvisional && <span className="badge badge-warn">仮</span>}
                  {c.name}
                </span>
                <span className="admin-list-sub">
                  {c.code ?? (c.isProvisional ? '仮顧客' : 'コード未採番')}・台帳 {ledgerCount.get(c.id) ?? 0}件
                </span>
              </button>
            </li>
          ))}
          {customers && list.length === 0 && <li className="empty">顧客がありません</li>}
        </ul>
      </section>

      <section className="admin-col ledgers">
        {selected ? (
          <>
            <div className="admin-head">
              <div>
                <h1>{selected.name}</h1>
                <span className="admin-sub">{selected.code ?? (selected.isProvisional ? '仮顧客' : 'コード未採番')}</span>
              </div>
              {isAdmin && (
                <div className="admin-actions">
                  <button
                    className="btn"
                    onClick={async () => {
                      const name = prompt('顧客名', selected.name);
                      if (name && name.trim()) await renameCustomer(selected.id, name);
                    }}
                  >
                    <Icon name="edit" size={16} />
                    名前を変更
                  </button>
                  <button
                    className="btn btn-danger"
                    onClick={async () => {
                      const n = ledgerCount.get(selected.id) ?? 0;
                      if (confirm(`顧客「${selected.name}」を削除しますか？${n ? `\n台帳${n}件も一覧に表示されなくなります。` : ''}\n削除済みデータから元に戻せます。`)) await deleteCustomer(selected.id);
                    }}
                  >
                    <Icon name="trash" size={16} />
                    削除
                  </button>
                </div>
              )}
            </div>
            <input className="search" type="search" placeholder="工事名称・責任者で検索" value={lq} onChange={(e) => setLq(e.target.value)} />
            <table className="admin-table">
              <thead>
                <tr>
                  <th>工事名称</th>
                  <th>工期</th>
                  <th>工事責任者</th>
                  <th className="num">記録</th>
                  <th>最新の撮影</th>
                  {isAdmin && <th />}
                </tr>
              </thead>
              <tbody>
                {myLedgers.map((l) => {
                  const c = recordCount.get(l.id);
                  return (
                    <tr key={l.id} onClick={() => onOpenLedger(l.id)} className="clickable">
                      <td className="strong">{l.name}</td>
                      <td>{formatTerm(l)}</td>
                      <td>{l.manager || '—'}</td>
                      <td className="num">
                        {c?.total ?? 0}
                        {c?.pending ? <span className="badge badge-pending">未送信 {c.pending}</span> : null}
                      </td>
                      <td>{c?.latest ? new Date(c.latest).toLocaleDateString('ja-JP') : '—'}</td>
                      {isAdmin && (
                        <td className="row-actions-cell">
                          <button
                            className="icon-btn danger"
                            aria-label={`${l.name}を削除`}
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (confirm(`台帳「${l.name}」を削除しますか？\n削除済みデータから元に戻せます。`)) await deleteLedger(l.id);
                            }}
                          >
                            <Icon name="trash" size={16} />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {myLedgers.length === 0 && <p className="empty">台帳がありません（台帳の作成はスマホで行います）</p>}
          </>
        ) : (
          <p className="empty">顧客を選んでください</p>
        )}
      </section>
    </div>
  );
}
