import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Icon } from '../components/Icon';
import { db } from '../db';
import { clearDiag, diagText } from '../lib/diag';
import { prefs } from '../lib/prefs';
import { DEFAULT_SERVER, getProvider, getServerConfig, setServerConfig } from '../sync/config';
import { countUnsent, describeUnsent, resetLocalData, resetSyncState, sendAllPending, syncNow } from '../sync/engine';
import { useMyProfile, useOnline, useSyncState, useUnsent } from '../sync/hooks';
import type { AuthSession } from '../sync/provider';
import type { Profile } from '../types';

interface Props {
  session: AuthSession;
  onBack: () => void;
}

const fmtMB = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`;
const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ja-JP') : '未同期');

/** S17 設定 */
export function Settings({ session, onBack }: Props) {
  const me = useMyProfile();
  const isAdmin = me?.role === 'admin' && !me.disabled;
  const online = useOnline();
  const sync = useSyncState();
  const unsent = useUnsent();
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  /** 未送信の説明（未送信がなければ空文字） */
  const [logout, setLogout] = useState<string | null>(null);
  const [reset, setReset] = useState<string | null>(null);
  const [resetting, setResetting] = useState<'sending' | 'clearing' | null>(null);
  const [resetNote, setResetNote] = useState<string | null>(null);

  const doReset = async () => {
    setResetting('clearing');
    await resetLocalData();
    // アプリを読み込み直すと、サーバーの最新の内容を取り込む
    location.reload();
  };

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
    navigator.storage
      ?.estimate?.()
      .then((e) => setUsage({ usage: e.usage ?? 0, quota: e.quota ?? 0 }))
      .catch(() => undefined);
  }, []);

  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

  const doLogout = async () => {
    await getProvider().signOut();
    resetSyncState();
  };

  return (
    <div className="screen">
      <header className="appbar">
        <button className="icon-btn" onClick={onBack} aria-label="戻る">
          <Icon name="back" />
        </button>
        <h1>設定</h1>
        <span />
      </header>
      <main className="screen-body">
        <section className="card">
          <h2>アカウント</h2>
          <dl className="detail-list">
            <div>
              <dt>メール</dt>
              <dd>{session.email}</dd>
            </div>
            <div>
              <dt>権限</dt>
              <dd>{me ? (me.role === 'admin' ? '管理者' : '一般') : '同期後に表示されます'}</dd>
            </div>
          </dl>
          <DisplayNameField me={me} online={online} />
          <PasswordChange email={session.email} online={online} />
          <button
            className="btn btn-wide"
            onClick={async () => {
              const c = await countUnsent();
              if (c.pending + c.failed > 0) setLogout(describeUnsent(c));
              else await doLogout();
            }}
          >
            ログアウト
          </button>
        </section>

        <section className="card">
          <h2>同期</h2>
          <dl className="detail-list">
            <div>
              <dt>最終同期</dt>
              <dd>{sync.running ? '同期中…' : fmtTime(sync.lastSyncAt)}</dd>
            </div>
            <div>
              <dt>未送信</dt>
              <dd>
                {!unsent || unsent.pending + unsent.failed === 0
                  ? 'なし'
                  : unsent.records > 0
                    ? `記録 ${unsent.records}件${unsent.failed ? '（送信失敗を含む）' : ''}`
                    : '顧客や台帳などの変更あり'}
              </dd>
            </div>
            {sync.lastError && (
              <div>
                <dt>直近のエラー</dt>
                <dd>{sync.lastError}</dd>
              </div>
            )}
          </dl>
          <button className="btn btn-wide" disabled={!online || sync.running} onClick={() => void syncNow()}>
            {online ? '今すぐ同期' : '圏外のため同期できません'}
          </button>
          <label className="field settings-inline">
            <span>未送信の警告を出すまでの日数</span>
            <input
              type="number"
              min={1}
              max={30}
              defaultValue={prefs.getUnsentWarnDays()}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v >= 1 && v <= 30) prefs.setUnsentWarnDays(v);
              }}
            />
          </label>
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
          <p className="hint">送信済みの写真は、端末には縮小版だけを残して容量を節約しています</p>
          <button
            className="btn btn-wide"
            disabled={!online}
            onClick={async () => {
              const c = await countUnsent();
              setResetNote(null);
              setReset(c.pending + c.failed > 0 ? describeUnsent(c) : '');
            }}
          >
            {online ? 'この端末のデータを消して、サーバーから取り直す' : '圏外のため取り直せません'}
          </button>
          <p className="hint">サーバーのデータを管理画面で直接消したあとなど、この端末に古いデータが残っているときに使います。ログインしたままになります</p>
        </section>

        <section className="card">
          <h2>PC管理画面</h2>
          <p className="hint">PCのブラウザで次のURLを開くと、台帳の一覧・地図・PDFレポート・ZIPダウンロードなどが使えます。ブックマークしておくと便利です</p>
          <p className="admin-url">{`${location.origin}${import.meta.env.BASE_URL}#admin`}</p>
        </section>

        <DiagCard />

        {isAdmin && <UserAdmin myId={session.userId} online={online} />}
        {isAdmin && <ServerConfigCard />}

        <img src={`${import.meta.env.BASE_URL}brand/logo-horizontal.png`} alt="株式会社フォレストシー" className="settings-brand" />
        <p className="version">
          GeoBoard v{__APP_VERSION__}
          <br />
          {new Date(__BUILD_TIME__).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} 公開（{__BUILD_COMMIT__}）
        </p>
      </main>

      {reset != null && (
        <ConfirmDialog
          title={reset ? '未送信のデータがあります' : '端末のデータを取り直しますか？'}
          message={
            resetNote ??
            (reset
              ? `送信されていない${reset}があります。消すと元に戻せません。先に送信してから取り直すことをおすすめします。`
              : 'この端末の顧客・台帳・記録・写真を消して、サーバーの最新の内容を取り込み直します。サーバーのデータは変わりません。')
          }
          onDismiss={() => !resetting && setReset(null)}
          actions={
            reset
              ? [
                  ...(resetNote
                    ? []
                    : [
                        {
                          label: resetting === 'sending' ? '送信しています…' : resetting === 'clearing' ? '取り直しています…' : '送信してから取り直す',
                          variant: 'primary' as const,
                          onClick: async () => {
                            if (resetting) return;
                            setResetting('sending');
                            const r = await sendAllPending();
                            if (r.pending + r.failed === 0) {
                              await doReset();
                              return;
                            }
                            setResetting(null);
                            setReset(describeUnsent(r));
                            setResetNote(
                              `${describeUnsent(r)}が送信できませんでした。${r.reasons.length ? `（理由：${r.reasons.join('／')}）` : ''}` +
                                'サーバーで顧客や台帳を直接消した場合、それに属するデータは送れません。消してよければ「未送信も含めて消す」を押してください。',
                            );
                          },
                        },
                      ]),
                  { label: '未送信も含めて消す', variant: 'danger', onClick: doReset },
                  { label: 'キャンセル', onClick: () => !resetting && setReset(null) },
                ]
              : [
                  { label: resetting ? '取り直しています…' : '取り直す', variant: 'primary', onClick: doReset },
                  { label: 'キャンセル', onClick: () => setReset(null) },
                ]
          }
        />
      )}

      {logout != null && (
        <ConfirmDialog
          title="未送信のデータがあります"
          message={`送信されていない${logout}があります。ログアウトしても端末からは消えませんが、ログインし直すまで送信されません。`}
          onDismiss={() => setLogout(null)}
          actions={[
            {
              label: online ? '送信してからログアウト' : '圏外のため送信できません',
              variant: 'primary',
              onClick: async () => {
                if (!online) return;
                await syncNow();
                const c = await countUnsent();
                if (c.pending + c.failed === 0) await doLogout();
                else setLogout(describeUnsent(c));
              },
            },
            { label: 'このままログアウト', variant: 'danger', onClick: doLogout },
            { label: 'キャンセル', onClick: () => setLogout(null) },
          ]}
        />
      )}
    </div>
  );
}

