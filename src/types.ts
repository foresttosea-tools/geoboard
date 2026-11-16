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
  /** 顧客コード（サーバーで採番。ステップ3まではnull） */
  code: string | null;
  name: string;
  /** 仮顧客（圏外で作成した未確定の顧客。ステップ3で使用） */
  isProvisional: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
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
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
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
  /** 未送信 / 送信済み（ステップ3で使用） */
  syncStatus: 'pending' | 'synced' | 'failed';
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
  syncStatus: 'pending' | 'synced' | 'failed';
  createdBy: string;
  createdAt: string;
  deletedAt: string | null;
}
