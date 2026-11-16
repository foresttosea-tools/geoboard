import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { db, nowIso } from '../db';
import type { BoardTemplate } from '../types';

interface Props {
  onBack: () => void;
  onPick: (t: BoardTemplate) => void;
}

export function TemplateList({ onBack, onPick }: Props) {
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const [q, setQ] = useState('');
  const templates = useLiveQuery(() => db.templates.toArray(), []);

  const list = useMemo(() => {
    const filtered = (templates ?? []).filter((t) => !q || t.name.includes(q));
    return filtered.sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name, 'ja') : b.lastUsedAt.localeCompare(a.lastUsedAt)));
  }, [templates, q, sort]);

  return (
    <div className="screen">
      <header className="appbar">
        <button className="icon-btn" onClick={onBack} aria-label="戻る">←</button>
        <h1>作成した黒板</h1>
        <span />
      </header>
      <main className="screen-body">
        <div className="toolbar">
          <input className="search" type="search" placeholder="名前で検索" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={sort} onChange={(e) => setSort(e.target.value as 'recent' | 'name')}>
            <option value="recent">最近使った順</option>
            <option value="name">名前順</option>
          </select>
        </div>
        {templates && list.length === 0 && (
          <p className="empty">{q ? '一致する黒板がありません' : 'まだ保存された黒板がありません。黒板編集画面の「この黒板を保存」から追加できます'}</p>
        )}
        <ul className="tpl-list">
          {list.map((t) => (
            <li key={t.id}>
              <button
                className="tpl-item"
                onClick={async () => {
                  await db.templates.update(t.id, { lastUsedAt: nowIso() });
                  onPick(t);
                }}
              >
                <strong>{t.name}</strong>
                <span>{t.content[2]?.value || t.content[1]?.value || '（内容なし）'}</span>
              </button>
              <button
                className="icon-btn danger"
                aria-label={`${t.name}を削除`}
                onClick={async () => {
                  if (confirm(`「${t.name}」を削除しますか？`)) await db.templates.delete(t.id);
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
