import { SLOT_DATE, formatBoardDate } from '../blackboard/model';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { WorkRecord } from '../types';

export function formatShotDate(r: WorkRecord) {
  if (r.board?.[SLOT_DATE]?.value) return formatBoardDate(r.board[SLOT_DATE].value);
  const d = new Date(r.shotAt);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

export function Marks({ r }: { r: WorkRecord }) {
  return (
    <div className="marks">
      <SyncMark r={r} />
      {r.shotDateNeedsCheck && <span className="badge badge-warn">日付要確認</span>}
      {r.source === 'import' && <span className="badge">取込画像</span>}
      {r.latitude == null && <span className="badge">位置なし</span>}
      <ExtraCount recordId={r.id} />
    </div>
  );
}

/** 記録そのもの、または追加写真の送信状態 */
function SyncMark({ r }: { r: WorkRecord }) {
  const extra = useLiveQuery(async () => {
    const xs = await db.extras.where('recordId').equals(r.id).toArray();
    return xs.some((x) => x.syncStatus === 'failed') ? 'failed' : xs.some((x) => x.syncStatus === 'pending') ? 'pending' : 'synced';
  }, [r.id]);
  const status = r.syncStatus === 'failed' || extra === 'failed' ? 'failed' : r.syncStatus === 'pending' || extra === 'pending' ? 'pending' : 'synced';
  if (status === 'failed') return <span className="badge badge-error">送信失敗</span>;
  if (status === 'pending') return <span className="badge badge-pending">未送信</span>;
  return null;
}

function ExtraCount({ recordId }: { recordId: string }) {
  const n = useLiveQuery(() => db.extras.where('recordId').equals(recordId).filter((x) => !x.deletedAt).count(), [recordId]);
  return n ? <span className="badge badge-brand">追加写真 {n}</span> : null;
}
