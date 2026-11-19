import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState, type ChangeEvent } from 'react';
import { Icon } from '../components/Icon';
import { SyncBar } from '../components/SyncBar';
import { db } from '../db';
import { deleteCustomer, deleteLedger, formatTerm, normalizeForSearch, renameCustomer } from '../lib/repo';
import { getProvider } from '../sync/config';
import { resetSyncState } from '../sync/engine';
import { useMyProfile, useOnline, useUnreadCount } from '../sync/hooks';
import type { AuthSession } from '../sync/provider';
import { UserAdmin } from '../screens/Settings';
import { DeletedPane, ProvisionalPane } from './AdminPanes';
import { DuplicatesPane, LogPane, NotificationsPane } from './Step4Panes';
import { StoragePane } from './StoragePane';
import { findDuplicatePairs } from '../lib/duplicates';
import type { AppNotification } from '../types';
import { LedgerDetail } from './LedgerDetail';
import { EMPTY_FILTER, hasAnyFilter, hasRecordFilter, ledgerTermMatches, recordMatches, type AdminFilter } from './filters';
import type { WorkRecord } from '../types';

type View = 'ledgers' | 'notifications' | 'duplicates' | 'provisional' | 'deleted' | 'logs' | 'storage' | 'users';

/** PC管理画面（#admin。要件8） */
export function AdminApp({ session }: { session: AuthSession }) {
  const me = useMyProfile();
  const isAdmin = me?.role === 'admin' && !me.disabled;
  const online = useOnline();
  const [view, setView] = useState<View>('ledgers');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [ledgerId, setLedgerId] = useState<string | null>(null);
  const provisionalCount = useLiveQuery(() => db.customers.filter((c) => c.isProvisional && !c.deletedAt).count(), []);
  const unread = useUnreadCount();
  const duplicateCount = useLiveQuery(async () => findDuplicatePairs(await db.ledgers.toArray(), await db.dismissals.toArray()).length, []);
  const [recordId, setRecordId] = useState<string | null>(null);
  const [pair, setPair] = useState<[string, string] | null>(null);
  // 絞り込み条件は台帳を開いて戻っても残す
  const [filter, setFilter] = useState<AdminFilter>(EMPTY_FILTER);

  // 通知から該当する画面を開く
  const openNotification = async (n: AppNotification) => {
    if (n.type === 'duplicate_candidate') {
      setPair([String(n.payload.ledger_a), String(n.payload.ledger_b)]);
      setView('duplicates');
      return;
    }
    if (n.type === 'provisional_customer') {
      setView('provisional');
      return;
    }
    let ledger = String(n.payload.ledger_id ?? '');
    let rec: string | null = null;
    if (n.payload.table === 'records') {
      const r = await db.records.get(String(n.payload.target_id));
      if (r) ledger = r.ledgerId;
      rec = r ? r.id : null;
    }
    const l = await db.ledgers.get(ledger);
    if (!l || l.deletedAt) {
      alert('対象の台帳は削除されています');
      return;
    }
    setCustomerId(l.customerId);
    setLedgerId(l.mergedInto ?? l.id);
    setRecordId(rec);
    setView('ledgers');
  };

  const nav: { id: View; label: string; icon: Parameters<typeof Icon>[0]['name']; admin?: boolean; badge?: number }[] = [
    { id: 'ledgers', label: '顧客・台帳', icon: 'list' },
    { id: 'notifications', label: '通知', icon: 'bell', badge: unread || undefined },
    { id: 'duplicates', label: '重複候補・統合', icon: 'merge', admin: true, badge: duplicateCount || undefined },
    { id: 'provisional', label: '仮顧客の処理', icon: 'info', admin: true, badge: provisionalCount || undefined },
    { id: 'deleted', label: '削除済みデータ', icon: 'trash', admin: true },
    { id: 'logs', label: '操作ログ', icon: 'log', admin: true },
    { id: 'storage', label: '保存容量', icon: 'image', admin: true },
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
                  if (n.id === 'duplicates') setPair(null);
                  setRecordId(null);
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
            <LedgerDetail
              key={`${ledgerId}:${recordId ?? ''}`}
              ledgerId={ledgerId}
              isAdmin={isAdmin}
              initialRecordId={recordId}
              filter={filter}
              onBack={() => setLedgerId(null)}
            />
          ) : (
            <CustomersLedgers
              isAdmin={isAdmin}
              customerId={customerId}
              onSelectCustomer={setCustomerId}
              onOpenLedger={setLedgerId}
              filter={filter}
              onFilterChange={setFilter}
            />
          ))}
        {view === 'notifications' && <NotificationsPane onOpen={openNotification} />}
        {view === 'duplicates' && isAdmin && <DuplicatesPane key={pair?.join(':') ?? 'list'} initialPair={pair} />}
        {view === 'logs' && isAdmin && <LogPane />}
        {view === 'storage' && isAdmin && <StoragePane />}
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
  filter: AdminFilter;
  onFilterChange: (f: AdminFilter) => void;
}

