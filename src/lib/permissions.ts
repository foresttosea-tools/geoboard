import type { Profile } from '../types';
import { prefs } from './prefs';

/**
 * 削除できるか（要件4.2）。管理者はすべて、一般ユーザーは自分が作成したものだけ。
 * サーバー側でも同じルールでチェックしているが、操作する前に分かるように端末でも判定する
 */
export function canDeleteOwnOrAdmin(me: Profile | undefined, createdBy: string | null | undefined): boolean {
  if (me?.role === 'admin' && !me.disabled) return true;
  const myId = prefs.getUserId();
  // ログイン前に作った記録（作成者が未設定）は、その端末の持ち主のものとして扱う
  return !createdBy || createdBy === myId || !/^[0-9a-f-]{36}$/.test(createdBy);
}

export const DELETE_DENIED_MESSAGE = '他の人が作成したものは削除できません。削除が必要な場合は管理者に依頼してください';
