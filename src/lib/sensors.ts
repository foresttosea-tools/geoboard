import { useEffect, useRef, useState } from 'react';

export interface GeoFix {
  latitude: number;
  longitude: number;
  accuracy: number;
  at: number;
}

/** 撮影画面を開いている間、位置情報を取得し続ける。取れなくても撮影は止めない（要件6.5） */
export function useGeolocation(active: boolean) {
  const [fix, setFix] = useState<GeoFix | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!active || !('geolocation' in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setFix({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() });
        setError(null);
      },
      (e) => setError(e.message || '位置情報を取得できません'),
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [active]);
  return { fix, error };
}

type PermissionRequestable = { requestPermission?: () => Promise<'granted' | 'denied'> };

/** iOSでは傾きセンサーの利用にユーザー操作をきっかけにした許可が必要 */
export async function requestMotionPermission(): Promise<boolean> {
  const DME = (window as unknown as { DeviceMotionEvent?: PermissionRequestable }).DeviceMotionEvent;
  if (DME?.requestPermission) {
    try {
      return (await DME.requestPermission()) === 'granted';
    } catch {
      return false;
    }
  }
  return true;
}

function screenAngle(): number {
  const a = screen.orientation?.angle;
  if (typeof a === 'number') return a;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return typeof legacy === 'number' ? legacy : 0;
}

/**
 * 水平器。画面に対する水平線の傾き（度）を返す。0なら水平
 * 重力の向きを画面座標に変換し、最も近い90度の倍数からのずれを求める
 */
export function useLevel(active: boolean) {
  const [angle, setAngle] = useState<number | null>(null);
  const smooth = useRef<number | null>(null);
  useEffect(() => {
    if (!active) return;
    const onMotion = (e: DeviceMotionEvent) => {
      const g = e.accelerationIncludingGravity;
      if (!g || g.x == null || g.y == null) return;
      // 端末座標での重力方向の角度
      let deg = (Math.atan2(g.x, g.y) * 180) / Math.PI;
      // 画面の回転を補正
      deg -= screenAngle();
      // 最寄りの90度の倍数からのずれ（-45〜45）
      let dev = ((((deg + 45) % 90) + 90) % 90) - 45;
      if (smooth.current != null && Math.abs(dev - smooth.current) < 30) {
        dev = smooth.current * 0.7 + dev * 0.3;
      }
      smooth.current = dev;
      setAngle(dev);
    };
    window.addEventListener('devicemotion', onMotion);
    return () => window.removeEventListener('devicemotion', onMotion);
  }, [active]);
  return angle;
}

/** 画面の向き */
export function useOrientation(): 'portrait' | 'landscape' {
  const get = () => (window.matchMedia('(orientation: landscape)').matches ? 'landscape' : 'portrait');
  const [o, setO] = useState<'portrait' | 'landscape'>(get);
  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape)');
    const on = () => setO(get());
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return o;
}
