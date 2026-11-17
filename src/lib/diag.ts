/**
 * 診断ログ。不具合が起きたときに原因を調べるため、主な処理の段階とエラーを端末に記録する。
 * アプリを開き直しても残るよう localStorage に保存し、設定画面からコピーできる
 */

interface DiagEntry {
  t: string;
  e: string;
  d?: string;
}

const KEY = 'geoboard.diag';
const MAX = 300;
let buffer: DiagEntry[] = load();

function load(): DiagEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]') as DiagEntry[];
  } catch {
    return [];
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function persist() {
  clearTimeout(saveTimer);
  // まとめて書き込む（ただし固まる直前の記録も残るよう短い間隔で）
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(buffer.slice(-MAX)));
    } catch {
      /* 保存できない環境では記録しない */
    }
  }, 50);
}

export function diag(event: string, detail?: unknown) {
  const d = detail === undefined ? undefined : typeof detail === 'string' ? detail : safeJson(detail);
  buffer.push({ t: new Date().toISOString(), e: event, d: d?.slice(0, 500) });
  if (buffer.length > MAX) buffer = buffer.slice(-MAX);
  persist();
}

/** 処理の所要時間を記録する */
export async function diagStep<T>(event: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  diag(`${event}:start`);
  try {
    const r = await fn();
    diag(`${event}:done`, `${Math.round(performance.now() - start)}ms`);
    return r;
  } catch (e) {
    diag(`${event}:error`, e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    throw e;
  }
}

function safeJson(v: unknown) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function diagText(): string {
  const head = [
    `GeoBoard v${__APP_VERSION__} (${__BUILD_COMMIT__})`,
    navigator.userAgent,
    `画面 ${window.innerWidth}x${window.innerHeight} / ${window.matchMedia('(display-mode: standalone)').matches ? 'ホーム画面' : 'ブラウザ'}`,
  ];
  return [...head, '', ...buffer.map((x) => `${x.t.slice(11, 23)} ${x.e}${x.d ? ` ${x.d}` : ''}`)].join('\n');
}

export function clearDiag() {
  buffer = [];
  persist();
}

/** アプリ全体のエラーを記録する */
export function installDiagHandlers() {
  diag('app:start', { v: __APP_VERSION__, c: __BUILD_COMMIT__ });
  window.addEventListener('error', (e) => diag('error', `${e.message} @${e.filename?.split('/').pop()}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { name?: string; message?: string } | undefined;
    diag('unhandledrejection', r?.message ? `${r.name}: ${r.message}` : String(e.reason));
  });
  document.addEventListener('visibilitychange', () => diag('visibility', document.visibilityState));
  // メインスレッドが長く止まった記録（対応しているブラウザのみ）
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (entry.duration > 1000) diag('longtask', `${Math.round(entry.duration)}ms`);
    }).observe({ type: 'longtask', buffered: false });
  } catch {
    /* 未対応 */
  }
}