/** P02 顧客・台帳一覧 */
function CustomersLedgers({ isAdmin, customerId, onSelectCustomer, onOpenLedger, filter, onFilterChange }: CLProps) {
  const [q, setQ] = useState('');
  const [lq, setLq] = useState('');
  const customers = useLiveQuery(() => db.customers.filter((c) => !c.deletedAt).toArray(), []);
  const ledgers = useLiveQuery(() => db.ledgers.filter((l) => !l.deletedAt && !l.mergedInto).toArray(), []);
  const records = useLiveQuery(() => db.records.filter((r) => !r.deletedAt).toArray(), []);
  const dismissals = useLiveQuery(() => db.dismissals.toArray(), []);
  // 重複候補になっている台帳（要件6.2・画面P02のバッジ）
  const duplicateIds = useMemo(() => new Set(findDuplicatePairs(ledgers ?? [], dismissals ?? []).flat().map((l) => l.id)), [ledgers, dismissals]);

  const filtering = hasAnyFilter(filter);
  const [filterOpen, setFilterOpen] = useState(filtering);
  // 絞り込み条件（工期・撮影日・施工者・キーワード）に合う台帳と、その中で条件に合う記録の件数（要件8.1）
  const matched = useMemo(() => {
    const byLedger = new Map<string, WorkRecord[]>();
    for (const r of records ?? []) byLedger.set(r.ledgerId, [...(byLedger.get(r.ledgerId) ?? []), r]);
    const m = new Map<string, number>();
    if (!filtering) return m;
    for (const l of ledgers ?? []) {
      if (!ledgerTermMatches(l, filter)) continue;
      const recs = byLedger.get(l.id) ?? [];
      // キーワードが台帳の工事名称・責任者・備考に含まれる場合は、記録はキーワード以外の条件だけで見る
      const kw = normalizeForSearch(filter.keyword);
      const ledgerHit = !!kw && [l.name, l.manager, l.note].some((s) => normalizeForSearch(s).includes(kw));
      const f = ledgerHit ? { ...filter, keyword: '' } : filter;
      const n = recs.filter((r) => recordMatches(r, f)).length;
      if (hasRecordFilter(f) && n === 0) continue;
      m.set(l.id, hasRecordFilter(f) ? n : recs.length);
    }
    return m;
  }, [ledgers, records, filter, filtering]);

  const ledgerCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of ledgers ?? []) if (!filtering || matched.has(l.id)) m.set(l.customerId, (m.get(l.customerId) ?? 0) + 1);
    return m;
  }, [ledgers, filtering, matched]);
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
      .filter((c) => !filtering || ledgerCount.has(c.id))
      .sort((a, b) => (a.code ?? 'zzz').localeCompare(b.code ?? 'zzz') || a.name.localeCompare(b.name, 'ja'));
  }, [customers, q, filtering, ledgerCount]);

  const selected = list.find((c) => c.id === customerId) ?? list[0] ?? null;
  const myLedgers = useMemo(() => {
    const nq = normalizeForSearch(lq);
    return (ledgers ?? [])
      .filter((l) => selected && l.customerId === selected.id)
      .filter((l) => !nq || [l.name, l.manager, l.note].some((s) => normalizeForSearch(s).includes(nq)))
      .filter((l) => !filtering || matched.has(l.id))
      .sort((a, b) => (b.startDate || b.updatedAt).localeCompare(a.startDate || a.updatedAt));
  }, [ledgers, selected, lq, filtering, matched]);

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
            <FilterPanel filter={filter} onChange={onFilterChange} open={filterOpen} onOpenChange={setFilterOpen} />
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
                      <td className="strong">
                        {l.name}
                        {duplicateIds.has(l.id) && <span className="badge badge-warn dup-badge">重複候補</span>}
                      </td>
                      <td>{formatTerm(l)}</td>
                      <td>{l.manager || '—'}</td>
                      <td className="num">
                        {filtering && hasRecordFilter(filter) ? `${matched.get(l.id) ?? 0} / ${c?.total ?? 0}` : (c?.total ?? 0)}
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
            {myLedgers.length === 0 && <p className="empty">{filtering ? '条件に合う台帳がありません' : '台帳がありません（台帳の作成はスマホで行います）'}</p>}
          </>
        ) : filtering ? (
          <>
            <FilterPanel filter={filter} onChange={onFilterChange} open={filterOpen} onOpenChange={setFilterOpen} />
            <p className="empty">条件に合う台帳がありません</p>
          </>
        ) : (
          <p className="empty">顧客を選んでください</p>
        )}
      </section>
    </div>
  );
}

