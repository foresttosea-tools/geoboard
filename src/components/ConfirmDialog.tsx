export interface DialogAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'danger' | 'plain';
}

interface Props {
  title: string;
  message: string;
  actions: DialogAction[];
  onDismiss: () => void;
}

/** 画面中央に出す確認ダイアログ */
export function ConfirmDialog({ title, message, actions, onDismiss }: Props) {
  return (
    <div className="dialog-backdrop" onClick={onDismiss}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="dialog-title">{title}</h2>
        <p>{message}</p>
        <div className="dialog-actions">
          {actions.map((a) => (
            <button
              key={a.label}
              className={`btn ${a.variant === 'primary' ? 'btn-primary' : ''} ${a.variant === 'danger' ? 'btn-danger' : ''}`}
              onClick={a.onClick}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
