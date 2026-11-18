import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { describeNotification, markAllRead, markNotificationsRead } from '../lib/notifications';
import type { AppNotification } from '../types';

/** S16 / PC 通知一覧（要件6.1・6.2・7.3）。新しい順 */
export function NotificationList({ onOpen, actionLabel }: { onOpen: (n: AppNotification) => void; actionLabel: (n: AppNotification) => string | null }) {
  const list = useLiveQuery(() => db.notifications.orderBy('createdAt').reverse().limit(200).toArray(), []);
  const unread = (list ?? []).filter((n) => !n.readAt).length;
  if (!list) return null;
  return (
    <div className="notif-wrap">
      <div className="notif-toolbar">
        <span>未読 {unread}件</span>
        {unread > 0 && (
          <button className="text-btn" onClick={() => markAllRead()}>
            すべて既読にする
          </button>
        )}
      </div>
      {list.length === 0 && <p className="empty">通知はありません</p>}
      <ul className="notif-list">
        {list.map((n) => (
          <NotificationItem key={n.id} n={n} onOpen={onOpen} actionLabel={actionLabel(n)} />
        ))}
      </ul>
    </div>
  );
}

function NotificationItem({ n, onOpen, actionLabel }: { n: AppNotification; onOpen: (n: AppNotification) => void; actionLabel: string | null }) {
  const text = useLiveQuery(() => describeNotification(n), [n.id]);
  const d = new Date(n.createdAt);
  return (
    <li className={`notif-item${n.readAt ? '' : ' unread'}`}>
      <div className="notif-head">
        {!n.readAt && <span className="notif-dot" aria-label="未読" />}
        <strong>{text?.title ?? ''}</strong>
        <span className="notif-when">{`${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`}</span>
      </div>
      <p className="notif-body">{text?.body ?? ''}</p>
      <div className="notif-actions">
        {actionLabel && (
          <button
            className="btn btn-small btn-primary"
            onClick={() => {
              if (!n.readAt) void markNotificationsRead([n.id]);
              onOpen(n);
            }}
          >
            {actionLabel}
          </button>
        )}
        {!n.readAt && (
          <button className="text-btn" onClick={() => markNotificationsRead([n.id])}>
            既読にする
          </button>
        )}
      </div>
    </li>
  );
}
