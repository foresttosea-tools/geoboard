import { useEffect, useState } from 'react';
import { SLOT_CUSTOMER, SLOT_WORKER, createDefaultBoard, normalizeBoard, withToday } from './blackboard/model';
import { db, ensureSampleLedger, requestPersistentStorage } from './db';
import { prefs } from './lib/prefs';
import { saveCapture } from './lib/saveRecord';
import { requestMotionPermission } from './lib/sensors';
import { BoardEditor } from './screens/BoardEditor';
import { CameraScreen, type CaptureResult } from './screens/CameraScreen';
import { CaptureConfirm } from './screens/CaptureConfirm';
import { RecordDetail } from './screens/RecordDetail';
import { RecordList } from './screens/RecordList';
import { Settings } from './screens/Settings';
import { TemplateList } from './screens/TemplateList';
import type { BoardContent, CaptureMode, Ledger } from './types';

type Screen =
  | { name: 'list' }
  | { name: 'editor' }
  | { name: 'templates' }
  | { name: 'camera' }
  | { name: 'confirm'; result: CaptureResult }
  | { name: 'detail'; id: string }
  | { name: 'settings' };

/** 黒板を開くときの初期内容：その台帳で最後に使った黒板。なければ初期値（要件6.4） */
function initialBoard(ledger: Ledger): BoardContent {
  const last = normalizeBoard(ledger.lastBoard);
  if (last) return withToday(last);
  return createDefaultBoard({ customerName: ledger.customerName, worker: prefs.getWorkerName() });
}

export default function App() {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'list' });
  const [board, setBoard] = useState<BoardContent>(() => createDefaultBoard());
  const [mode, setMode] = useState<CaptureMode>('with_board');

  useEffect(() => {
    requestPersistentStorage();
    ensureSampleLedger().then(setLedger);
  }, []);

  if (!ledger) return <div className="splash">GeoBoard</div>;

  const openEditor = async () => {
    const fresh = (await db.ledgers.get(ledger.id)) ?? ledger;
    setLedger(fresh);
    setBoard(initialBoard(fresh));
    setScreen({ name: 'editor' });
  };

  switch (screen.name) {
    case 'list':
      return (
        <RecordList
          ledger={ledger}
          onShoot={openEditor}
          onOpen={(id) => setScreen({ name: 'detail', id })}
          onSettings={() => setScreen({ name: 'settings' })}
        />
      );
    case 'editor':
      return (
        <BoardEditor
          board={board}
          onBoardChange={setBoard}
          mode={mode}
          onModeChange={setMode}
          onBack={() => setScreen({ name: 'list' })}
          onOpenTemplates={() => setScreen({ name: 'templates' })}
          onNext={() => {
            // iOSの傾きセンサー許可はタップ操作の中で求める必要がある
            requestMotionPermission();
            setScreen({ name: 'camera' });
          }}
        />
      );
    case 'templates':
      return (
        <TemplateList
          onBack={() => setScreen({ name: 'editor' })}
          onPick={(t) => {
            const picked = withToday(normalizeBoard(t.content) ?? createDefaultBoard());
            // 顧客名・施工者名が空なら台帳・利用者の値で補う
            if (!picked[SLOT_CUSTOMER].value) picked[SLOT_CUSTOMER].value = ledger.customerName;
            if (!picked[SLOT_WORKER].value) picked[SLOT_WORKER].value = prefs.getWorkerName();
            setBoard(picked);
            setScreen({ name: 'editor' });
          }}
        />
      );
    case 'camera':
      return (
        <CameraScreen
          board={board}
          mode={mode}
          onBack={() => setScreen({ name: 'editor' })}
          onCaptured={(result) => setScreen({ name: 'confirm', result })}
        />
      );
    case 'confirm':
      return (
        <CaptureConfirm
          result={screen.result}
          board={board}
          mode={mode}
          onRetake={() => setScreen({ name: 'camera' })}
          onSave={async () => {
            await saveCapture({
              ledgerId: ledger.id,
              mode,
              board,
              layout: screen.result.layout,
              photo: screen.result.photo,
              geo: screen.result.geo,
              shotAt: screen.result.shotAt,
              source: 'camera',
            });
            setScreen({ name: 'list' });
          }}
        />
      );
    case 'detail':
      return <RecordDetail id={screen.id} onBack={() => setScreen({ name: 'list' })} />;
    case 'settings':
      return <Settings onBack={() => setScreen({ name: 'list' })} />;
  }
}
