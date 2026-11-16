import { SLOT_DATE, formatBoardDate } from '../blackboard/model';
import type { WorkRecord } from '../types';

export function formatShotDate(r: WorkRecord) {
  if (r.board?.[SLOT_DATE]?.value) return formatBoardDate(r.board[SLOT_DATE].value);
  const d = new Date(r.shotAt);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

export function Marks({ r }: { r: WorkRecord }) {
  return (
    <div className="marks">
      {r.syncStatus === 'pending' && <span className="badge badge-pending">未送信</span>}
      {r.syncStatus === 'failed' && <span className="badge badge-error">送信失敗</span>}
      {r.shotDateNeedsCheck && <span className="badge badge-warn">日付要確認</span>}
      {r.source === 'import' && <span className="badge">取込画像</span>}
      {r.latitude == null && <span className="badge">位置なし</span>}
    </div>
  );
}
