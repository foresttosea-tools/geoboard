import { useCallback, useEffect, useRef, useState } from 'react';
import { diag } from './diag';

interface ZoomRange {
  min: number;
  max: number;
  step: number;
}

export interface CameraState {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  ready: boolean;
  error: string | null;
  /** 端末のズーム機能が使える場合の範囲。nullならデジタルズーム */
  hardwareZoom: ZoomRange | null;
  zoom: number;
  setZoom: (z: number) => void;
  /** 撮影時に中央を切り抜く倍率（デジタルズーム時のみ1より大きい） */
  digitalZoom: number;
}

export const DIGITAL_ZOOM_MAX = 4;

type ZoomCapabilities = MediaTrackCapabilities & { zoom?: { min: number; max: number; step?: number } };

/** 背面カメラを高解像度で起動する */
export function useCamera(active: boolean): CameraState {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hardwareZoom, setHardwareZoom] = useState<ZoomRange | null>(null);
  const [zoom, setZoomState] = useState(1);
  const pending = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('このブラウザではカメラを使用できません（HTTPSで開いているか確認してください）');
        }
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 4032 },
            height: { ideal: 3024 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const track = stream.getVideoTracks()[0];
        trackRef.current = track;
        const st = track.getSettings?.() ?? {};
        diag('camera:start', { w: st.width, h: st.height, zoom: (track.getCapabilities?.() as { zoom?: unknown })?.zoom ? 'hw' : 'digital' });
        const caps = (track.getCapabilities?.() ?? {}) as ZoomCapabilities;
        if (caps.zoom && caps.zoom.max > caps.zoom.min) {
          setHardwareZoom({ min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step ?? 0.1 });
          setZoomState(Math.max(1, caps.zoom.min));
        }
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
          if (video.readyState >= 2) setReady(true);
          else video.onloadeddata = () => setReady(true);
        }
      } catch (e) {
        const err = e as DOMException;
        diag('camera:error', `${err.name}: ${err.message}`);
        setError(
          err.name === 'NotAllowedError'
            ? 'カメラの使用が許可されていません。端末の設定でカメラへのアクセスを許可してください。'
            : err.message || 'カメラを起動できませんでした',
        );
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      trackRef.current = null;
      setReady(false);
    };
  }, [active]);

  const setZoom = useCallback(
    (z: number) => {
      if (hardwareZoom) {
        const clamped = Math.min(hardwareZoom.max, Math.max(hardwareZoom.min, z));
        setZoomState(clamped);
        if (pending.current) cancelAnimationFrame(pending.current);
        pending.current = requestAnimationFrame(() => {
          trackRef.current
            ?.applyConstraints({ advanced: [{ zoom: clamped } as MediaTrackConstraintSet] })
            .catch(() => undefined);
        });
      } else {
        setZoomState(Math.min(DIGITAL_ZOOM_MAX, Math.max(1, z)));
      }
    },
    [hardwareZoom],
  );

  return { videoRef, ready, error, hardwareZoom, zoom, setZoom, digitalZoom: hardwareZoom ? 1 : zoom };
}
