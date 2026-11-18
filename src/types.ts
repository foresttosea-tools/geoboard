/** 同期の状態。pending：未送信 / synced：送信済み / failed：送信失敗（手動で再送） */
export type SyncStatus = 'pending' | 'synced' | 'failed';

/** 黒板の1枠 */
export interface BoardItem {
  label: string;
  value: string;
}

/** 黒板の内容（7枠固定）。並び順は BOARD_SLOTS と対応する */
export type BoardContent = BoardItem[];

/** 撮影モード */
export type CaptureMode = 'with_board' | 'without_board' | 'both';

/** 写真上の黒板の位置・サイズ（写真に対する相対値 0〜1） */
export interface BoardLayout {
  /** 黒板の左上X（写真の幅に対する割合） */
  x: number;
  /** 黒板の左上Y（写真の高さに対する割合） */
  y: number;
  /** 黒板の幅（写真の幅に対する割合） */
  w: number;
}

export interface Customer {
  id: string;
  /** 顧客コード（サーバーで採番。送信前・仮顧客はnull） */
  code: string | null;
  name: string;
  /** 仮顧客（圏外で作成した未確定の顧客） */
  isProvisional: boolean;
  /** 仮顧客を既存の顧客に紐づけたときの紐づけ先 */
  mergedInto?: string | null;
  /** 作成者のユーザーID */
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  syncStatus: SyncStatus;
  syncError?: string;
}

export interface Ledger {
  id: string;
  customerId: string;
  /** 工事名称 */
  name: string;
  startDate: string;
  endDate: string;
  manager: string;
  note: string;
  lastBoard: BoardContent | null;
  /** 統合された場合の統合先台帳（統合された台帳は一覧に出さない） */
  mergedInto?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /** サーバーに送信済みの行か（項目単位のマージに使う） */
  remote?: boolean;
  /** 送信前に端末で編集した項目と、編集を始めたときの値（項目単位のマージ・衝突の判定用。要件7.3） */
  fieldBase?: Record<string, unknown>;
  syncStatus: SyncStatus;
  syncError?: string;
}

export interface WorkRecord {
  id: string;
  ledgerId: string;
  mode: CaptureMode;
  board: BoardContent | null;
  boardLayout: BoardLayout | null;
  /** 補足・訂正用メモ */
  memo: string;
  /** 次回への引継ぎ事項（黒板には載せない） */
  handover: string;
  /** 引継ぎ事項をレポートに載せるか */
  handoverInReport: boolean;
  shotAt: string;
  shotDateNeedsCheck: boolean;
  source: 'camera' | 'import';
  latitude: number | null;
  longitude: number | null;
  locationAccuracy: number | null;
  imageWidth: number;
  imageHeight: number;
  /** サーバー上の画像の保存場所（送信後に設定） */
  compositePath?: string | null;
  originalPath?: string | null;
  thumbPath?: string | null;
  /** サーバーに送信済みの行か（項目単位のマージに使う） */
  remote?: boolean;
  /** 送信前に端末で編集した項目と、編集を始めたときの値（項目単位のマージ・衝突の判定用。要件7.3） */
  fieldBase?: Record<string, unknown>;
  syncStatus: SyncStatus;
  syncError?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** 端末内に保存する画像本体 */
export interface StoredImage {
  /**
   * メイン写真：`${recordId}:composite` / `${recordId}:original` / `${recordId}:thumb`
   * 追加写真：`${extraId}:extra` / `${extraId}:extra_thumb`
   */
  key: string;
  /** 画像が属する作業記録のID（追加写真も親の作業記録のID） */
  recordId: string;
  kind: 'composite' | 'original' | 'thumb' | 'extra' | 'extra_thumb';
  blob: Blob;
  /** サーバーへ送信済みか */
  uploaded?: boolean;
  /** サーバー上の保存場所（送信済み、またはサーバーから取り寄せた画像） */
  path?: string;
}

export interface BoardTemplate {
  id: string;
  name: string;
  content: BoardContent;
  lastUsedAt: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  syncStatus: SyncStatus;
  syncError?: string;
}

/** 次回への引継ぎ事項（黒板には載せない） */
export interface Handover {
  text: string;
  inReport: boolean;
}

/** 追加写真（黒板なし・複数枚。閲覧用でレポートには載せない） */
export interface ExtraPhoto {
  id: string;
  recordId: string;
  source: 'camera' | 'import';
  width: number;
  height: number;
  path?: string | null;
  thumbPath?: string | null;
  syncStatus: SyncStatus;
  syncError?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** ユーザー（サーバーのprofilesの写し） */
export interface Profile {
  userId: string;
  displayName: string;
  role: 'admin' | 'member';
  disabled: boolean;
  updatedAt: string;
}

/** アプリ内通知（要件6.1・6.2・7.3） */
export interface AppNotification {
  id: string;
  type: 'conflict' | 'duplicate_candidate' | 'provisional_customer';
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
  /** 既読にしたが、まだサーバーに送っていない */
  readPending?: boolean;
}

/** 重複ではないと判定した台帳のペア（ledgerA < ledgerB） */
export interface DuplicateDismissal {
  key: string;
  ledgerA: string;
  ledgerB: string;
}

/** 変更履歴・操作ログの1件（サーバーの change_logs。端末には保存しない） */
export interface ChangeLog {
  id: string;
  targetTable: string;
  targetId: string;
  action: 'create' | 'update' | 'delete' | 'restore' | 'merge' | 'unmerge' | 'conflict_overwrite';
  field: string | null;
  before: unknown;
  after: unknown;
  userId: string | null;
  overwrittenUserId: string | null;
  createdAt: string;
}
