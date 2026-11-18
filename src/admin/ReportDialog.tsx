import { useEffect, useMemo, useState } from 'react';
import { formatShotDate } from '../components/RecordMarks';
import { todayIsoDate } from '../blackboard/model';
import { useImageUrl } from '../sync/images';
import type { Customer, Ledger, WorkRecord } from '../types';
import { buildReportPdf } from './report';
import { fileSafe, saveBlob } from './zip';

interface Props {
  customer: Customer;
  ledger: Ledger;
  records: WorkRecord[];
  onClose: () => void;
}

const dayOf = (r: WorkRecord) => todayIsoDate(new Date(r.shotAt));

/** P06 レポート出力（要件8.2） */
export function ReportDialog({ customer, ledger, records, onClose }: Props) {
  const days = records.map(dayOf).sort();
  const [from, setFrom] = useState(days[0] ?? '');
  const [to, setTo] = useState(days[days.length - 1] ?? '');
  const [withBoard, setWithBoard] = useState(true);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; blob: Blob } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inRange = useMemo(() => records.filter((r) => (!from || dayOf(r) >= from) && (!to || dayOf(r) <= to)), [records, from, to]);
  const selected = inRange.filter((r) => !excluded.has(r.id));

  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url);
  }, [result]);

  const toggle = (id: string) =>
    setExcluded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const filename = `工事写真台帳_${fileSafe(customer.name)}_${fileSafe(ledger.name)}.pdf`;

  return (
    <div className="admin-modal-backdrop" onClick={progress ? undefined : onClose}>
      <div className="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="report-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="report-title">PDFレポート</h2>
        <p className="hint">
          {customer.name}／{ledger.name}。A4縦、表紙のあとに1ページ3枚の写真と入力内容を載せます。引継ぎ事項は「レポートに載せる」にした記録だけ載ります
        </p>
        <div className="report-options">
          <label className="field">
            <span>撮影日（から）</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field">
            <span>撮影日（まで）</span>
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </label>
          <fieldset className="report-board">
            <legend>載せる写真</legend>
            <label>
              <input type="radio" checked={withBoard} onChange={() => setWithBoard(true)} /> 黒板あり
            </label>
            <label>
              <input type="radio" checked={!withBoard} onChange={() => setWithBoard(false)} /> 黒板なし（ない記録は黒板あり）
            </label>
          </fieldset>
        </div>
        <div className="report-list-head">
          <span>
            載せる記録 {selected.length} / {inRange.length}件
          </span>
          <button className="text-btn" onClick={() => setExcluded(new Set())}>
            すべて選ぶ
          </button>
          <button className="text-btn" onClick={() => setExcluded(new Set(inRange.map((r) => r.id)))}>
            すべて外す
          </button>
        </div>
        <ul className="report-list">
          {inRange.map((r) => (
            <li key={r.id}>
              <label className={excluded.has(r.id) ? 'off' : ''}>
                <input type="checkbox" checked={!excluded.has(r.id)} onChange={() => toggle(r.id)} />
                <ReportThumb r={r} />
                <span>
                  <strong>{formatShotDate(r)}</strong> {r.board?.[1]?.value || '（作業場所なし）'}
                </span>
              </label>
            </li>
          ))}
        </ul>
        {error && <p className="hint danger">{error}</p>}
        <div className="dialog-actions row">
          <button className="btn" onClick={onClose} disabled={progress != null}>
            閉じる
          </button>
          {result ? (
            <>
              <a className="btn" href={result.url} target="_blank" rel="noopener">
                PDFを開く
              </a>
              <button className="btn btn-primary" onClick={() => saveBlob(result.blob, filename)}>
                ダウンロード
              </button>
            </>
          ) : (
            <button
              className="btn btn-primary"
              disabled={selected.length === 0 || progress != null}
              onClick={async () => {
                setError(null);
                setProgress('準備しています…');
                try {
                  const blob = await buildReportPdf({
                    customer,
                    ledger,
                    records: selected,
                    options: { withBoard },
                    onProgress: (d, t) => setProgress(`写真を読み込んでいます（${d}/${t}）…`),
                  });
                  setResult({ url: URL.createObjectURL(blob), blob });
                } catch (e) {
                  setError(`PDFを作成できませんでした：${(e as Error).message}`);
                } finally {
                  setProgress(null);
                }
              }}
            >
              {progress ?? 'PDFを作成'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ReportThumb({ r }: { r: WorkRecord }) {
  const { url } = useImageUrl(`${r.id}:thumb`, r.thumbPath, { persist: { recordId: r.id, kind: 'thumb' } });
  return <span className="report-thumb">{url && <img src={url} alt="" />}</span>;
}
