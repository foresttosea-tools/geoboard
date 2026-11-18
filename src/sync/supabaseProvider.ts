import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AuthRequiredError, NetworkError, type AuthSession, type DataProvider, type RemoteProfile, type RemoteRow } from './provider';

const BUCKET = 'photos';
const STORAGE_KEY = 'geoboard.auth';

/** fetch 自体の失敗（圏外など）を NetworkError にそろえる */
function wrapError(e: unknown): Error {
  if (e instanceof NetworkError || e instanceof AuthRequiredError) return e;
  const err = e as { message?: string; name?: string; status?: number; code?: string };
  const msg = err?.message ?? String(e);
  if (err?.name === 'TypeError' || /fetch|network|Failed to fetch|Load failed|timeout/i.test(msg) || err?.name === 'AuthRetryableFetchError') {
    return new NetworkError();
  }
  if (err?.status === 401 || err?.code === 'PGRST301' || /JWT|not authenticated/i.test(msg)) return new AuthRequiredError();
  return new Error(msg);
}

export function createSupabaseProvider(url: string, key: string): DataProvider {
  const client: SupabaseClient = createClient(url, key, {
    auth: {
      // ログイン状態は端末に保存し、ログアウトするまで保持する（要件4.1）
      persistSession: true,
      autoRefreshToken: true,
      storageKey: STORAGE_KEY,
    },
  });

  const toSession = (s: { user: { id: string; email?: string } } | null): AuthSession | null =>
    s ? { userId: s.user.id, email: s.user.email ?? '' } : null;

  /**
   * 端末に保存されたログイン情報を直接読む。
   * getSession() は期限切れのトークンを更新しようとして、圏外だと空を返すことがあるため、
   * 「ログイン済みか」の判定にはこちらを使う（圏外でログイン画面に戻されないように）
   */
  const storedSession = (): AuthSession | null => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw) as { user?: { id?: string; email?: string } };
      return s.user?.id ? { userId: s.user.id, email: s.user.email ?? '' } : null;
    } catch {
      return null;
    }
  };

  /** 通信の前に有効なトークンを用意する */
  const requireSession = async () => {
    if (!storedSession()) throw new AuthRequiredError();
    const { data, error } = await client.auth.getSession();
    if (data.session) return;
    if (error && error.name === 'AuthRetryableFetchError') throw new NetworkError();
    if (!navigator.onLine) throw new NetworkError();
    throw new AuthRequiredError();
  };

  return {
    kind: 'supabase',

    async getSession() {
      return storedSession();
    },

    async signIn(email, password) {
      try {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) {
          if (error.name === 'AuthRetryableFetchError') throw new NetworkError();
          throw new Error(/invalid login credentials/i.test(error.message) ? 'メールアドレスかパスワードが違います' : error.message);
        }
        return toSession(data.session)!;
      } catch (e) {
        throw wrapError(e);
      }
    },

    async signOut() {
      // 圏外でも端末のログイン状態は消す
      await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
    },

    onSessionChange(fn) {
      // 明示的なログアウト・ログインのときだけ知らせる（圏外でのトークン更新失敗ではログアウト扱いにしない）
      const { data } = client.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') fn(event === 'SIGNED_OUT' ? storedSession() : toSession(session));
      });
      return () => data.subscription.unsubscribe();
    },

    async fetchProfiles() {
      await requireSession();
      try {
        const { data, error } = await client.from('profiles').select('user_id, display_name, role, disabled, updated_at');
        if (error) throw error;
        return (data ?? []) as RemoteProfile[];
      } catch (e) {
        throw wrapError(e);
      }
    },

    async updateProfile(userId, patch) {
      await requireSession();
      try {
        const { error } = await client.from('profiles').update(patch).eq('user_id', userId);
        if (error) throw error;
      } catch (e) {
        throw wrapError(e);
      }
    },

    async upsert(table, rows) {
      if (rows.length === 0) return;
      await requireSession();
      try {
        const { error } = await client.from(table).upsert(rows, { onConflict: 'id' });
        if (error) throw error;
      } catch (e) {
        throw wrapError(e);
      }
    },

    async pull(table, since, limit) {
      await requireSession();
      try {
        let q = client.from(table).select('*').order('server_updated_at', { ascending: true }).limit(limit);
        if (since) q = q.gt('server_updated_at', since);
        const { data, error } = await q;
        if (error) throw error;
        return (data ?? []) as RemoteRow[];
      } catch (e) {
        throw wrapError(e);
      }
    },

    async uploadFile(path, blob) {
      await requireSession();
      try {
        const { error } = await client.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: blob.type || 'image/jpeg' });
        if (error) throw error;
        // 受信完了の確認：サーバー上のサイズが送ったものと一致するか（要件7.2）
        const { data: info, error: infoError } = await client.storage.from(BUCKET).info(path);
        if (infoError) throw infoError;
        const size = (info as { size?: number } | null)?.size;
        if (size != null && size !== blob.size) throw new Error(`画像の送信が不完全です（${size} / ${blob.size} bytes）`);
      } catch (e) {
        throw wrapError(e);
      }
    },

    async markNotificationsRead(ids, at) {
      if (ids.length === 0) return;
      await requireSession();
      try {
        const { error } = await client.from('notifications').update({ read_at: at }).in('id', ids);
        if (error) throw error;
      } catch (e) {
        throw wrapError(e);
      }
    },

    async fetchChangeLogs({ targetIds, limit, before }) {
      await requireSession();
      try {
        let q = client.from('change_logs').select('*').order('created_at', { ascending: false }).limit(limit);
        if (targetIds?.length) q = q.in('target_id', targetIds);
        if (before) q = q.lt('created_at', before);
        const { data, error } = await q;
        if (error) throw error;
        return (data ?? []) as RemoteRow[];
      } catch (e) {
        throw wrapError(e);
      }
    },

    async dismissDuplicate(ledgerA, ledgerB) {
      await requireSession();
      try {
        const [a, b] = ledgerA < ledgerB ? [ledgerA, ledgerB] : [ledgerB, ledgerA];
        const { error } = await client.from('duplicate_dismissals').upsert([{ ledger_a: a, ledger_b: b }], { onConflict: 'ledger_a,ledger_b', ignoreDuplicates: true });
        if (error) throw error;
      } catch (e) {
        throw wrapError(e);
      }
    },

    async mergeLedgers(targetId, sourceId, fields) {
      await requireSession();
      try {
        const { error } = await client.rpc('merge_ledgers', { p_target: targetId, p_source: sourceId, p_fields: fields });
        if (error) throw error;
      } catch (e) {
        throw wrapError(e);
      }
    },

    async unmergeLedger(sourceId) {
      await requireSession();
      try {
        const { error } = await client.rpc('unmerge_ledger', { p_source: sourceId });
        if (error) throw error;
      } catch (e) {
        throw wrapError(e);
      }
    },

    async downloadFile(path) {
      await requireSession();
      try {
        const { data, error } = await client.storage.from(BUCKET).download(path);
        if (error) throw error;
        return data;
      } catch (e) {
        throw wrapError(e);
      }
    },
  };
}
