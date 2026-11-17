import { useState } from 'react';
import { getProvider } from '../sync/config';
import { useOnline } from '../sync/hooks';
import { NetworkError } from '../sync/provider';

interface Props {
  /** ログイン画面を出した理由（アカウント停止など） */
  notice?: string | null;
}

/** S01 ログイン */
export function Login({ notice }: Props) {
  const online = useOnline();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="screen login">
      <main className="login-body">
        <img src={`${import.meta.env.BASE_URL}brand/logo-mark.png`} alt="" className="login-mark" />
        <h1 className="login-title">GeoBoard</h1>
        <p className="login-sub">工事黒板つきの現場記録</p>

        {notice && <p className="login-notice">{notice}</p>}

        <form
          className="login-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await getProvider().signIn(email.trim(), password);
            } catch (err) {
              setError(err instanceof NetworkError ? '電波のある場所でログインしてください' : (err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            <span>メールアドレス</span>
            <input type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="field">
            <span>パスワード</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error && <p className="hint danger">{error}</p>}
          {!online && <p className="hint warn-text">圏外です。初回のログインには電波が必要です</p>}
          <button type="submit" className="btn btn-primary btn-wide" disabled={busy || !email || !password}>
            {busy ? 'ログイン中…' : 'ログイン'}
          </button>
        </form>
        <p className="hint login-help">一度ログインすれば、ログアウトするまで圏外でも使えます。アカウントは管理者に発行してもらってください</p>
      </main>
    </div>
  );
}
