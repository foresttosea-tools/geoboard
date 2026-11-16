import { useState } from 'react';
import { BOARD_SLOTS } from '../blackboard/model';
import { BoardCanvas } from '../components/BoardCanvas';
import { useElementWidth } from '../components/useElementWidth';
import { db, newId, nowIso } from '../db';
import { prefs } from '../lib/prefs';
import { HandoverField } from '../components/HandoverField';
import type { BoardContent, CaptureMode, Handover } from '../types';
import { Icon } from '../components/Icon';

interface Props {
  board: BoardContent;
  onBoardChange: (b: BoardContent) => void;
  mode: CaptureMode;
  onModeChange: (m: CaptureMode) => void;
  handover: Handover;
  onHandoverChange: (h: Handover) => void;
  onBack: () => void;
  onOpenTemplates: () => void;
  onNext: () => void;
  /** 次へ進むボタンの文言 */
  nextLabel?: string;
  /** 撮影日についての補足（写真から登録するとき） */
  dateHint?: string;
}

export function BoardEditor({ board, onBoardChange, mode, onModeChange, handover, onHandoverChange, onBack, onOpenTemplates, onNext, nextLabel = '撮影に進む', dateHint }: Props) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const [editing, setEditing] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const boardOn = mode !== 'without_board';

  return (
    <div className="screen">
      <header className="appbar">
        <button className="icon-btn" onClick={onBack} aria-label="戻る"><Icon name="back" /></button>
        <h1>黒板編集</h1>
        <button className="text-btn" onClick={onOpenTemplates}>
          <Icon name="board" size={18} />
          作成した黒板
        </button>
      </header>

      <main className="screen-body editor-body">
        <div ref={wrapRef} className={`board-wrap ${boardOn ? '' : 'is-off'}`}>
          {width > 0 && <BoardCanvas board={board} width={width} onSlotTap={boardOn ? setEditing : undefined} className="board-canvas" />}
          {!boardOn && <div className="board-off-label">黒板オフ</div>}
        </div>
        {boardOn && <p className="hint">項目をタップすると、項目名と内容を編集できます</p>}
        {boardOn && dateHint && <p className="hint">{dateHint}</p>}

        <div className="row-actions">
          <button className="btn" disabled={!boardOn} onClick={() => setSaving(true)}>この黒板を保存</button>
          <button className={`btn ${boardOn ? '' : 'btn-active'}`} onClick={() => onModeChange(boardOn ? 'without_board' : 'with_board')}>
            {boardOn ? '黒板オフ' : '黒板オン'}
          </button>
        </div>

        {boardOn && (
          <fieldset className="segmented">
            <legend>保存する写真</legend>
            <label className={mode === 'with_board' ? 'on' : ''}>
              <input type="radio" name="mode" checked={mode === 'with_board'} onChange={() => onModeChange('with_board')} />
              黒板ありのみ
            </label>
            <label className={mode === 'both' ? 'on' : ''}>
              <input type="radio" name="mode" checked={mode === 'both'} onChange={() => onModeChange('both')} />
              黒板あり＋なし（両方）
            </label>
          </fieldset>
        )}
        {mode === 'with_board' && <p className="hint">「両方」で保存すると、あとから黒板の誤字を直して写真を作り直せます</p>}

        <HandoverField value={handover} onChange={onHandoverChange} />
      </main>

      <footer className="bottombar">
        <button className="btn btn-primary btn-wide" onClick={onNext}>{nextLabel}</button>
      </footer>

      {editing != null && (
        <ItemEditSheet
          slot={editing}
          board={board}
          onCancel={() => setEditing(null)}
          onApply={(label, value) => {
            onBoardChange(board.map((it, i) => (i === editing ? { label, value } : it)));
            setEditing(null);
          }}
        />
      )}

      {saving && (
        <SaveTemplateSheet
          onCancel={() => setSaving(false)}
          onSave={async (name) => {
            const t = nowIso();
            await db.templates.add({ id: newId(), name, content: board, lastUsedAt: t, createdBy: prefs.getWorkerName(), createdAt: t, updatedAt: t });
            setSaving(false);
          }}
        />
      )}
    </div>
  );
}

export function ItemEditSheet({ slot, board, onCancel, onApply }: { slot: number; board: BoardContent; onCancel: () => void; onApply: (label: string, value: string) => void }) {
  const def = BOARD_SLOTS[slot];
  const [label, setLabel] = useState(board[slot].label);
  const [value, setValue] = useState(board[slot].value);
  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <form
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onApply(label.trim() || def.defaultLabel, value);
        }}
      >
        <h2>項目の編集</h2>
        <label className="field">
          <span>項目名</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={def.defaultLabel} />
        </label>
        <label className="field">
          <span>内容</span>
          {def.kind === 'date' ? (
            <input type="date" value={value} onChange={(e) => setValue(e.target.value)} />
          ) : def.kind === 'multi' ? (
            <textarea rows={4} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
          ) : (
            <input value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
          )}
        </label>
        <p className="hint">
          {def.kind === 'multi' ? '枠内で折り返して表示します。長い場合は文字が小さくなります' : '1行に収まるよう文字の大きさを自動で調整します'}
        </p>
        <div className="sheet-actions">
          <button type="button" className="btn" onClick={onCancel}>キャンセル</button>
          <button type="submit" className="btn btn-primary">反映</button>
        </div>
      </form>
    </div>
  );
}

function SaveTemplateSheet({ onCancel, onSave }: { onCancel: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <form
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSave(name.trim());
        }}
      >
        <h2>黒板を保存</h2>
        <label className="field">
          <span>名前</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：GeoChat中継器設置" autoFocus />
        </label>
        <p className="hint">保存した黒板は「作成した黒板」から呼び出せます</p>
        <div className="sheet-actions">
          <button type="button" className="btn" onClick={onCancel}>キャンセル</button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim()}>保存</button>
        </div>
      </form>
    </div>
  );
}
