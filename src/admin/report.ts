import { BOARD_SLOTS, SLOT_DATE, SLOT_WORKER, formatBoardDate } from '../blackboard/model';
import { formatShotDate } from '../components/RecordMarks';
import { formatTerm } from '../lib/repo';
import { loadImageBlob } from '../sync/images';
import type { Customer, Ledger, WorkRecord } from '../types';

/** 施工会社（アプリに固定。要件8.2） */
export const COMPANY_NAME = '株式会社フォレストシー';

export interface ReportOptions {
  /** true：黒板ありの写真を載せる / false：黒板なしの写真を載せる（ない場合はある方） */
  withBoard: boolean;
}

const PHOTO_W = 290;
const PHOTO_H = 200;
const IMAGE_MAX = 1400;

const abs = (p: string) => new URL(`${import.meta.env.BASE_URL}${p}`, location.href).href;

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** PDFに載せる大きさに縮小したJPEG（ファイルサイズを抑えるため） */
async function shrinkToDataUrl(blob: Blob): Promise<{ data: string; w: number; h: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, IMAGE_MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('Canvasが使用できません');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const data = c.toDataURL('image/jpeg', 0.85);
    c.width = 0;
    c.height = 0;
    return { data, w: img.naturalWidth, h: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 記録に載せる写真（黒板あり／なしの選択に従い、なければある方） */
export async function reportImageBlob(r: WorkRecord, withBoard: boolean): Promise<Blob | null> {
  const composite = () => loadImageBlob(`${r.id}:composite`, r.compositePath);
  const original = () => loadImageBlob(`${r.id}:original`, r.originalPath);
  const first = withBoard ? composite : original;
  const second = withBoard ? original : composite;
  return (await first().catch(() => null)) ?? (await second().catch(() => null));
}

const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** 写真の右側に並べる入力内容（要件8.2） */
function infoRows(r: WorkRecord): [string, string][] {
  const rows: [string, string][] = [];
  if (r.board) {
    // 顧客名は表紙にあるので省略し、黒板の項目名をそのまま使う
    r.board.forEach((it, i) => {
      if (i === 0) return;
      const label = it.label || BOARD_SLOTS[i]?.defaultLabel || '';
      const value = i === SLOT_DATE ? formatBoardDate(it.value) : it.value;
      rows.push([label, value || '—']);
    });
  } else {
    rows.push(['撮影日', formatShotDate(r)]);
  }
  if (r.latitude != null && r.longitude != null) rows.push(['位置', `${r.latitude.toFixed(6)}, ${r.longitude.toFixed(6)}`]);
  if (r.memo.trim()) rows.push(['メモ', r.memo.trim()]);
  if (r.handoverInReport && r.handover.trim()) rows.push(['次回への引継ぎ事項', r.handover.trim()]);
  return rows;
}

export interface ReportInput {
  customer: Customer;
  ledger: Ledger;
  records: WorkRecord[];
  options: ReportOptions;
  onProgress?: (done: number, total: number) => void;
}

/** PDFレポートを作る（要件8.2）。日本語フォントは初回だけ読み込む */
export async function buildReportPdf({ customer, ledger, records, options, onProgress }: ReportInput): Promise<Blob> {
  const pdfMakeModule = await import('pdfmake/build/pdfmake');
  const pdfMake = (pdfMakeModule as unknown as { default: PdfMakeLike }).default ?? (pdfMakeModule as unknown as PdfMakeLike);
  const font = abs('fonts/NotoSansJP-Regular.ttf');
  pdfMake.addFonts({ NotoSansJP: { normal: font, bold: font, italics: font, bolditalics: font } });
  pdfMake.setUrlAccessPolicy((url: string) => url === font);

  const logo = await fetch(abs('brand/logo-horizontal.png'))
    .then((r) => r.blob())
    .then(blobToDataUrl)
    .catch(() => null);

  // 写真の準備
  const photos: ({ data: string; w: number; h: number } | null)[] = [];
  for (let i = 0; i < records.length; i++) {
    const blob = await reportImageBlob(records[i], options.withBoard);
    photos.push(blob ? await shrinkToDataUrl(blob) : null);
    onProgress?.(i + 1, records.length);
  }

  const today = new Date();
  const outputDate = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;

  const coverRows: [string, string][] = [
    ['顧客名', customer.name + (customer.code ? `（${customer.code}）` : '')],
    ['工事名称', ledger.name],
    ['工期', formatTerm(ledger)],
    ['工事責任者', ledger.manager || '—'],
    ['施工会社', COMPANY_NAME],
    ['写真枚数', `${records.length}枚`],
    ['出力日', outputDate],
  ];

  const content: unknown[] = [
    { text: '工事写真台帳', fontSize: 28, alignment: 'center', margin: [0, 150, 0, 40], characterSpacing: 4 },
    {
      table: {
        widths: [90, '*'],
        body: coverRows.map(([k, v]) => [
          { text: k, color: '#555555', margin: [6, 6, 6, 6] },
          { text: v, fontSize: 12, margin: [6, 5, 6, 5] },
        ]),
      },
      layout: { hLineColor: () => '#bbbbbb', vLineColor: () => '#bbbbbb' },
      margin: [40, 0, 40, 0],
    },
    ...(logo ? [{ image: logo, fit: [220, 60], alignment: 'center', margin: [0, 120, 0, 0] }] : []),
    { text: COMPANY_NAME, alignment: 'center', margin: [0, 8, 0, 0], color: '#333333' },
  ];

  records.forEach((r, i) => {
    const photo = photos[i];
    const worker = r.board?.[SLOT_WORKER]?.value;
    const caption = `${i + 1}. 撮影日時 ${fmtDateTime(r.shotAt)}${worker ? ` ／ 施工者 ${worker}` : ''}`;
    const row = {
      unbreakable: true,
      pageBreak: i % 3 === 0 ? 'before' : undefined,
      margin: [0, i % 3 === 0 ? 0 : 14, 0, 0],
      columns: [
        {
          width: PHOTO_W,
          stack: [
            photo
              ? { table: { widths: [PHOTO_W - 2], heights: [PHOTO_H], body: [[{ image: photo.data, fit: [PHOTO_W - 10, PHOTO_H - 10], alignment: 'center' }]] }, layout: { hLineColor: () => '#cccccc', vLineColor: () => '#cccccc', paddingTop: () => 4, paddingBottom: () => 0 } }
              : { table: { widths: [PHOTO_W - 2], heights: [PHOTO_H], body: [[{ text: '写真を取得できませんでした', alignment: 'center', color: '#999999', margin: [0, 90, 0, 0] }]] } },
            { text: caption, fontSize: 8, color: '#555555', margin: [0, 3, 0, 0] },
          ],
        },
        {
          width: '*',
          table: {
            widths: [62, '*'],
            body: infoRows(r).map(([k, v]) => [
              { text: k, fontSize: 8, color: '#555555', fillColor: '#f3f5f5' },
              { text: v, fontSize: 9 },
            ]),
          },
          layout: { hLineColor: () => '#cccccc', vLineColor: () => '#cccccc', paddingTop: () => 3, paddingBottom: () => 3 },
          margin: [10, 0, 0, 0],
        },
      ],
      columnGap: 0,
    };
    content.push(row);
  });

  const docDefinition = {
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: [36, 48, 36, 44],
    info: { title: `工事写真台帳 ${ledger.name}`, author: COMPANY_NAME },
    defaultStyle: { font: 'NotoSansJP', fontSize: 9, lineHeight: 1.25 },
    header: (page: number) =>
      page === 1 ? null : { columns: [{ text: `${customer.name}　${ledger.name}`, fontSize: 8, color: '#666666' }, { text: '工事写真台帳', fontSize: 8, color: '#666666', alignment: 'right' }], margin: [36, 20, 36, 0] },
    footer: (page: number, count: number) => ({ text: `${page} / ${count}`, alignment: 'center', fontSize: 8, color: '#666666', margin: [0, 14, 0, 0] }),
    content,
  };

  return pdfMake.createPdf(docDefinition).getBlob();
}

interface PdfMakeLike {
  addFonts(fonts: Record<string, Record<string, string>>): void;
  setUrlAccessPolicy(fn: (url: string) => boolean): void;
  createPdf(def: unknown): { getBlob(): Promise<Blob> };
}
