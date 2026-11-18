import { db, requestSync } from '../db';
import type { AppNotification } from '../types';
import { fieldLabel, targetName } from './history';

/** 通知を既読にする（端末に記録し、次の同期でサーバーに送る） */
export async function markNotificationsRead(ids: string[]) {
  const at = new Date().toISOString();
  await db.notifications.bulkUpdate(ids.map((id) => ({ key: id, changes: { readAt: at, readPending: true } })));
  requestSync();
}

export async function markAllRead() {
  const ids = (await db.notifications.filter((n) => !n.readAt).toArray()).map((n) => n.id);
  await markNotificationsRead(ids);
}

const p = (n: AppNotification, k: string) => (n.payload[k] == null ? '' : String(n.payload[k]));

/** 通知の見出しと本文 */
export async function describeNotification(n: AppNotification): Promise<{ title: string; body: string }> {
  const profiles = await db.profiles.toArray();
  const nameOf = (id: string) => profiles.find((x) => x.userId === id)?.displayName ?? '（不明なユーザー）';
  if (n.type === 'conflict') {
    const table = p(n, 'table');
    const name = await targetName(table, p(n, 'target_id'));
    return {
      title: '同時編集で内容が上書きされました',
      body: `${name}の「${fieldLabel(table, p(n, 'field'))}」：${nameOf(p(n, 'overwritten'))}さんの入力を、${nameOf(p(n, 'by'))}さんの編集で上書きしました。変更履歴から元に戻せます`,
    };
  }
  if (n.type === 'duplicate_candidate') {
    const names = (n.payload.names as string[] | undefined) ?? [];
    const customer = (await db.customers.get(p(n, 'customer_id')))?.name ?? '';
    return {
      title: '重複の可能性がある台帳があります',
      body: `${customer ? `${customer}：` : ''}「${names[0] ?? ''}」と「${names[1] ?? ''}」`,
    };
  }
  return {
    title: '仮顧客が作成されました',
    body: `「${p(n, 'name')}」。既存の顧客に紐づけるか、正式な顧客として登録してください`,
  };
}

/** 管理者がPC管理画面で処理する通知か */
export const isAdminTask = (n: AppNotification) => n.type === 'duplicate_candidate' || n.type === 'provisional_customer';
