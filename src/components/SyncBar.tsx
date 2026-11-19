import { useState } from 'react';
import { prefs } from '../lib/prefs';
import { getProvider } from '../sync/config';
import { clearSyncNotice, resetSyncState, retryFailed } from '../sync/engine';
import { useOnline, useSyncState, useUnsent } from '../sync/hooks';

/**
 * 同期の状況（送信中・送信失敗・圏外・再ログイン・長期未送信の警告）。
 * 問題がないときは何も表示しない（要件6.3, 7.2）
 */
export function SyncBar() {
  const sync = useSyncState();
  const unsent = useUnsent();
  const online = useOnline();
  const [retrying, setRetrying] = useState(false);
  if (!unsent) return null;

  const warnDays = prefs.getUnsentWarnDays();
  const stale = unsent.stale;

  const items: { tone: 'info' | 'warn' | 'error'; text: string; action?: { label: string; onClick: () => void } }[] = [];
  if (sync.authRequired) {
    items.push({
      tone: 'error',
      text: 'ログインの有効期限が切れました。送信するにはログインし直してください（端末のデータは消えません）',
      action: {
        label: 'ログイン',
        onClick: async () => {
          await getProvider().signOut();
          resetSyncState();
        },
      },
    });
  }
  if (sync.notice) {
    items.push({ tone: 'warn', text: sync.notice, action: { label: 'OK', onClick: clearSyncNotice } });
  }
  if (sync.running && sync.progress) {
    items.push({ tone: 'info', text: `送信中 ${sync.progress.done} / ${sync.progress.total}件` });
  } else if (sync.running) {
    items.push({ tone: 'info', text: '同期しています…' });
  }
  if (unsent.failed > 0 && !sync.running) {
    items.push({
      tone: 'error',
      text: `送信に失敗したデータが${unsent.failed}件あります`,
      action: {
        label: retrying ? '再送中…' : '再送',
        onClick: async () => {
          setRetrying(true);
          await retryFailed();
          setRetrying(false);
        },
      },
    });
  }
  if (!online && unsent.pending > 0) {
    items.push({
      tone: 'warn',
      text: unsent.records > 0 ? `圏外です。未送信の記録${unsent.records}件は電波が戻ったら自動で送信します` : '圏外です。未送信の変更は電波が戻ったら自動で送信します',
    });
  }
  if (stale) {
    items.push({ tone: 'warn', text: `${warnDays}日以上送信されていないデータがあります。電波のある場所でアプリを開いてください` });
  }
  if (items.length === 0) return null;

  return (
    <div className="syncbar">
      {items.map((it) => (
        <div key={it.text} className={`syncbar-item tone-${it.tone}`}>
          <span>{it.text}</span>
          {it.action && (
            <button className="syncbar-btn" onClick={it.action.onClick} disabled={retrying}>
              {it.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
