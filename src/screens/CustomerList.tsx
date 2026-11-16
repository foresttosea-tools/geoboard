import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { db } from '../db';
import { createCustomer, normalizeForSearch, renameCustomer } from '../lib/repo';
import type { Customer } from '../types';

interface Props {
  onOpen: (customerId: string) => void;
  onSettings: () => void;
}

/** S02 顧客一覧 */
export function CustomerList({ onOpen, onSettings }: Props) {
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  const customers = useLiveQuery(() => db.customers.filter((c) => !c.deletedAt).toArray(), []);
  const ledgers = useLiveQuery(() => db.ledgers.filter((l) => !l.deletedAt).toArray(), []);

  const stats = useMemo(() => {
    const m = new Map<string, { count: number; latest: string }>();
    for (const l of ledgers ?? []) {
      const s = m.get(l.customerId) ?? { count: 0, latest: '' };
      s.count++;
      if (l.updatedAt > s.latest) s.latest = l.updatedAt;
      m.set(l.customerId, s);
    }
    return m;
  }, [ledgers]);

  const list = useMemo(() => {
    const nq = normalizeForSearch(q);
    return (customers ?? [])
      .filter((c) => !nq || normalizeForSearch(c.name).includes(nq) || (c.code ?? '').toLowerCase().includes(nq))
      .sort((a, b) => {
        // 最近使った（台帳を更新した）顧客を上に
        const la = stats.get(a.id)?.latest || a.updatedAt;
        const lb = stats.get(b.id)?.latest || b.updatedAt;
        return lb.localeCompare(la);
      });
  }, [customers, q, stats]);

  return (
    <div className="screen">
      <header className="appbar appbar-home">
        <img src={`${import.meta.env.BASE_URL}brand/logo-mark.png`} alt="" className="brand-mark" />
        <div className="appbar-title">
          <small>GeoBoard</small>
          <h1>顧客一覧</h1>
        </div>
        <div className="appbar-actions">
          <button className="icon-btn" aria-label="設定" onClick={onSettings}>
            <Icon name="settings" />
          </button>
        </div>
      </header>

      <main className="screen-body">
        <input className="search" type="search" placeholder="顧客名・顧客コードで検索" value={q} onChange={(e) => setQ(e.target.value)} />
        {customers && list.length === 0 && (
          <p className="empty">{q ? '一致する顧客がありません' : 'まだ顧客が登録されていません。\n下の「顧客を追加」から登録してください'}</p>
        )}
        <ul className="card-list">
          {list.map((c) => (
            <li key={c.id} className="card-row">
              <button className="card-main" onClick={() => onOpen(c.id)}>
                <strong>{c.name}</strong>
                <span>
                  {c.code ?? 'コード未採番'} / 台帳 {stats.get(c.id)?.count ?? 0}件
                </span>
              </button>
              <button className="icon-btn" aria-label={`${c.name}を編集`} onClick={() => setEditing(c)}>
                <Icon name="edit" size={18} />
              </button>
            </li>
          ))}
        </ul>
      </main>

      <footer className="bottombar">
        <button className="btn btn-primary btn-wide" onClick={() => setEditing('new')}>
          <Icon name="plus" />
          顧客を追加
        </button>
      </footer>

      {editing && (
        <NameSheet
          title={editing === 'new' ? '顧客を追加' : '顧客名を変更'}
          initial={editing === 'new' ? '' : editing.name}
          note={editing === 'new' ? '顧客コードは、サーバーとの同期機能ができた時点で自動で採番されます' : undefined}
          existingNames={(customers ?? []).filter((c) => editing === 'new' || c.id !== editing.id).map((c) => c.name)}
          onCancel={() => setEditing(null)}
          onSave={async (name) => {
            if (editing === 'new') {
              const c = await createCustomer(name);
              setEditing(null);
              onOpen(c.id);
            } else {
              await renameCustomer(editing.id, name);
              setEditing(null);
            }
          }}
        />
      )}
    </div>
  );
}

interface NameSheetProps {
  title: string;
  initial: string;
  note?: string;
  existingNames: string[];
  onCancel: () => void;
  onSave: (name: string) => void;
}

function NameSheet({ title, initial, note, existingNames, onCancel, onSave }: NameSheetProps) {
  const [name, setName] = useState(initial);
  const dup = existingNames.some((n) => normalizeForSearch(n) === normalizeForSearch(name));
  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <form
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSave(name);
        }}
      >
        <h2>{title}</h2>
        <label className="field">
          <span>顧客名</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：〇〇町役場" autoFocus />
        </label>
        {dup && <p className="hint warn-text">同じ名前の顧客がすでにあります。重複していないか確認してください</p>}
        {note && <p className="hint">{note}</p>}
        <div className="sheet-actions">
          <button type="button" className="btn" onClick={onCancel}>キャンセル</button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim()}>保存</button>
        </div>
      </form>
    </div>
  );
}
