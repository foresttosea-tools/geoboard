import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { HistoryItem } from '../components/HistoryList';
import { NotificationList } from '../components/NotificationList';
import { db } from '../db';
import { findDuplicatePairs } from '../lib/duplicates';
import { ACTION_LABEL, TABLE_LABEL, fetchLogs, targetName } from '../lib/history';
import { formatTerm } from '../lib/repo';
import { getProvider } from '../sync/config';
import { syncNow } from '../sync/engine';
import { useOnline } from '../sync/hooks';
import type { AppNotification, ChangeLog, Ledger } from '../types';

// ---------------------------------------------------------------------------
// P07 重複候補・統合（管理者。要件6.2）
// ---------------------------------------------------------------------------

type FieldKey = 'name' | 'startDate' | 'endDate' | 'manager' | 'note';
const FIELDS: { key: FieldKey; column: string; label: string }[] = [
  { key: 'name', column: 'name', label: '工事名称' },
  { key: 'startDate', column: 'start_date', label: '工事開始日' },
  { key: 'endDate', column: 'end_date', label: '工事終了日' },
  { key: 'manager', column: 'manager', label: '工事責任者' },
  { key: 'note', column: 'note', label: '備考' },
];

function useLedgerStats() {
  const records = useLiveQuery(() => db.records.filter((r) => !r.deletedAt).toArray(), []);
  return useMemo(() => {
    const m = new Map<string, { count: number; latest: string }>();
    for (const r of records ?? []) {
      const s = m.get(r.ledgerId) ?? { count: 0, latest: '' };
      s.count++;
      if (r.shotAt > s.latest) s.latest = r.shotAt;
      m.set(r.ledgerId, s);
    }
    return m;
  }, [records]);
}

