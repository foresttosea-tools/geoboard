import { useEffect, useState } from 'react';
import { prefs } from '../lib/prefs';
import { Icon } from '../components/Icon';

interface Props {
  onBack: () => void;
}

const fmtMB = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`;

export function Settings({ onBack }: Props) {
  const [name, setName] = useState(prefs.getWorkerName());
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
    navigator.storage
      ?.estimate?.()
      .then((e) => setUsage({ usage: e.usage ?? 0, quota: e.quota ?? 0 }))
      .catch(() => undefined);
  }, []);

  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

  return (
    <div className="screen">
      <header className="appbar">
        <button className="icon-btn" onClick={onBack} aria-label="戻る"><Icon name="back" /></button>
        <h1>設定</h1>
        <span />
      </header>
      <main className="screen-body">
        <section className="card">
          <h2>施工者名</h2>
          <p className="hint">黒板の「施工者名」の初期値に使います。ログイン機能ができたら、ログインユーザーの名前に置き換わります</p>
          <input
            value={name}
            placeholder="例：芦田"
            onChange={(e) => {
              setName(e.target.value);
              prefs.setWorkerName(e.target.value);
            }}
          />
        </section>
        <section className="card">
          <h2>端末内の保存</h2>
          <dl className="detail-list">
            <div>
              <dt>使用量</dt>
              <dd>{usage ? `${fmtMB(usage.usage)} / 上限 ${fmtMB(usage.quota)}` : '取得できません'}</dd>
            </div>
            <div>
              <dt>永続化</dt>
              <dd>{persisted == null ? '不明' : persisted ? '有効（自動削除されません）' : '未許可'}</dd>
            </div>
            <div>
              <dt>起動方法</dt>
              <dd>{standalone ? 'ホーム画面から起動中' : 'ブラウザで表示中（ホーム画面への追加を推奨）'}</dd>
            </div>
          </dl>
        </section>
        <section className="card">
          <h2>サーバー接続</h2>
          <p className="hint">ステップ3で対応予定です。現在は端末内にのみ保存されます</p>
        </section>
        <img src={`${import.meta.env.BASE_URL}brand/logo-horizontal.png`} alt="株式会社フォレストシー" className="settings-brand" />
        <p className="version">GeoBoard v{__APP_VERSION__}</p>
      </main>
    </div>
  );
}
