import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { formatShotDate } from '../components/RecordMarks';
import { db } from '../db';
import { confirmProvisionalCustomer, linkProvisionalCustomer, restoreItem } from '../lib/repo';
import type { Customer } from '../types';

/** P08 仮顧客の処理（管理者。要件6.1） */
export function ProvisionalPane() {
  const customers = useLiveQuery(() => db.customers.filter((c) => !c.deletedAt).toArray(), []);
  const ledgers = useLiveQuery(() => db.ledgers.filter((l) => !l.deletedAt).toArray(), []);
  const provisional = (customers ?? []).filter((c) => c.isProvisional);
  const regular = (customers ?? []).filter((c) => !c.isProvisional).sort((a, b) => a.name.localeCompare(b.name, 'ja'));

  return (
    <div className="admin-page narrow">
      <h1>仮顧客の処理</h1>
      <p className="hint">圏外で作られた仮顧客です。既存の顧客と同じなら「紐づける」、新しい顧客なら「正式な顧客として登録」を選んでください。登録すると、送信した時点で顧客コードが採番されます</p>
      {customers && provisional.length === 0 && <p className="empty">処理が必要な仮顧客はありません</p>}
      <ul className="admin-stack">
        {provisional.map((c) => (
          <ProvisionalItem key={c.id} c={c} regular={regular} ledgerCount={(ledgers ?? []).filter((l) => l.customerId === c.id).length} />
        ))}
      </ul>
    </div>
  );
}

function ProvisionalItem({ c, regular, ledgerCount }: { c: Customer; regular: Customer[]; ledgerCount: number }) {
  const [name, setName] = useState(c.name);
  const [target, setTarget] = useState('');
  const similar = useMemo(() => regular.filter((r) => r.name.includes(c.name) || c.name.includes(r.name)).map((r) => r.id), [regular, c.name]);
  return (
    <li className="card">
      <h2>
        <span className="badge badge-warn">仮</span> {c.name}
      </h2>
      <p className="hint">
        台帳 {ledgerCount}件・作成 {new Date(c.createdAt).toLocaleString('ja-JP')}
      </p>
      <div className="admin-form-row">
        <label className="field">
          <span>既存の顧客に紐づける</span>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">顧客を選ぶ</option>
            {regular.map((r) => (
              <option key={r.id} value={r.id}>
                {similar.includes(r.id) ? '★ ' : ''}
                {r.name}
                {r.code ? `（${r.code}）` : ''}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn btn-primary"
          disabled={!target}
          onClick={async () => {
            const t = regular.find((r) => r.id === target);
            if (t && confirm(`仮顧客「${c.name}」の台帳${ledgerCount}件を「${t.name}」に移して、仮顧客を統合しますか？`)) await linkProvisionalCustomer(c.id, t.id);
          }}
        >
          紐づける
        </button>
      </div>
      <div className="admin-form-row">
        <label className="field">
          <span>正式な顧客として登録（顧客名を確認）</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="btn" disabled={!name.trim()} onClick={() => confirmProvisionalCustomer(c.id, name)}>
          正式な顧客として登録
        </button>
      </div>
      {similar.length > 0 && <p className="hint warn-text">★ は名前が似ている既存の顧客です</p>}
    </li>
  );
}

/** P11 削除済みデータ（管理者。要件4.3） */
export function DeletedPane() {
  const customers = useLiveQuery(() => db.customers.filter((c) => !!c.deletedAt && !c.mergedInto).toArray(), []);
  const ledgers = useLiveQuery(() => db.ledgers.filter((l) => !!l.deletedAt).toArray(), []);
  const records = useLiveQuery(() => db.records.filter((r) => !!r.deletedAt).toArray(), []);
  const allLedgers = useLiveQuery(() => db.ledgers.toArray(), []);
  const allCustomers = useLiveQuery(() => db.customers.toArray(), []);
  const ledgerName = (id: string) => allLedgers?.find((l) => l.id === id)?.name ?? '（不明な台帳）';
  const customerName = (id: string) => allCustomers?.find((c) => c.id === id)?.name ?? '（不明な顧客）';
  const byDeleted = <T extends { deletedAt: string | null }>(a: T, b: T) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? '');

  return (
    <div className="admin-page narrow">
      <h1>削除済みデータ</h1>
      <p className="hint">削除した顧客・台帳・作業記録を元に戻せます。元に戻すと、全員の端末に再び表示されます</p>

      <h2 className="admin-section">顧客（{customers?.length ?? 0}）</h2>
      <table className="admin-table">
        <tbody>
          {[...(customers ?? [])].sort(byDeleted).map((c) => (
            <tr key={c.id}>
              <td className="strong">{c.name}</td>
              <td>{c.code ?? ''}</td>
              <td>削除 {new Date(c.deletedAt!).toLocaleString('ja-JP')}</td>
              <td className="row-actions-cell">
                <button className="btn" onClick={() => restoreItem('customer', c.id)}>元に戻す</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="admin-section">台帳（{ledgers?.length ?? 0}）</h2>
      <table className="admin-table">
        <tbody>
          {[...(ledgers ?? [])].sort(byDeleted).map((l) => (
            <tr key={l.id}>
              <td className="strong">{l.name}</td>
              <td>{customerName(l.customerId)}</td>
              <td>削除 {new Date(l.deletedAt!).toLocaleString('ja-JP')}</td>
              <td className="row-actions-cell">
                <button className="btn" onClick={() => restoreItem('ledger', l.id)}>元に戻す</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="admin-section">作業記録（{records?.length ?? 0}）</h2>
      <table className="admin-table">
        <tbody>
          {[...(records ?? [])].sort(byDeleted).map((r) => (
            <tr key={r.id}>
              <td className="strong">
                {formatShotDate(r)} {r.board?.[1]?.value || '（作業場所なし）'}
              </td>
              <td>{ledgerName(r.ledgerId)}</td>
              <td>削除 {new Date(r.deletedAt!).toLocaleString('ja-JP')}</td>
              <td className="row-actions-cell">
                <button className="btn" onClick={() => restoreItem('record', r.id)}>元に戻す</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
