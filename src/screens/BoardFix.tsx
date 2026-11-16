import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { normalizeBoard } from '../blackboard/model';
import { BoardCanvas } from '../components/BoardCanvas';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Icon } from '../components/Icon';
import { useElementWidth } from '../components/useElementWidth';
import { db } from '../db';
import { fixRecordBoard } from '../lib/editRecord';
import type { BoardContent } from '../types';
import { ItemEditSheet } from './BoardEditor';

interface Props {
  recordId: string;
  onBack: () => void;
}

/** 保存済みの記録の黒板を修正し、写真を作り直す（「両方」で保存した記録のみ） */
export function BoardFix({ recordId, onBack }: Props) {
  const record = useLiveQuery(() => db.records.get(recordId), [recordId]);
  const [draft, setDraft] = useState<BoardContent | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();

  const saved = normalizeBoard(record?.board);
  const board = draft ?? saved;
  const dirty = draft != null && JSON.stringify(draft) !== JSON.stringify(saved);

  const save = async () => {
    if (!record || !board) return;
    setSaving(true);
    setError(null);
    try {
      await fixRecordBoard(record, board);
      onBack();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="screen">
      <header className="appbar">
        <button className="icon-btn" onClick={() => (dirty ? setConfirmLeave(true) : onBack())} aria-label="戻る">
          <Icon name="back" />
        </button>
        <h1>黒板を修正</h1>
        <span />
      </header>
      <main className="screen-body">
        <div ref={wrapRef} className="board-wrap">
          {board && width > 0 && <BoardCanvas board={board} width={width} onSlotTap={setEditing} className="board-canvas" />}
        </div>
        <p className="hint">項目をタップして修正してください。保存すると、黒板なしの原本に修正後の黒板を重ねて写真を作り直します</p>
        {error && <p className="hint danger">{error}</p>}
      </main>
      <footer className="bottombar">
        <button className="btn btn-primary btn-wide" disabled={!dirty || saving} onClick={save}>
          {saving ? '写真を作り直しています…' : '修正を保存'}
        </button>
      </footer>

      {editing != null && board && (
        <ItemEditSheet
          slot={editing}
          board={board}
          onCancel={() => setEditing(null)}
          onApply={(label, value) => {
            setDraft(board.map((it, i) => (i === editing ? { label, value } : it)));
            setEditing(null);
          }}
        />
      )}
      {confirmLeave && (
        <ConfirmDialog
          title="修正が保存されていません"
          message="黒板の修正内容は破棄されます。戻ってもよろしいですか？"
          onDismiss={() => setConfirmLeave(false)}
          actions={[
            { label: '保存して戻る', variant: 'primary', onClick: () => { setConfirmLeave(false); save(); } },
            { label: '保存せずに戻る', variant: 'danger', onClick: onBack },
            { label: 'キャンセル', onClick: () => setConfirmLeave(false) },
          ]}
        />
      )}
    </div>
  );
}
