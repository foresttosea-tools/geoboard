import { useState } from 'react';
import { Icon } from '../components/Icon';
import type { LedgerInput } from '../lib/repo';

interface Props {
  title: string;
  customerName: string;
  initial?: LedgerInput;
  onBack: () => void;
  onSave: (input: LedgerInput) => Promise<void>;
  /** 台帳の削除（管理者のみ。編集時） */
  onDelete?: () => void;
  /** 変更履歴を開く（編集時） */
  onHistory?: () => void;
}

const EMPTY: LedgerInput = { name: '', startDate: '', endDate: '', manager: '', note: '' };

/** S06 台帳登録・編集 */
export function LedgerForm({ title, customerName, initial, onBack, onSave, onDelete, onHistory }: Props) {
  const [v, setV] = useState<LedgerInput>(initial ?? EMPTY);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof LedgerInput>(k: K, value: LedgerInput[K]) => setV({ ...v, [k]: value });

  const termError = v.startDate && v.endDate && v.endDate < v.startDate ? '終了日が開始日より前になっています' : null;
  const canSave = v.name.trim() !== '' && !termError && !saving;

  return (
    <div className="screen">
      <header className="appbar">
        <button className="icon-btn" onClick={onBack} aria-label="戻る">
          <Icon name="back" />
        </button>
        <h1>{title}</h1>
        {onHistory ? (
          <button type="button" className="icon-btn" aria-label="変更履歴" onClick={onHistory}>
            <Icon name="history" />
          </button>
        ) : (
          <span />
        )}
      </header>
      <form
        className="screen-body form-body"
        id="ledger-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!canSave) return;
          setSaving(true);
          try {
            await onSave(v);
          } finally {
            setSaving(false);
          }
        }}
      >
        <p className="form-context">
          <span>顧客</span>
          {customerName}
        </p>
        <label className="field">
          <span>工事名称（必須）</span>
          <input value={v.name} onChange={(e) => set('name', e.target.value)} placeholder="例：インフラ設置工事" autoFocus={!initial} />
        </label>
        <div className="field-row">
          <label className="field">
            <span>工事開始日</span>
            <input type="date" value={v.startDate} onChange={(e) => set('startDate', e.target.value)} />
          </label>
          <label className="field">
            <span>工事終了日</span>
            <input type="date" value={v.endDate} min={v.startDate || undefined} onChange={(e) => set('endDate', e.target.value)} />
          </label>
        </div>
        {termError && <p className="hint danger">{termError}</p>}
        <label className="field">
          <span>工事責任者</span>
          <input value={v.manager} onChange={(e) => set('manager', e.target.value)} placeholder="例：芦田" />
        </label>
        <label className="field">
          <span>備考</span>
          <textarea rows={4} value={v.note} onChange={(e) => set('note', e.target.value)} />
        </label>
        {onDelete && (
          <button type="button" className="btn btn-danger btn-wide sheet-delete" onClick={onDelete}>
            この台帳を削除（管理者）
          </button>
        )}
      </form>
      <footer className="bottombar">
        <button type="submit" form="ledger-form" className="btn btn-primary btn-wide" disabled={!canSave}>
          {saving ? '保存中…' : '保存'}
        </button>
      </footer>
    </div>
  );
}
