import { useEffect, useState } from 'react';
import { isStandalone } from '../lib/standalone';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Androidの「インストール」ダイアログを出すためのイベント。画面が出る前に届くことがあるため、読み込み時に受け取っておく
let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    listeners.forEach((f) => f());
  });
}

const SHOWN_KEY = 'geoboard.installGuideShown';
function shownThisLaunch(): boolean {
  try {
    return sessionStorage.getItem(SHOWN_KEY) === '1';
  } catch {
    return false;
  }
}
function markShown() {
  try {
    sessionStorage.setItem(SHOWN_KEY, '1');
  } catch {
    /* 保存できなくても閉じる */
  }
}

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * S18 ホーム画面追加の案内（要件7.1）。
 * ブラウザのタブで開いた場合に、起動のたびに1回表示する（iOSのSafariは、ホーム画面から使わないと7日で端末のデータが消えることがあるため）
 */
export function InstallGuide() {
  const [open, setOpen] = useState(() => !isStandalone() && !shownThisLaunch());
  const [canPrompt, setCanPrompt] = useState(() => deferred != null);
  useEffect(() => {
    const f = () => setCanPrompt(deferred != null);
    listeners.add(f);
    return () => {
      listeners.delete(f);
    };
  }, []);
  if (!open) return null;

  const close = () => {
    markShown();
    setOpen(false);
  };
  const ios = isIos();

  return (
    <div className="dialog-backdrop">
      <div className="dialog install-guide" role="dialog" aria-modal="true" aria-labelledby="install-guide-title">
        <h2 id="install-guide-title">ホーム画面に追加してください</h2>
        <p>
          GeoBoardはホーム画面に追加して使うアプリです。ブラウザのまま使うと、圏外で撮った未送信の写真が端末から消えてしまうことがあります
        </p>
        {ios ? (
          <ol>
            <li>Safariで開いてください（ほかのブラウザでは追加できない場合があります）</li>
            <li>画面下の共有ボタン（四角から矢印が出たマーク）を押す</li>
            <li>「ホーム画面に追加」を選び、「追加」を押す</li>
            <li>ホーム画面のGeoBoardのアイコンから開き直す</li>
          </ol>
        ) : (
          <ol>
            <li>Chromeの右上のメニュー（︙）を押す</li>
            <li>「ホーム画面に追加」または「アプリをインストール」を選ぶ</li>
            <li>ホーム画面のGeoBoardのアイコンから開き直す</li>
          </ol>
        )}
        <p className="hint">ホーム画面から開き直したら、もう一度ログインしてください（ブラウザとはログイン状態が別になる場合があります）</p>
        <div className="dialog-actions">
          {canPrompt && (
            <button
              className="btn btn-primary"
              onClick={async () => {
                const e = deferred;
                deferred = null;
                setCanPrompt(false);
                if (!e) return;
                await e.prompt();
                const { outcome } = await e.userChoice;
                if (outcome === 'accepted') close();
              }}
            >
              ホーム画面に追加
            </button>
          )}
          <button className="btn" onClick={close}>
            このままブラウザで使う
          </button>
        </div>
      </div>
    </div>
  );
}
