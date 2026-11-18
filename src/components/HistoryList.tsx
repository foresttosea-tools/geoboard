import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useState } from 'react';
import { ACTION_LABEL, boardDiff, canRestore, currentEqualsBefore, fetchHistory, fieldLabel, formatValue, restoreFromLog } from '../lib/history';
import { useOnline, useUserName } from '../sync/hooks';
import type { ChangeLog } from '../types';

interface Props {
  /** 対象のID（作業記録なら記録のID、台帳なら台帳のID） */
  targetIds: string[];
  /** 「作成」など項目のない履歴も出すか */
  showAll?: boolean;
}

/** S15 / P04 変更履歴。以前の内容に戻せる（要件6.7・7.3） */
export function HistoryList({ targetIds, showAll = true }: Props) {
  const online = useOnline();
  const [logs, setLogs] = useState<ChangeLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = targetIds.join(',');

  const load = useCallback(async () => {
    setError(null);
    try {
      setLogs(await fetchHistory(key.split(',')));
    } catch (e) {
      setError((e as Error).message || '変更履歴を取得できませんでした');
    }
  }, [key]);

  useEffect(() => {
    if (online) void Promise.resolve().then(load);
  }, [online, load]);

  if (!online && !logs) return <p className="hint">変更履歴はサーバーにあるため、電波のある場所で表示できます</p>;
  if (error) return <p className="hint danger">{error}</p>;
  if (!logs) return <p className="hint">読み込んでいます…</p>;
  const shown = showAll ? logs : logs.filter((l) => l.field);
  if (shown.length === 0) return <p className="hint">変更履歴はまだありません</p>;
  return (
    <ul className="history-list">
      {shown.map((l) => (
        <HistoryItem key={l.id} log={l} onRestored={load} />
      ))}
    </ul>
  );
}

const fmt = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function HistoryItem({ log, onRestored, context }: { log: ChangeLog; onRestored?: () => void; context?: string }) {
  const userName = useUserName();
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const same = useLiveQuery(() => (canRestore(log) ? currentEqualsBefore(log) : Promise.resolve(true)), [log.id]);
  const diff = log.field === 'board' ? boardDiff(log.before, log.after) : null;
  const conflict = log.action === 'conflict_overwrite';

  return (
    <li className={`history-item${conflict ? ' conflict' : ''}`}>
      <div className="history-head">
        <span className={`badge ${conflict ? 'badge-warn' : log.action === 'delete' ? 'badge-error' : ''}`}>{ACTION_LABEL[log.action]}</span>
        <span className="history-who">{userName(log.userId)}</span>
        <span className="history-when">{fmt(log.createdAt)}</span>
      </div>
      {context && <p className="history-context">{context}</p>}
      {log.field && (
        <div className="history-body">
          <strong>{fieldLabel(log.targetTable, log.field)}</strong>
          {diff ? (
            <ul className="history-diff">
              {diff.map((d, i) => (
                <li key={i}>
                  {d.label}：<del>{d.before}</del> → <ins>{d.after}</ins>
                </li>
              ))}
            </ul>
          ) : (
            <p className="history-diff">
              <del>{formatValue(log.targetTable, log.field, log.before)}</del> → <ins>{formatValue(log.targetTable, log.field, log.after)}</ins>
            </p>
          )}
          {conflict && <p className="hint warn-text">{userName(log.overwrittenUserId)}さんが入力した内容（取り消し線）が、同時に編集した内容で上書きされました</p>}
        </div>
      )}
      {log.action === 'merge' && <p className="history-body">「{String((log.after as { source_name?: string })?.source_name ?? '')}」をこの台帳に統合</p>}
      {log.action === 'unmerge' && <p className="history-body">「{String((log.after as { source_name?: string })?.source_name ?? '')}」の統合を取り消し</p>}
      {canRestore(log) && same === false && !done && (
        <button
          className="btn btn-small"
          disabled={busy || !online}
          onClick={async () => {
            if (!confirm(`「${fieldLabel(log.targetTable, log.field)}」を変更前の内容に戻しますか？`)) return;
            setBusy(true);
            setMsg(null);
            try {
              await restoreFromLog(log);
              setDone(true);
              setMsg('戻しました。送信すると全員の端末に反映されます');
              onRestored?.();
            } catch (e) {
              setMsg((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? '戻しています…' : '変更前の内容に戻す'}
        </button>
      )}
      {msg && <p className="hint">{msg}</p>}
    </li>
  );
}
