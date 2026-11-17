import type { BoardLayout } from '../types';

/**
 * 端末ごとのちょっとした設定（表示の切り替え、黒板の配置など）。
 * localStorage が使えない環境でも動くよう、失敗は無視する
 */
function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`geoboard.${key}`);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  try {
    localStorage.setItem(`geoboard.${key}`, JSON.stringify(value));
  } catch {
    /* 保存できなくても動作に支障はない */
  }
}

export type Orientation = 'portrait' | 'landscape';

export const prefs = {
  getLayout: (o: Orientation) => read<BoardLayout | null>(`layout.${o}`, null),
  setLayout: (o: Orientation, l: BoardLayout) => write(`layout.${o}`, l),
  getListView: () => read<'list' | 'grid'>('listView', 'list'),
  setListView: (v: 'list' | 'grid') => write('listView', v),
  getListOrder: () => read<'desc' | 'asc'>('listOrder', 'desc'),
  setListOrder: (v: 'desc' | 'asc') => write('listOrder', v),
  getLedgerSort: () => read<'updated' | 'start' | 'name'>('ledgerSort', 'updated'),
  setLedgerSort: (v: 'updated' | 'start' | 'name') => write('ledgerSort', v),
  getLastLedger: () => read<string | null>('lastLedger', null),
  setLastLedger: (v: string | null) => write('lastLedger', v),
  /** 未送信の警告を出すまでの日数（要件6.8） */
  getUnsentWarnDays: () => read<number>('unsentWarnDays', 3),
  setUnsentWarnDays: (v: number) => write('unsentWarnDays', v),
  getGrid: () => read<boolean>('cameraGrid', false),
  setGrid: (v: boolean) => write('cameraGrid', v),
  getLevel: () => read<boolean>('cameraLevel', true),
  setLevel: (v: boolean) => write('cameraLevel', v),
  /** ログイン中のユーザーID（オフラインでも作成者を記録するため） */
  getUserId: () => read<string>('userId', ''),
  setUserId: (v: string) => write('userId', v),
  /** 黒板の施工者名の初期値。ログイン中はプロフィールの表示名と同期する */
  getWorkerName: () => read<string>('workerName', ''),
  setWorkerName: (v: string) => write('workerName', v),
};