/** 表示名（黒板の施工者名の初期値にもなる） */
function DisplayNameField({ me, online }: { me: Profile | undefined; online: boolean }) {
  const [name, setName] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const value = name ?? me?.displayName ?? prefs.getWorkerName();
  const changed = me != null && value.trim() !== '' && value.trim() !== me.displayName;
  return (
    <div className="field">
      <span className="field-label">表示名（黒板の「施工者名」の初期値）</span>
      <div className="inline-form">
        <input value={value} onChange={(e) => setName(e.target.value)} placeholder="例：芦田" />
        <button
          className="btn btn-primary"
          disabled={!changed || !online}
          onClick={async () => {
            if (!me) return;
            try {
              await getProvider().updateProfile(me.userId, { display_name: value.trim() });
              await db.profiles.update(me.userId, { displayName: value.trim() });
              prefs.setWorkerName(value.trim());
              setName(null);
              setMsg('保存しました');
            } catch (e) {
              setMsg((e as Error).message);
            }
          }}
        >
          保存
        </button>
      </div>
      {!online && <p className="hint">表示名の変更には電波が必要です</p>}
      {msg && <p className="hint">{msg}</p>}
    </div>
  );
}

/** パスワードの変更（要件4.1）。今のパスワードで本人確認してから変える */
function PasswordChange({ email, online }: { email: string; online: boolean }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const tooShort = next.length > 0 && next.length < 8;
  const mismatch = again.length > 0 && next !== again;
  const can = online && !busy && current !== '' && next.length >= 8 && next === again;

  if (!open)
    return (
      <>
        <button className="btn btn-wide" onClick={() => { setOpen(true); setMsg(null); }}>
          パスワードを変更
        </button>
        {msg?.ok && <p className="hint">{msg.text}</p>}
      </>
    );
  return (
    <form
      className="password-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!can) return;
        setBusy(true);
        setMsg(null);
        try {
          await getProvider().changePassword(email, current, next);
          setOpen(false);
          setCurrent('');
          setNext('');
          setAgain('');
          setMsg({ ok: true, text: 'パスワードを変更しました。次にログインするときから新しいパスワードを使います' });
        } catch (err) {
          setMsg({ ok: false, text: (err as Error).message });
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field">
        <span>今のパスワード</span>
        <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </label>
      <label className="field">
        <span>新しいパスワード（8文字以上）</span>
        <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      </label>
      {tooShort && <p className="hint danger">8文字以上にしてください</p>}
      <label className="field">
        <span>新しいパスワード（確認）</span>
        <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
      </label>
      {mismatch && <p className="hint danger">新しいパスワードが一致しません</p>}
      {!online && <p className="hint">パスワードの変更には電波が必要です</p>}
      {msg && !msg.ok && <p className="hint danger">{msg.text}</p>}
      <div className="dialog-actions row">
        <button type="button" className="btn" onClick={() => { setOpen(false); setMsg(null); }} disabled={busy}>
          キャンセル
        </button>
        <button type="submit" className="btn btn-primary" disabled={!can}>
          {busy ? '変更しています…' : '変更する'}
        </button>
      </div>
    </form>
  );
}

/** ユーザー管理（管理者のみ。要件4.2） */
export function UserAdmin({ myId, online }: { myId: string; online: boolean }) {
  const profiles = useLiveQuery(() => db.profiles.toArray(), []);
  const [error, setError] = useState<string | null>(null);

  const update = async (p: Profile, patch: { role?: Profile['role']; disabled?: boolean }) => {
    setError(null);
    try {
      await getProvider().updateProfile(p.userId, patch);
      await db.profiles.update(p.userId, patch);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="card">
      <h2>ユーザー管理（管理者）</h2>
      <p className="hint">アカウントの発行は、Supabaseの管理画面の「Authentication」→「Users」→「Add user」から行います（「Auto Confirm User」にチェック）</p>
      <ul className="user-list">
        {(profiles ?? [])
          .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ja'))
          .map((p) => (
            <li key={p.userId} className={p.disabled ? 'is-disabled' : ''}>
              <div className="user-name">
                <strong>{p.displayName || '（名前なし）'}</strong>
                {p.userId === myId && <span className="badge badge-brand">自分</span>}
                {p.disabled && <span className="badge badge-error">停止中</span>}
              </div>
              <div className="user-actions">
                <select
                  value={p.role}
                  disabled={!online || p.userId === myId}
                  onChange={(e) => update(p, { role: e.target.value as Profile['role'] })}
                  aria-label={`${p.displayName}の権限`}
                >
                  <option value="member">一般</option>
                  <option value="admin">管理者</option>
                </select>
                <button
                  className="btn"
                  disabled={!online || p.userId === myId}
                  onClick={() => {
                    if (p.disabled || confirm(`${p.displayName}さんのアカウントを停止しますか？\n停止すると、その端末は次に電波が入ったときに未送信データを送ってからログアウトされます`)) {
                      void update(p, { disabled: !p.disabled });
                    }
                  }}
                >
                  {p.disabled ? '再開' : '停止'}
                </button>
              </div>
            </li>
          ))}
      </ul>
      {!online && <p className="hint">ユーザーの変更には電波が必要です</p>}
      {error && <p className="hint danger">{error}</p>}
    </section>
  );
}

/** 接続先（管理者のみ。要件6.8） */
function ServerConfigCard() {
  const current = getServerConfig();
  const [url, setUrl] = useState(current.url);
  const [key, setKey] = useState(current.key);
  const changed = url.trim() !== current.url || key.trim() !== current.key;
  return (
    <section className="card">
      <h2>接続先（管理者）</h2>
      <p className="hint">サーバーを引っ越したときに変更します。変更するとアプリを再読み込みし、ログインし直しになります</p>
      <label className="field">
        <span>URL</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" />
      </label>
      <label className="field">
        <span>公開用キー（publishable key）</span>
        <input value={key} onChange={(e) => setKey(e.target.value)} />
      </label>
      <div className="row-actions">
        <button
          className="btn"
          onClick={() => {
            setUrl(DEFAULT_SERVER.url);
            setKey(DEFAULT_SERVER.key);
          }}
        >
          初期値に戻す
        </button>
        <button
          className="btn btn-primary"
          disabled={!changed || !url.trim().startsWith('https://') || !key.trim()}
          onClick={async () => {
            if (!confirm('接続先を変更して再読み込みしますか？未送信のデータは新しい接続先に送られます')) return;
            // 受信の位置を新しい接続先で最初からにする
            await db.meta.clear();
            await getProvider().signOut();
            const next = { kind: 'supabase' as const, url: url.trim(), key: key.trim() };
            setServerConfig(next.url === DEFAULT_SERVER.url && next.key === DEFAULT_SERVER.key ? null : next);
            location.reload();
          }}
        >
          変更して再読み込み
        </button>
      </div>
    </section>
  );
}

/** 診断ログ（不具合の原因を調べるための記録） */
function DiagCard() {
  const [text, setText] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <section className="card">
      <h2>診断ログ</h2>
      <p className="hint">固まった・動かないなどの不具合があったときは、アプリを開き直してから「ログをコピー」を押し、チャットに貼ってください。写真やパスワードは含まれません</p>
      <div className="row-actions">
        <button
          className="btn btn-primary"
          onClick={async () => {
            const t = diagText();
            setText(t);
            try {
              await navigator.clipboard.writeText(t);
              setMsg('コピーしました');
            } catch {
              setMsg('下の文章を長押しで選択してコピーしてください');
            }
          }}
        >
          ログをコピー
        </button>
        <button
          className="btn"
          onClick={() => {
            clearDiag();
            setText(null);
            setMsg('ログを消しました');
          }}
        >
          ログを消す
        </button>
      </div>
      {msg && <p className="hint">{msg}</p>}
      {text && <textarea className="diag-text" readOnly value={text} rows={8} onFocus={(e) => e.currentTarget.select()} />}
    </section>
  );
}
