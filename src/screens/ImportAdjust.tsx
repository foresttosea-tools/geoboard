import { useEffect, useMemo, useRef, useState } from 'react';
import { SLOT_DATE, todayIsoDate } from '../blackboard/model';
import { BoardCanvas } from '../components/BoardCanvas';
import { Icon } from '../components/Icon';
import { containRect, useBoardGestures } from '../components/useBoardGestures';
import { diag } from '../lib/diag';
import { readPhotoMeta } from '../lib/exif';
import { addExtraPhotos } from '../lib/extraPhotos';
import { clampLayout, defaultLayout, loadImageToCanvas, readImageSize, releaseCanvas } from '../lib/image';
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
  takenAt: Date | null;
  geo: GeoFix | null;
}

/**
 * 撮影日時：Exifがあればそれを使う。なければ選んだ日付の正午（当日のままなら現在時刻）にして、
 * 一覧の並び順が黒板の撮影日と食い違わないようにする
 */
function shotAtFor(takenAt: Date | null, date: string): string {
  if (takenAt) return takenAt.toISOString();
  if (date === todayIsoDate()) return new Date().toISOString();
  return new Date(`${date}T12:00:00`).toISOString();
}

const orientationOf = (it: { w: number; h: number }): Orientation => (it.w >= it.h ? 'landscape' : 'portrait');

/**
 * S13 取り込み調整（要件6.6）。
 * 選んだ写真から1つの作業記録を作る。1枚をメイン写真にして黒板を付け、残りは黒板なしの追加写真にする
 */
export function ImportAdjust({ files, ledgerId, board, mode, handover, onBack, onDone }: Props) {
  const boardOn = mode !== 'without_board';
  const [items, setItems] = useState<Item[] | null>(null);
  const [failed, setFailed] = useState(0);
  const [mainIndex, setMainIndex] = useState(0);
  const [layouts, setLayouts] = useState<Record<Orientation, BoardLayout | null>>({
    portrait: prefs.getLayout('portrait'),
    landscape: prefs.getLayout('landscape'),
  });
  // メイン写真の撮影日。null のときはメイン写真のExifから決める
  const [dateOverride, setDateOverride] = useState<{ index: number; date: string; confirmed: boolean } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
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
          loaded.push({ file, url, w, h, takenAt: meta.takenAt, geo: meta.geo });
        } catch {
          ng++;
        }
      }
      if (cancelled) return;
      // 撮影日時の古い順に並べ、最初の写真をメインにする
      loaded.sort((a, b) => (a.takenAt?.getTime() ?? Infinity) - (b.takenAt?.getTime() ?? Infinity));
      setItems(loaded);
      setFailed(ng);
    })();
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [files]);

  const main = items?.[mainIndex] ?? null;
  const orientation = main ? orientationOf(main) : 'landscape';
  const layout = main ? clampLayout(layouts[orientation] ?? defaultLayout(main.w, main.h), main.w, main.h) : null;

  // 撮影日：メイン写真のExif。なければ今日の日付を仮に入れて「日付要確認」にする
  const exifDate = main?.takenAt ? todayIsoDate(main.takenAt) : null;
  const override = dateOverride?.index === mainIndex ? dateOverride : null;
  const date = override?.date ?? exifDate ?? todayIsoDate();
  const needsCheck = !exifDate && !override?.confirmed;

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
  const rect = useMemo(() => (main ? containRect(box.w, box.h, main.w, main.h) : null), [box, main]);

  const gestures = useBoardGestures({
    enabled: boardOn,
    rect,
    imageW: main?.w ?? 0,
    imageH: main?.h ?? 0,
    layout,
    onChange: (l) => setLayouts((s) => ({ ...s, [orientation]: l })),
    onCommit: (l) => prefs.setLayout(orientation, l),
  });

  const boardWithDate = board.map((b, i) => (i === SLOT_DATE ? { ...b, value: date } : b));
  const extras = items ? items.filter((_, i) => i !== mainIndex) : [];

  const save = async () => {
    if (!items || !main) return;
    setError(null);
    try {
      setSaving('メイン写真を保存しています…');
      diag('import:save', { photos: items.length, mode });
      const photo = await loadImageToCanvas(main.file);
      const record = await saveCapture({
        ledgerId,
        mode,
        board: boardWithDate,
        handover,
        layout: boardOn ? layout : null,
        photo,
        geo: main.geo,
        shotAt: shotAtFor(main.takenAt, date),
        source: 'import',
        shotDateNeedsCheck: needsCheck,
      });
      releaseCanvas(photo);
      if (extras.length > 0) {
        setSaving(`追加写真を保存しています（${extras.length}枚）…`);
        const { failed: ng } = await addExtraPhotos(
          record.id,
          extras.map((x) => x.file),
          'import',
        );
        if (ng > 0) diag('import:extra-failed', ng);
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
        <h1>{items.length > 1 ? `写真から登録（${items.length}枚で1件）` : '写真から登録'}</h1>
        <span />
      </header>

      <div className="import-stage" ref={boxRef} {...gestures}>
        {main && rect && (
          <div className="cam-frame" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>
            <img src={main.url} alt="メイン写真" className="import-img" draggable={false} />
            {boardOn && layout && (
              <div className="cam-board overlay-board" style={{ left: layout.x * rect.width, top: layout.y * rect.height, width: layout.w * rect.width }}>
                <BoardCanvas board={boardWithDate} width={Math.round(layout.w * rect.width)} />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="import-panel">
        {failed > 0 && <p className="hint warn-text">{failed}枚の写真を読み込めませんでした</p>}

        {items.length > 1 && (
          <div className="import-strip-wrap">
            <p className="import-strip-label">タップしてメイン写真を選ぶ（{boardOn ? '黒板が付くのはメイン写真だけ。' : ''}ほかは追加写真になります）</p>
            <ul className="import-strip">
              {items.map((it, i) => (
                <li key={it.url}>
                  <button
                    type="button"
                    className={`import-thumb ${i === mainIndex ? 'is-main' : ''}`}
                    onClick={() => setMainIndex(i)}
                    disabled={saving != null}
                    aria-label={i === mainIndex ? `メイン写真（${i + 1}枚目）` : `${i + 1}枚目をメイン写真にする`}
                    aria-pressed={i === mainIndex}
                  >
                    <img src={it.url} alt="" />
                    <span>{i === mainIndex ? 'メイン' : '追加'}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="import-row">
          <label className={`import-date ${needsCheck ? 'needs-check' : ''}`}>
            <span>撮影日</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDateOverride({ index: mainIndex, date: e.target.value, confirmed: true })}
            />
          </label>
          {needsCheck && <span className="import-check-badge">日付要確認</span>}
          {needsCheck && (
            <button type="button" className="import-check-ok" onClick={() => setDateOverride({ index: mainIndex, date, confirmed: true })}>
              この日付でOK
            </button>
          )}
          <span className="import-geo">{main?.geo ? '位置情報あり' : '位置情報なし'}</span>
        </div>
        {needsCheck && <p className="import-check-hint">写真から撮影日を読み取れませんでした。撮影日をタップして確認してください（今日の日付が仮に入っています）</p>}

        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary btn-wide" disabled={saving != null} onClick={save}>
          {saving ?? (extras.length > 0 ? `保存（メイン1枚＋追加写真${extras.length}枚）` : '保存')}
        </button>
      </div>
    </div>
  );
}
