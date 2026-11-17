/**
 * 接続先アダプター（要件11.1）。
 * アプリからサーバーへの読み書きは必ずこのインターフェースを通す。
 * Supabase以外（PocketBase、自前API、SharePointなど）に乗り換えるときは、これを実装したものを追加する
 */

export interface AuthSession {
  userId: string;
  email: string;
}

/** サーバー上のテーブル名 */
export type RemoteTable = 'customers' | 'ledgers' | 'records' | 'record_extras' | 'blackboard_templates' | 'profiles';

/** サーバーの行（snake_case のまま扱う） */
export type RemoteRow = Record<string, unknown>;

export interface RemoteProfile {
  user_id: string;
  display_name: string;
  role: 'admin' | 'member';
  disabled: boolean;
  updated_at: string;
}

export interface DataProvider {
  readonly kind: string;

  /** 端末に保存されたログイン状態を返す（オフラインでも使える） */
  getSession(): Promise<AuthSession | null>;
  signIn(email: string, password: string): Promise<AuthSession>;
  signOut(): Promise<void>;
  /** ログイン状態が外部要因で変わったとき（トークン失効など） */
  onSessionChange(fn: (s: AuthSession | null) => void): () => void;

  fetchProfiles(): Promise<RemoteProfile[]>;
  updateProfile(userId: string, patch: Partial<Pick<RemoteProfile, 'display_name' | 'role' | 'disabled'>>): Promise<void>;

  /** 行をまとめて登録・更新する（IDが同じなら更新） */
  upsert(table: Exclude<RemoteTable, 'profiles'>, rows: RemoteRow[]): Promise<void>;
  /** server_updated_at が since より新しい行を古い順に取得する */
  pull(table: Exclude<RemoteTable, 'profiles'>, since: string | null, limit: number): Promise<RemoteRow[]>;

  /** 画像を保存し、サーバーに正しく届いたか（サイズ一致）を確認する */
  uploadFile(path: string, blob: Blob): Promise<void>;
  downloadFile(path: string): Promise<Blob>;
}

/** 通信できない（圏外・タイムアウトなど）ことによる失敗。再試行の対象 */
export class NetworkError extends Error {
  constructor(message = 'サーバーに接続できません') {
    super(message);
    this.name = 'NetworkError';
  }
}

/** ログインが必要（未ログイン・ログイン切れ） */
export class AuthRequiredError extends Error {
  constructor(message = 'ログインが必要です') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}
