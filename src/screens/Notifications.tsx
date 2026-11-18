import { useState } from 'react';
import { Icon } from '../components/Icon';
import { NotificationList } from '../components/NotificationList';
import { isAdminTask } from '../lib/notifications';
import type { AppNotification } from '../types';

interface Props {
  onBack: () => void;
  /** 作業記録を開く */
  onOpenRecord: (recordId: string, ledgerId: string) => void;
  /** 台帳を開く */
  onOpenLedger: (ledgerId: string) => void;
}

const adminUrl = () => `${location.origin}${import.meta.env.BASE_URL}#admin`;

/** S16 通知。重複候補・仮顧客はPC管理画面で処理する（画面一覧「スマホでの管理者向け操作」） */
export function Notifications({ onBack, onOpenRecord, onOpenLedger }: Props) {
  const [pcHint, setPcHint] = useState<AppNotification | null>(null);
  return (
    <div className="screen">
      <header className="appbar">
        <button className="icon-btn" onClick={onBack} aria-label="戻る">
          <Icon name="back" />
        </button>
        <h1>通知</h1>
        <span />
      </header>
      <main className="screen-body">
        {pcHint && (
          <div className="card pc-hint">
            <p>
              {pcHint.type === 'duplicate_candidate' ? '台帳の統合' : '仮顧客の処理'}は、PC管理画面で行います。PCのブラウザで次のURLを開いてください
            </p>
            <p className="admin-url">{adminUrl()}</p>
            <button className="text-btn" onClick={() => setPcHint(null)}>
              閉じる
            </button>
          </div>
        )}
        <NotificationList
          actionLabel={(n) => (isAdminTask(n) ? 'PCで処理する' : n.payload.table === 'records' ? '作業記録を開く' : '台帳を開く')}
          onOpen={(n) => {
            if (isAdminTask(n)) {
              setPcHint(n);
              return;
            }
            const ledgerId = String(n.payload.ledger_id ?? '');
            if (n.payload.table === 'records') onOpenRecord(String(n.payload.target_id), ledgerId);
            else onOpenLedger(ledgerId);
          }}
        />
      </main>
    </div>
  );
}
