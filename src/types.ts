/** 黒板の1枠 */
export interface BoardItem {
  label: string;
  value: string;
}

/** 黒板の内容（8枠固定）。並び順は BOARD_SLOTS と対応する */
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

export interface Ledger {
  id: string;
  customerName: string;
  name: string;
  startDate: string;
  endDate: string;
  manager: string;
  note: string;
  lastBoard: BoardContent | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkRecord {
  id: string;
  ledgerId: string;
  mode: CaptureMode;
  board: BoardContent | null;
  boardLayout: BoardLayout | null;
  memo: string;
  shotAt: string;
  shotDateNeedsCheck: boolean;
  source: 'camera' | 'import';
  latitude: number | null;
  longitude: number | null;
  locationAccuracy: number | null;
  imageWidth: number;
  imageHeight: number;
  /** 未送信 / 送信済み（ステップ3で使用） */
  syncStatus: 'pending' | 'synced' | 'failed';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** 端末内に保存する画像本体 */
export interface StoredImage {
  /** `${recordId}:composite` / `${recordId}:original` / `${recordId}:thumb` */
  key: string;
  recordId: string;
  kind: 'composite' | 'original' | 'thumb';
  blob: Blob;
}

export interface BoardTemplate {
  id: string;
  name: string;
  content: BoardContent;
  lastUsedAt: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