export function DuplicatesPane({ initialPair }: { initialPair?: [string, string] | null }) {
  const online = useOnline();
  const ledgers = useLiveQuery(() => db.ledgers.toArray(), []);
  const customers = useLiveQuery(() => db.customers.toArray(), []);
  const dismissals = useLiveQuery(() => db.dismissals.toArray(), []);
  const stats = useLedgerStats();
  const pairs = useMemo(() => findDuplicatePairs(ledgers ?? [], dismissals ?? []), [ledgers, dismissals]);
  const merged = (ledgers ?? []).filter((l) => l.mergedInto && !l.deletedAt);
  const [comparing, setComparing] = useState<[string, string] | null>(initialPair ?? null);
  const [busy, setBusy] = useState(false);
  const customerName = (id: string) => customers?.find((c) => c.id === id)?.name ?? '';
  const ledgerById = (id: string) => ledgers?.find((l) => l.id === id);

  const pair = comparing ? ([ledgerById(comparing[0]), ledgerById(comparing[1])] as const) : null;
  if (pair && pair[0] && pair[1]) {
    return (
      <MergeView
        a={pair[0]}
        b={pair[1]}
        customerName={customerName(pair[0].customerId)}
        stats={stats}
        online={online}
        onClose={() => setComparing(null)}
      />
    );
  }

  return (
    <div className="admin-page narrow">
      <h1>重複候補・統合</h1>
      <p className="hint">同じ顧客の中で工事名称が似ている台帳です。同じ工事なら「比較して統合」、別の工事なら「重複ではない」を選んでください。「重複ではない」にしたペアは、以後候補に出ません</p>
      {!online && <p className="hint danger">統合・「重複ではない」の操作には電波が必要です</p>}
      {ledgers && pairs.length === 0 && <p className="empty">重複候補はありません</p>}
      <ul className="admin-stack">
        {pairs.map(([a, b]) => (
          <li key={`${a.id}:${b.id}`} className="card dup-card">
            <p className="hint">{customerName(a.customerId)}</p>
            <div className="dup-names">
              {[a, b].map((l) => (
                <div key={l.id}>
                  <strong>{l.name}</strong>
                  <small>
                    {formatTerm(l)}・記録 {stats.get(l.id)?.count ?? 0}件
                  </small>
                </div>
              ))}
            </div>
            <div className="dialog-actions row">
              <button
                className="btn"
                disabled={!online || busy}
                onClick={async () => {
                  if (!confirm(`「${a.name}」と「${b.name}」を重複ではないとして、以後候補に出さないようにしますか？`)) return;
                  setBusy(true);
                  try {
                    await getProvider().dismissDuplicate(a.id, b.id);
                    const [x, y] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
                    await db.dismissals.put({ key: `${x}:${y}`, ledgerA: x, ledgerB: y });
                    void syncNow();
                  } catch (e) {
                    alert(`操作できませんでした：${(e as Error).message}`);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                重複ではない
              </button>
              <button className="btn btn-primary" onClick={() => setComparing([a.id, b.id])}>
                比較して統合
              </button>
            </div>
          </li>
        ))}
      </ul>

      {merged.length > 0 && (
        <>
          <h2 className="admin-section">統合済みの台帳（{merged.length}）</h2>
          <p className="hint">統合を取り消すと、統合で移した作業記録を元の台帳に戻し、統合先の台帳情報を統合前の内容に戻します</p>
          <table className="admin-table">
            <tbody>
              {merged.map((l) => (
                <tr key={l.id}>
                  <td className="strong">{l.name}</td>
                  <td>→ {ledgerById(l.mergedInto!)?.name ?? '（不明な台帳）'}</td>
                  <td>{customerName(l.customerId)}</td>
                  <td className="row-actions-cell">
                    <button
                      className="btn"
                      disabled={!online || busy}
                      onClick={async () => {
                        if (!confirm(`「${l.name}」の統合を取り消しますか？`)) return;
                        setBusy(true);
                        try {
                          await getProvider().unmergeLedger(l.id);
                          await syncNow();
                        } catch (e) {
                          alert(`取り消せませんでした：${(e as Error).message}`);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      統合の取り消し
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function MergeView({
  a,
  b,
  customerName,
  stats,
  online,
  onClose,
}: {
  a: Ledger;
  b: Ledger;
  customerName: string;
  stats: Map<string, { count: number; latest: string }>;
  online: boolean;
  onClose: () => void;
}) {
  // 記録の多い方を残す台帳（統合先）の初期値にする
  const [targetId, setTargetId] = useState(() => ((stats.get(b.id)?.count ?? 0) > (stats.get(a.id)?.count ?? 0) ? b.id : a.id));
  const [pick, setPick] = useState<Record<FieldKey, string>>(() => {
    const init = {} as Record<FieldKey, string>;
    FIELDS.forEach((f) => (init[f.key] = targetId));
    return init;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const both = [a, b];
  const target = both.find((l) => l.id === targetId)!;
  const source = both.find((l) => l.id !== targetId)!;
  const val = (l: Ledger, k: FieldKey) => {
    const v = l[k];
    if (k === 'startDate' || k === 'endDate') return v ? v.replaceAll('-', '/') : '';
    return v;
  };

  return (
    <div className="admin-page">
      <button className="text-btn back-link" onClick={onClose}>
        ← 重複候補の一覧
      </button>
      <h1>台帳の統合</h1>
      <p className="hint">
        {customerName}。項目ごとに残す値を選んでください。作業記録は両方の台帳の分を合わせ、撮影日時順に並びます。統合された側の台帳は削除されず、あとから統合を取り消せます
      </p>
      <table className="admin-table merge-table">
        <thead>
          <tr>
            <th />
            {both.map((l) => (
              <th key={l.id}>
                <label className="merge-target">
                  <input
                    type="radio"
                    name="target"
                    checked={targetId === l.id}
                    onChange={() => {
                      setTargetId(l.id);
                      const next = {} as Record<FieldKey, string>;
                      FIELDS.forEach((f) => (next[f.key] = l.id));
                      setPick(next);
                    }}
                  />
                  {targetId === l.id ? '残す台帳（統合先）' : '統合される台帳'}
                </label>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {FIELDS.map((f) => (
            <tr key={f.key}>
              <th>{f.label}</th>
              {both.map((l) => (
                <td key={l.id} className={pick[f.key] === l.id ? 'picked' : ''}>
                  <label className="merge-cell">
                    <input type="radio" name={f.key} checked={pick[f.key] === l.id} onChange={() => setPick({ ...pick, [f.key]: l.id })} />
                    <span>{val(l, f.key) || <span className="hint">（空欄）</span>}</span>
                  </label>
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <th>作業記録</th>
            {both.map((l) => (
              <td key={l.id}>
                {stats.get(l.id)?.count ?? 0}件
                {stats.get(l.id)?.latest ? `（最新 ${new Date(stats.get(l.id)!.latest).toLocaleDateString('ja-JP')}）` : ''}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      {error && <p className="hint danger">{error}</p>}
      <div className="dialog-actions row">
        <button className="btn" onClick={onClose} disabled={busy}>
          キャンセル
        </button>
        <button
          className="btn btn-primary"
          disabled={!online || busy}
          onClick={async () => {
            const fields: Record<string, unknown> = {};
            for (const f of FIELDS) {
              const from = both.find((l) => l.id === pick[f.key])!;
              fields[f.column] = from[f.key] ?? '';
            }
            if (!confirm(`「${source.name}」を「${String(fields.name)}」に統合しますか？\n作業記録 ${stats.get(source.id)?.count ?? 0}件が移ります。`)) return;
            setBusy(true);
            setError(null);
            try {
              await getProvider().mergeLedgers(target.id, source.id, fields);
              await syncNow();
              onClose();
            } catch (e) {
              setError(`統合できませんでした：${(e as Error).message}`);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? '統合しています…' : online ? '統合する' : '圏外のため統合できません'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// P10 操作ログ（管理者。要件4.3）
// ---------------------------------------------------------------------------

const PAGE = 100;

export function LogPane() {
  const online = useOnline();
  const [logs, setLogs] = useState<ChangeLog[]>([]);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string>('');

  const load = async (before: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchLogs(PAGE, before);
      setLogs((cur) => (before ? [...cur, ...rows] : rows));
      setDone(rows.length < PAGE);
    } catch (e) {
      setError((e as Error).message || '操作ログを取得できませんでした');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // 画面を開いたとき・電波が戻ったときに最新を読み込む
    if (online) void Promise.resolve().then(() => load(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const shown = action ? logs.filter((l) => l.action === action) : logs;
  return (
    <div className="admin-page narrow">
      <h1>操作ログ</h1>
      <p className="hint">誰が、いつ、何を作成・変更・削除・統合したかを新しい順に表示します</p>
      <div className="admin-form-row">
        <label className="field">
          <span>操作で絞り込む</span>
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">すべて</option>
            {Object.entries(ACTION_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" onClick={() => load(null)} disabled={!online || loading}>
          最新を読み込む
        </button>
      </div>
      {!online && <p className="hint">操作ログはサーバーにあるため、電波のある場所で表示できます</p>}
      {error && <p className="hint danger">{error}</p>}
      <ul className="history-list">
        {shown.map((l) => (
          <LogRow key={l.id} log={l} />
        ))}
      </ul>
      {!loading && logs.length > 0 && shown.length === 0 && <p className="empty">該当する操作はありません</p>}
      {!done && logs.length > 0 && (
        <button className="btn btn-wide" disabled={loading} onClick={() => load(logs[logs.length - 1].createdAt)}>
          {loading ? '読み込んでいます…' : 'さらに読み込む'}
        </button>
      )}
    </div>
  );
}

function LogRow({ log }: { log: ChangeLog }) {
  const name = useLiveQuery(() => targetName(log.targetTable, log.targetId), [log.targetTable, log.targetId]);
  return <HistoryItem log={log} context={`${TABLE_LABEL[log.targetTable] ?? log.targetTable}：${name ?? ''}`} />;
}

// ---------------------------------------------------------------------------
// 通知（PC）
// ---------------------------------------------------------------------------

export function NotificationsPane({ onOpen }: { onOpen: (n: AppNotification) => void }) {
  return (
    <div className="admin-page narrow">
      <h1>通知</h1>
      <NotificationList
        onOpen={onOpen}
        actionLabel={(n) => (n.type === 'duplicate_candidate' ? '比較して統合' : n.type === 'provisional_customer' ? '仮顧客を処理' : n.payload.table === 'records' ? '作業記録を開く' : '台帳を開く')}
      />
    </div>
  );
}
