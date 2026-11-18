import { Icon } from './Icon';
import { useUnreadCount } from '../sync/hooks';

/** 通知アイコン（未読があれば件数を表示） */
export function NotificationBell({ onClick }: { onClick: () => void }) {
  const n = useUnreadCount();
  return (
    <button className="icon-btn bell-btn" aria-label={n ? `通知（未読${n}件）` : '通知'} onClick={onClick}>
      <Icon name="bell" />
      {n > 0 && <span className="bell-badge">{n > 99 ? '99+' : n}</span>}
    </button>
  );
}
