import type { DataProvider } from './provider';
import { createSupabaseProvider } from './supabaseProvider';

/**
 * 接続先の設定。初期値はテスト用のSupabase。
 * 公開用キー（publishable key）はブラウザに渡す前提のキーなので、コードに含めてよい（CLAUDE.md参照）。
 * 管理者は設定画面から接続先を変更できる（要件6.8）
 */
export interface ServerConfig {
  kind: 'supabase';
  url: string;
  key: string;
}

export const DEFAULT_SERVER: ServerConfig = {
  kind: 'supabase',
  url: 'https://fmmqxpunqxwxrsicfbev.supabase.co',
  key: 'sb_publishable_dufJ2SqqE1HyLvfsbre6kQ_0PH2o-_i',
};

const STORAGE_KEY = 'geoboard.server';

export function getServerConfig(): ServerConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const c = JSON.parse(raw) as Partial<ServerConfig>;
      if (c.kind === 'supabase' && c.url && c.key) return { kind: c.kind, url: c.url, key: c.key };
    }
  } catch {
    /* 初期値を使う */
  }
  return DEFAULT_SERVER;
}

/** 接続先を変更する。反映にはアプリの再読み込みが必要 */
export function setServerConfig(c: ServerConfig | null) {
  try {
    if (c) localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* 保存できない環境では初期値のまま */
  }
}

let provider: DataProvider | null = null;

export function getProvider(): DataProvider {
  if (!provider) {
    const c = getServerConfig();
    provider = createSupabaseProvider(c.url, c.key);
  }
  return provider;
}
