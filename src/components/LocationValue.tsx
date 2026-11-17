import { useRef, useState } from 'react';
import { Icon } from './Icon';

interface Props {
  latitude: number;
  longitude: number;
  accuracy: number | null;
}

const LONG_PRESS_MS = 500;

/** クリップボードにコピーする。使えない環境では選択してコピーする方法に切り替える */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/**
 * 位置情報の表示。長押しで緯度・経度をコピー、地図ボタンでGoogleマップを開く。
 * iPhoneのSafariは指を離した瞬間でないとコピーを許可しないため、長押しのあと指を離したときにコピーする
 */
export function LocationValue({ latitude, longitude, accuracy }: Props) {
  const coords = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${latitude.toFixed(6)},${longitude.toFixed(6)}`;
  const pressStart = useRef<{ t: number; x: number; y: number } | null>(null);
  const [pressing, setPressing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showToast = (msg: string) => {
    setToast(msg);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 1800);
  };

  return (
    <span className="location">
      <span
        className={`location-coords ${pressing ? 'is-pressing' : ''}`}
        role="button"
        tabIndex={0}
        aria-label={`緯度経度 ${coords}。長押しでコピー`}
        onPointerDown={(e) => {
          pressStart.current = { t: Date.now(), x: e.clientX, y: e.clientY };
          setPressing(true);
        }}
        onPointerMove={(e) => {
          const s = pressStart.current;
          // 指が動いたら（スクロール）長押しとみなさない
          if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) {
            pressStart.current = null;
            setPressing(false);
          }
        }}
        onPointerUp={async () => {
          const s = pressStart.current;
          pressStart.current = null;
          setPressing(false);
          if (s && Date.now() - s.t >= LONG_PRESS_MS) {
            showToast((await copyText(coords)) ? '緯度・経度をコピーしました' : 'コピーできませんでした');
          }
        }}
        onPointerCancel={() => {
          pressStart.current = null;
          setPressing(false);
        }}
        onKeyDown={async (e) => {
          if (e.key === 'Enter') showToast((await copyText(coords)) ? '緯度・経度をコピーしました' : 'コピーできませんでした');
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {coords}
        {accuracy ? <span className="location-acc">（±{Math.round(accuracy)}m）</span> : null}
      </span>
      <a className="location-map" href={mapUrl} target="_blank" rel="noopener noreferrer">
        <Icon name="map" size={16} />
        地図
      </a>
      <span className="location-hint">長押しでコピー</span>
      {toast && (
        <span className="toast" role="status">
          {toast}
        </span>
      )}
    </span>
  );
}
