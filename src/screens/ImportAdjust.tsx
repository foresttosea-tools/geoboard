import { useEffect, useMemo, useRef, useState } from 'react';
import { SLOT_DATE, todayIsoDate } from '../blackboard/model';
import { BoardCanvas } from '../components/BoardCanvas';
import { Icon } from '../components/Icon';
import { containRect, useBoardGestures } from '../components/useBoardGestures';
import { readPhotoMeta } from '../lib/exif';
import { clampLayout, defaultLayout, loadImageToCanvas, readImageSize } from '../lib/image';
import { prefs, type Orientation } from '../lib/prefs';
import { saveCapture } from '../lib/saveRecord';
import type { GeoFix } from '../lib/sensors';
import type { BoardContent, BoardLayout, CaptureMode, Handover } from '../types';

interface Props {
  files: File[];
  ledgerId: string;
  board: BoardContent;
  mode: CaptureMode;
  handover: Handover;
  onBack: () => void;
  onDone: () => void;
}

interface Item {
  file: File;
  url: string;
  w: number;
  h: number;
  /** 黒板の撮影日（YYYY-MM-DD） */
  date: string;
  takenAt: Date | null;
  geo: GeoFix | null;
  /** Exifに撮影日時がなく、当日の日付を入れた */
  needsCheck: boolean;
  /** この写真だけの黒板配置（nullなら共通の配置を使う） */
  ownLayout: BoardLayout | null;
}

/**
 * 撮影日時：Exifがあればそれを使う。なければ選んだ日付の正午（当日のままなら現在時刻）にして、
 * 一覧の並び順が黒板の撮影日と食い違わないようにする
 */
function shotAtFor(it: { takenAt: Date | null; date: string }): string {
  if (it.takenAt) return it.takenAt.toISOString();
  if (it.date === todayIsoDate()) return new Date().toISOString();
  return new Date(`${it.date}T12:00:00`).toISOString();
}

const orientationOf = (it: { w: number; h: number }): Orientation => (it.w >= it.h ? 'landscape' : 'portrait');

