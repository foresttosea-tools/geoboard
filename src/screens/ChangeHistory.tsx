import { HistoryList } from '../components/HistoryList';
import { Icon } from '../components/Icon';

/** S15 変更履歴（作業記録・台帳） */
export function ChangeHistory({ title, targetId, onBack }: { title: string; targetId: string; onBack: () => void }) {
  return (
    <div className="screen">
      <header className="appbar">
        <button className="icon-btn" onClick={onBack} aria-label="戻る">
          <Icon name="back" />
        </button>
        <h1>変更履歴</h1>
        <span />
      </header>
      <main className="screen-body">
        <p className="form-context">
          <span>対象</span>
          {title}
        </p>
        <p className="hint">誰がいつ何を変えたかを新しい順に表示します。「変更前の内容に戻す」で、その変更の前の内容に戻せます</p>
        <HistoryList targetIds={[targetId]} />
      </main>
    </div>
  );
}
