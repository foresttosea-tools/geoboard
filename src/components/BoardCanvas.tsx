import { useEffect, useRef } from 'react';
import { hitTestSlot, renderBoardToCanvas } from '../blackboard/render';
import type { BoardContent } from '../types';

interface Props {
  board: BoardContent;
  width: number;
  onSlotTap?: (slot: number) => void;
  className?: string;
  style?: React.CSSProperties;
}

export function BoardCanvas({ board, width, onSlotTap, className, style }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!ref.current || width <= 0) return;
    const draw = () => ref.current && renderBoardToCanvas(ref.current, board, width);
    draw();
    // Webフォントの読み込み完了後に描き直す
    document.fonts?.ready.then(draw).catch(() => undefined);
  }, [board, width]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSlotTap) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const slot = hitTestSlot((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
    if (slot != null) onSlotTap(slot);
  };

  return <canvas ref={ref} className={className} style={style} onClick={onClick} />;
}