/** S13 取り込み調整：端末の写真に黒板を配置して一括保存する（要件6.6） */
export function ImportAdjust({ files, ledgerId, board, mode, handover, onBack, onDone }: Props) {
  const boardOn = mode !== 'without_board';
  const [items, setItems] = useState<Item[] | null>(null);
  const [failed, setFailed] = useState(0);
  const [index, setIndex] = useState(0);
  // 縦長・横長それぞれの共通配置
  const [shared, setShared] = useState<Record<Orientation, BoardLayout | null>>({
    portrait: prefs.getLayout('portrait'),
    landscape: prefs.getLayout('landscape'),
  });
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 画像のサイズとExifを読み込む
  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    (async () => {
      const loaded: Item[] = [];
      let ng = 0;
      for (const file of files) {
        try {
          const { w, h } = await readImageSize(file);
          const meta = await readPhotoMeta(file);
          const url = URL.createObjectURL(file);
          urls.push(url);
          loaded.push({
            file,
            url,
            w,
            h,
            date: todayIsoDate(meta.takenAt ?? new Date()),
            takenAt: meta.takenAt,
            geo: meta.geo,
            needsCheck: meta.takenAt == null,
            ownLayout: null,
          });
        } catch {
          ng++;
        }
      }
      if (cancelled) return;
      // 撮影日時の古い順に並べる
      loaded.sort((a, b) => (a.takenAt?.getTime() ?? Infinity) - (b.takenAt?.getTime() ?? Infinity));
      setItems(loaded);
      setFailed(ng);
    })();
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [files]);

  const item = items?.[index] ?? null;
  const orientation = item ? orientationOf(item) : 'landscape';

  const layoutFor = (it: Item): BoardLayout =>
    clampLayout(it.ownLayout ?? shared[orientationOf(it)] ?? defaultLayout(it.w, it.h), it.w, it.h);
  const layout = item ? layoutFor(item) : null;

  const updateItem = (patch: Partial<Item>) => setItems((prev) => prev && prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));

  // 表示範囲
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const loaded = items != null;
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [loaded]);
  const rect = useMemo(() => (item ? containRect(box.w, box.h, item.w, item.h) : null), [box, item]);

  // 「この写真だけ調整」中は ownLayout を、それ以外は縦長・横長ごとの共通配置を動かす
  const applyLayout = (l: BoardLayout) => {
    if (!item) return;
    if (item.ownLayout) updateItem({ ownLayout: l });
    else setShared((s) => ({ ...s, [orientation]: l }));
  };

  const gestures = useBoardGestures({
    enabled: boardOn,
    rect,
    imageW: item?.w ?? 0,
    imageH: item?.h ?? 0,
    layout,
    onChange: applyLayout,
    onCommit: (l) => {
      if (!item?.ownLayout) prefs.setLayout(orientation, l);
    },
  });

  const boardForItem = (it: Item): BoardContent => board.map((b, i) => (i === SLOT_DATE ? { ...b, value: it.date } : b));
  const previewBoard = item ? boardForItem(item) : board;

  const saveAll = async () => {
    if (!items) return;
    setSaving({ done: 0, total: items.length });
    setError(null);
    try {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const photo = await loadImageToCanvas(it.file);
        await saveCapture({
          ledgerId,
          mode,
          board: boardForItem(it),
          handover,
          layout: boardOn ? layoutFor(it) : null,
          photo,
          geo: it.geo,
          shotAt: shotAtFor(it),
          source: 'import',
          shotDateNeedsCheck: it.needsCheck,
        });
        setSaving({ done: i + 1, total: items.length });
      }
      onDone();
    } catch (e) {
      setError(`保存に失敗しました：${(e as Error).message}`);
      setSaving(null);
    }
  };

  if (!items) {
    return (
      <div className="screen screen-dark">
        <div className="cam-loading">写真を読み込んでいます…</div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="screen">
        <header className="appbar">
          <button className="icon-btn" onClick={onBack} aria-label="戻る">
            <Icon name="back" />
          </button>
          <h1>写真から登録</h1>
          <span />
        </header>
        <p className="empty">写真を読み込めませんでした。別の写真を選んでください</p>
      </div>
    );
  }

  return (
    <div className="screen screen-dark import">
      <header className="appbar appbar-dark appbar-import">
        <button className="cam-btn cam-round" onClick={onBack} aria-label="戻る" disabled={saving != null}>
          <Icon name="back" />
        </button>
        <h1>
          写真から登録 {index + 1} / {items.length}
        </h1>
        <span />
      </header>

      <div className="import-stage" ref={boxRef} {...gestures}>
        {item && rect && (
          <div className="cam-frame" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>
            <img src={item.url} alt="" className="import-img" draggable={false} />
            {boardOn && layout && (
              <div
                className="cam-board overlay-board"
                style={{ left: layout.x * rect.width, top: layout.y * rect.height, width: layout.w * rect.width }}
              >
                <BoardCanvas board={previewBoard} width={Math.round(layout.w * rect.width)} />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="import-panel">
        {failed > 0 && <p className="hint warn-text">{failed}枚の写真を読み込めませんでした</p>}
        <div className="import-row">
          <label className="import-date">
            <span>撮影日</span>
            <input
              type="date"
              value={item?.date ?? ''}
              onChange={(e) => updateItem({ date: e.target.value, needsCheck: false })}
            />
          </label>
          {item?.needsCheck && <span className="badge badge-warn">日付要確認</span>}
          <span className="import-geo">{item?.geo ? '位置情報あり' : '位置情報なし'}</span>
        </div>
        {boardOn && (
          <div className="segmented inline dark">
            <button className={!item?.ownLayout ? 'on' : ''} onClick={() => updateItem({ ownLayout: null })}>
              全写真で共通の配置
            </button>
            <button className={item?.ownLayout ? 'on' : ''} onClick={() => item && !item.ownLayout && updateItem({ ownLayout: layoutFor(item) })}>
              この写真だけ調整
            </button>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <div className="import-nav">
          <button className="btn" disabled={index === 0 || saving != null} onClick={() => setIndex(index - 1)}>
            前の写真
          </button>
          {index < items.length - 1 ? (
            <button className="btn" disabled={saving != null} onClick={() => setIndex(index + 1)}>
              次の写真
            </button>
          ) : null}
          <button className="btn btn-primary" disabled={saving != null} onClick={saveAll}>
            {saving ? `保存中 ${saving.done}/${saving.total}` : `${items.length}枚を保存`}
          </button>
        </div>
      </div>
    </div>
  );
}
