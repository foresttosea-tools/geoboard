import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { db } from '../db';
import { prefs } from '../lib/prefs';
import type { Profile } from '../types';
import { getProvider } from './config';
import { countUnsent, startAutoSync, syncStore, unsentRecordIds } from './engine';
import type { AuthSession } from './provider';

/** ログイン状態。undefined：確認中 / null：未ログイン */
export function useAuthSession(): AuthSession | null | undefined {
  const [session, setSession] = useState<AuthSession | null | undefined>(undefined);
  useEffect(() => {
    const provider = getProvider();
    let alive = true;
    provider.getSession().then((s) => alive && setSession(s));
    const off = provider.onSessionChange((s) => setSession(s));
    return () => {
      alive = false;
      off();
    };
  }, []);
  useEffect(() => {
    if (!session) return;
    prefs.setUserId(session.userId);
    startAutoSync();
  }, [session]);
  return session;
}

export function useSyncState() {
  return useSyncExternalStore(syncStore.subscribe, syncStore.get);
}

/** 未送信・送信失敗の件数と、設定日数より古い未送信の作業記録があるか（要件7.2） */
export function useUnsent() {
  return useLiveQuery(async () => {
    const counts = await countUnsent();
    const oldest = (await db.records.where('syncStatus').anyOf('pending', 'failed').sortBy('createdAt'))[0];
    const warnMs = prefs.getUnsentWarnDays() * 24 * 60 * 60 * 1000;
    const stale = oldest != null && Date.now() - Date.parse(oldest.createdAt) > warnMs;
    return { ...counts, stale };
  }, []);
}

/** ログイン中のユーザーのプロフィール（サーバーから取り込んだもの） */
export function useMyProfile(): Profile | undefined {
  return useLiveQuery(async () => {
    const id = prefs.getUserId();
    return id ? await db.profiles.get(id) : undefined;
  }, []);
}

export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** 未送信の作業記録のID（追加写真だけが未送信の記録も含む） */
export function useUnsentRecordIds() {
  return useLiveQuery(unsentRecordIds, [], new Set<string>());
}

/** ユーザーIDから表示名を引く */
export function useUserName() {
  const profiles = useLiveQuery(() => db.profiles.toArray(), []);
  return (id: string | null) => (id ? (profiles?.find((p) => p.userId === id)?.displayName ?? '（不明なユーザー）') : '（システム）');
}

/** 未読の通知の件数（通知アイコンのバッジ） */
export function useUnreadCount() {
  return useLiveQuery(() => db.notifications.filter((x) => !x.readAt).count(), []) ?? 0;
}
