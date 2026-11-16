import type { Handover } from '../types';

interface Props {
  value: Handover;
  onChange: (h: Handover) => void;
}

/** 次回への引継ぎ事項（黒板には載せない。レポートへの掲載は記録ごとに選ぶ） */
export function HandoverField({ value, onChange }: Props) {
  return (
    <section className="handover">
      <label className="field">
        <span>次回への引継ぎ事項（黒板には表示されません）</span>
        <textarea rows={3} value={value.text} onChange={(e) => onChange({ ...value, text: e.target.value })} placeholder="例：バッテリー電圧の再測定" />
      </label>
      <label className="check">
        <input type="checkbox" checked={value.inReport} onChange={(e) => onChange({ ...value, inReport: e.target.checked })} />
        レポートに載せる
      </label>
    </section>
  );
}
