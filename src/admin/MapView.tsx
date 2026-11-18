import { useEffect, useRef, useState } from 'react';
import { formatShotDate } from '../components/RecordMarks';
import type { WorkRecord } from '../types';

interface Props {
  records: WorkRecord[];
  onOpen: (id: string) => void;
}

/** P05 地図：台帳内の撮影地点をピンで表示する（国土地理院タイル。要件8.1） */
export function MapView({ records, onOpen }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const located = records.filter((r) => r.latitude != null && r.longitude != null);
  const openRef = useRef(onOpen);
  useEffect(() => {
    openRef.current = onOpen;
  }, [onOpen]);
  const key = located.map((r) => `${r.id}:${r.latitude}:${r.longitude}`).join('|');

  useEffect(() => {
    const el = ref.current;
    if (!el || located.length === 0) return;
    let map: import('leaflet').Map | null = null;
    let cancelled = false;
    (async () => {
      try {
        const L = (await import('leaflet')).default;
        await import('leaflet/dist/leaflet.css');
        if (cancelled) return;
        map = L.map(el, { zoomControl: true });
        const attribution = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>';
        const std = L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', { maxZoom: 18, attribution });
        const photo = L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg', { maxZoom: 18, attribution });
        std.addTo(map);
        L.control.layers({ 標準地図: std, 航空写真: photo }, {}, { collapsed: false }).addTo(map);
        const bounds: [number, number][] = [];
        located.forEach((r, i) => {
          const pos: [number, number] = [r.latitude!, r.longitude!];
          bounds.push(pos);
          const icon = L.divIcon({ className: 'map-pin', html: `<span><b>${i + 1}</b></span>`, iconSize: [28, 28], iconAnchor: [14, 28] });
          const place = r.board?.[1]?.value || '（作業場所なし）';
          const marker = L.marker(pos, { icon, title: place }).addTo(map!);
          const box = document.createElement('div');
          box.className = 'map-popup';
          const title = document.createElement('strong');
          title.textContent = `${i + 1}. ${place}`;
          const meta = document.createElement('span');
          meta.textContent = `${formatShotDate(r)}　${r.board?.[2]?.value ?? ''}`;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = '記録を開く';
          btn.onclick = () => openRef.current(r.id);
          box.append(title, meta, btn);
          marker.bindPopup(box);
        });
        if (bounds.length === 1) map.setView(bounds[0], 16);
        else map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
      } catch (e) {
        setError(`地図を表示できませんでした：${(e as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
    // key は表示する地点の内容を表す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (located.length === 0) return <p className="empty">位置情報のある記録がありません</p>;
  return (
    <div className="map-wrap">
      <div ref={ref} className="map" />
      {error && <p className="hint danger">{error}</p>}
      <p className="hint">
        位置情報のある記録 {located.length} / {records.length}件。ピンの番号は一覧の並び（撮影日時の古い順）と同じです
      </p>
    </div>
  );
}
