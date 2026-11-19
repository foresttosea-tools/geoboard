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
/** 差分取得できるテーブル */
export type PullTable = Exclude<RemoteTable, 'profiles'> | 'notifications' | 'duplicate_dismissals';

/** サーバーの行（snake_case のまま扱う） */
export type RemoteRow = Record<string, unknown>;

export interface RemoteProfile {
  user_id: string;
  display_name: string;
  role: 'admin' | 'member';
  disabled: boolean;
  updated_at: string;
}

/** 写真の保存場所にあるファイル */
export interface RemoteFile {
  path: string;
  size: number;
  createdAt: string;
}

export interface DataProvider {
  readonly kind: string;

  /** 端末に保存されたログイン状態を返す（オフラインでも使える） */
  getSession(): Promise<AuthSession | null>;
  signIn(email: string, password: string): Promise<AuthSession>;
  signOut(): Promise<void>;
  /** 自分のパスワードを変える（今のパスワードで本人確認してから） */
  changePassword(email: string, currentPassword: string, newPassword: string): Promise<void>;
  /** ログイン状態が外部要因で変わったとき（トークン失効など） */
  onSessionChange(fn: (s: AuthSession | null) => void): () => void;

  fetchProfiles(): Promise<RemoteProfile[]>;
  updateProfile(userId: string, patch: Partial<Pick<RemoteProfile, 'display_name' | 'role' | 'disabled'>>): Promise<void>;

  /** 行をまとめて登録・更新する（IDが同じなら更新） */
  upsert(table: Exclude<RemoteTable, 'profiles'>, rows: RemoteRow[]): Promise<void>;
  /** server_updated_at が since より新しい行を古い順に取得する */
  pull(table: PullTable, since: string | null, limit: number): Promise<RemoteRow[]>;

  /** 自分宛ての通知を既読にする */
  markNotificationsRead(ids: string[], at: string): Promise<void>;
  /** 変更履歴・操作ログを新しい順に取得する（targetIds を指定するとその対象だけ。before より前） */
  fetchChangeLogs(opts: { targetIds?: string[]; limit: number; before?: string | null }): Promise<RemoteRow[]>;
  /** 台帳のペアを「重複ではない」にする（管理者） */
  dismissDuplicate(ledgerA: string, ledgerB: string): Promise<void>;
  /** 台帳を統合する（管理者）。fields は統合先に残す値（サーバーの列名） */
  mergeLedgers(targetId: string, sourceId: string, fields: Record<string, unknown>): Promise<void>;
  /** 台帳の統合を取り消す（管理者） */
  unmergeLedger(sourceId: string): Promise<void>;

  /** 写真の保存場所にあるファイルをすべて列挙する */
  listFiles(): Promise<RemoteFile[]>;
  /** ファイルを削除する（管理者） */
  deleteFiles(paths: string[]): Promise<void>;

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
