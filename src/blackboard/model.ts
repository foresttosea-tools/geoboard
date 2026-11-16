import type { BoardContent } from '../types';

export type SlotKind = 'single' | 'multi' | 'date';

/** 黒板の8枠の定義（レイアウト固定。要件6.4） */
export const BOARD_SLOTS: { defaultLabel: string; kind: SlotKind; rows: number }[] = [
  { defaultLabel: '顧客名', kind: 'single', rows: 1 },
  { defaultLabel: '作業場所', kind: 'single', rows: 1 },
  { defaultLabel: '作業内容', kind: 'single', rows: 1 },
  { defaultLabel: '機材（通信機器 / 電源）', kind: 'single', rows: 1 },
  { defaultLabel: '撮影日', kind: 'date', rows: 1 },
  { defaultLabel: '備考', kind: 'multi', rows: 2 },
  { defaultLabel: '次回への引継ぎ事項', kind: 'multi', rows: 2 },
  { defaultLabel: '施工者名', kind: 'single', rows: 1 },
];

export const SLOT_CUSTOMER = 0;
export const SLOT_DATE = 4;
export const SLOT_WORKER = 7;

/** YYYY-MM-DD（input[type=date] 形式） */
export function todayIsoDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 黒板表示用の日付（YYYY/MM/DD） */
export function formatBoardDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : iso;
}

export function createDefaultBoard(opts: { customerName?: string; worker?: string } = {}): BoardContent {
  return BOARD_SLOTS.map((slot, i) => ({
    label: slot.defaultLabel,
    value:
      i === SLOT_CUSTOMER
        ? (opts.customerName ?? '')
        : i === SLOT_DATE
          ? todayIsoDate()
          : i === SLOT_WORKER
            ? (opts.worker ?? '')
            : '',
  }));
}

/** 前回の黒板や作成した黒板を呼び出すとき、撮影日だけ当日に差し替える */
export function withToday(board: BoardContent): BoardContent {
  return board.map((item, i) => (i === SLOT_DATE ? { ...item, value: todayIsoDate() } : { ...item }));
}

/** 保存データの枠数が足りない場合などに8枠へ正規化する */
export function normalizeBoard(board: BoardContent | null | undefined): BoardContent | null {
  if (!board) return null;
  return BOARD_SLOTS.map((slot, i) => ({
    label: board[i]?.label ?? slot.defaultLabel,
    value: board[i]?.value ?? '',
  }));
}
