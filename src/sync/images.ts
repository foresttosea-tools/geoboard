import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '../db';
import type { StoredImage } from '../types';
import { getProvider } from './config';

/**
 * 写真の取得。端末にあればそれを使い、なければサーバーから取り寄せる。
 * - サムネイル：取り寄せたら端末に保存する（一覧をオフラインでも表示するため）
 * - 大きい画像：保存せずメモリに一時的に置く（端末の容量を節約するため。要件7.1）
 */

const memory = new Map<string, Blob>();
const MEMORY_MAX = 12;
const inflight = new Map<string, Promise<Blob>>();

function remember(path: string, blob: Blob) {
  memory.delete(path);
  memory.set(path, blob);
  while (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value as string);
}

async function download(path: string): Promise<Blob> {
  const cached = memory.get(path);
  if (cached) return cached;
  let p = inflight.get(path);
  if (!p) {
    p = getProvider()
      .downloadFile(path)
      .finally(() => inflight.delete(path));
    inflight.set(path, p);
  }
  const blob = await p;
  remember(path, blob);
  return blob;
}

/** 大きい画像のBlob（端末になければサーバーから。保存はしない） */
export async function loadImageBlob(localKey: string, remotePath: string | null | undefined): Promise<Blob | null> {
  const local = await db.images.get(localKey);
  if (local) return local.blob;
  if (!remotePath) return null;
  return download(remotePath);
}

/**
 * 表示用のURL。端末にあればそのBlob、なければサーバーから取り寄せる。
 * persist を true にすると、取り寄せた画像を端末に保存する（サムネイル用）
 */
export function useImageUrl(
  localKey: string | null,
  remotePath: string | null | undefined,
  opts: { persist?: { recordId: string; kind: StoredImage['kind'] } } = {},
): { url: string | null; loading: boolean; error: boolean } {
  const local = useLiveQuery(async () => (localKey ? ((await db.images.get(localKey)) ?? null) : null), [localKey]);
  const [remote, setRemote] = useState<{ path: string; blob: Blob | null; error: boolean } | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  const needRemote = local === null && !!remotePath;
  const persistKey = opts.persist ? `${opts.persist.recordId}:${opts.persist.kind}` : null;

  useEffect(() => {
    if (!needRemote || !remotePath) return;
    let cancelled = false;
    download(remotePath)
      .then(async (blob) => {
        if (cancelled) return;
        if (opts.persist && localKey) {
          await db.images.put({ key: localKey, recordId: opts.persist.recordId, kind: opts.persist.kind, blob, uploaded: true });
        } else {
          setRemote({ path: remotePath, blob, error: false });
        }
      })
      .catch(() => !cancelled && setRemote({ path: remotePath, blob: null, error: true }));
    return () => {
      cancelled = true;
    };
    // persistKey は opts.persist の内容を表す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needRemote, remotePath, localKey, persistKey]);

  const blob = local?.blob ?? (remote && remote.path === remotePath ? remote.blob : null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);

  return {
    url,
    loading: local === undefined || (needRemote && !blob && !(remote?.path === remotePath && remote.error)),
    error: needRemote && remote?.path === remotePath && remote.error,
  };
}