/** 絞り込み（工期・撮影日・施工者・キーワード。要件8.1）。条件に合う台帳だけを顧客をまたいで表示する */
function FilterPanel({ filter, onChange, open, onOpenChange }: { filter: AdminFilter; onChange: (f: AdminFilter) => void; open: boolean; onOpenChange: (open: boolean) => void }) {
  const active = hasAnyFilter(filter);
  const set = (k: keyof AdminFilter) => (e: ChangeEvent<HTMLInputElement>) => onChange({ ...filter, [k]: e.target.value });
  return (
    <details className="admin-filter" open={open} onToggle={(e) => onOpenChange(e.currentTarget.open)}>
      <summary>
        絞り込み{active && <span className="badge badge-pending">条件あり</span>}
      </summary>
      <div className="admin-filter-grid">
        <label>
          <span>工期</span>
          <span className="range">
            <input type="date" aria-label="工期（から）" value={filter.termFrom} onChange={set('termFrom')} />〜
            <input type="date" aria-label="工期（まで）" value={filter.termTo} onChange={set('termTo')} />
          </span>
        </label>
        <label>
          <span>撮影日</span>
          <span className="range">
            <input type="date" aria-label="撮影日（から）" value={filter.shotFrom} onChange={set('shotFrom')} />〜
            <input type="date" aria-label="撮影日（まで）" value={filter.shotTo} onChange={set('shotTo')} />
          </span>
        </label>
        <label>
          <span>施工者</span>
          <input type="search" placeholder="施工者名" value={filter.worker} onChange={set('worker')} />
        </label>
        <label>
          <span>キーワード</span>
          <input type="search" placeholder="黒板・メモ・引継ぎ事項・台帳の内容" value={filter.keyword} onChange={set('keyword')} />
        </label>
      </div>
      <p className="hint">
        工期は期間が重なる台帳、撮影日・施工者・キーワードは条件に合う記録がある台帳を、すべての顧客から探します。記録の列は「条件に合う記録 / 全体」です
        {active && (
          <button className="text-btn" onClick={() => onChange(EMPTY_FILTER)}>
            条件をクリア
          </button>
        )}
      </p>
    </details>
  );
}
