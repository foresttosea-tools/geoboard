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
  getGrid: () => read<boolean>('cameraGrid', false),
  setGrid: (v: boolean) => write('cameraGrid', v),
  getLevel: () => read<boolean>('cameraLevel', true),
  setLevel: (v: boolean) => write('cameraLevel', v),
  /** ログイン機能（ステップ3）ができるまでの仮の施工者名 */
  getWorkerName: () => read<string>('workerName', ''),
  setWorkerName: (v: string) => write('workerName', v),
};
