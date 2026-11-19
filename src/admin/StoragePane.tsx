import { useState } from 'react';
import { deleteStaleFiles, formatBytes, scanStorage, type StorageScan } from '../lib/storageCleanup';
import { useOnline } from '../sync/hooks';

/** 無料プランの写真の保存枠（Supabase Free） */
const FREE_LIMIT = 1024 ** 3;

/** 保存容量と古い写真のお掃除（管理者） */
export function StoragePane() {
  const online = useOnline();
  const [scan, setScan] = useState<StorageScan | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy('調べています…');
    setError(null);
    try {
      setScan(await scanStorage());
    } catch (e) {
      setError(`調べられませんでした：${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const ratio = scan ? Math.min(1, scan.bytes / FREE_LIMIT) : 0;
  return (
    <div className="admin-page narrow">
      <h1>保存容量</h1>
      <p className="hint">サーバーに保存している写真の量と、黒板の修正などで使われなくなった古い写真のお掃除です</p>
      {!online && <p className="hint danger">電波のある場所で使えます</p>}
      <button className="btn btn-primary" onClick={run} disabled={!online || busy != null}>
        {busy ?? (scan ? 'もう一度調べる' : '使用量を調べる')}
      </button>
      {error && <p className="hint danger">{error}</p>}
      {scan && (
        <>
          <section className="card storage-card">
            <h2>写真の使用量</h2>
            <p className="storage-total">
              <strong>{formatBytes(scan.bytes)}</strong> / 1GB（無料プランの上限）・{scan.files}ファイル
            </p>
            <div className="storage-bar" role="img" aria-label={`使用率 ${Math.round(ratio * 100)}%`}>
              <span style={{ width: `${Math.max(ratio * 100, 0.5)}%` }} className={ratio > 0.8 ? 'warn' : ''} />
            </div>
            <p className="hint">文字データ（顧客・台帳・記録の内容）は別枠で、写真に比べてごくわずかです</p>
          </section>
          <section className="card storage-card">
            <h2>古い写真</h2>
            {scan.stale.length === 0 ? (
              <p>使われなくなった古い写真はありません</p>
            ) : (
              <>
                <p>
                  黒板の修正などで使われなくなった写真が <strong>{scan.stale.length}ファイル（{formatBytes(scan.staleBytes)}）</strong> あります。今表示している写真や、削除済みの記録の写真（復元用）は消しません
                </p>
                <button
                  className="btn btn-danger"
                  disabled={!online || busy != null}
                  onClick={async () => {
                    if (!confirm(`古い写真 ${scan.stale.length}ファイル（${formatBytes(scan.staleBytes)}）を削除しますか？元に戻せません。`)) return;
                    setBusy('削除しています…');
                    setError(null);
                    try {
                      await deleteStaleFiles(scan.stale);
                      setMessage(`${scan.stale.length}ファイル（${formatBytes(scan.staleBytes)}）を削除しました`);
                      setScan(await scanStorage());
                    } catch (e) {
                      setError(`削除できませんでした：${(e as Error).message}`);
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  古い写真を削除
                </button>
              </>
            )}
            {message && <p className="hint">{message}</p>}
            {scan.unknown > 0 && <p className="hint">送信の途中など、記録がまだサーバーにない写真が {scan.unknown}ファイルあります。これらは消さずに残しています</p>}
            <p className="hint">保存してから24時間たっていない写真は、送信の途中の可能性があるため対象にしません</p>
          </section>
        </>
      )}
    </div>
  );
}
