import { useLiveQuery } from 'dexie-react-hooks';
import { lazy, Suspense, useEffect, useState } from 'react';
import { SLOT_CUSTOMER, SLOT_WORKER, createDefaultBoard, normalizeBoard, withToday } from './blackboard/model';
import { db, requestPersistentStorage } from './db';
import { getProvider } from './sync/config';
import { resetSyncState } from './sync/engine';
import { useAuthSession, useMyProfile, useSyncState } from './sync/hooks';
import { Login } from './screens/Login';
const AdminApp = lazy(() => import('./admin/AdminApp').then((m) => ({ default: m.AdminApp })));
import { diag } from './lib/diag';
import { prefs } from './lib/prefs';
import { createLedger, deleteLedger, updateLedger } from './lib/repo';
import { saveCapture } from './lib/saveRecord';
import { requestMotionPermission } from './lib/sensors';
import { BoardEditor } from './screens/BoardEditor';
import { BoardFix } from './screens/BoardFix';
import { CameraScreen, type CaptureResult } from './screens/CameraScreen';
import { CaptureConfirm } from './screens/CaptureConfirm';
import { CustomerList } from './screens/CustomerList';
import { ImportAdjust } from './screens/ImportAdjust';
import { LedgerForm } from './screens/LedgerForm';
import { LedgerList } from './screens/LedgerList';
import { RecordDetail } from './screens/RecordDetail';
import { RecordList } from './screens/RecordList';
import { Settings } from './screens/Settings';
import { TemplateList } from './screens/TemplateList';
import type { AuthSession } from './sync/provider';
import type { BoardContent, CaptureMode, Handover, Ledger } from './types';

const EMPTY_HANDOVER: Handover = { text: '', inReport: false };

type Screen =
  | { name: 'customers' }
  | { name: 'ledgers'; customerId: string }
  | { name: 'ledgerNew'; customerId: string }
  | { name: 'ledgerEdit' }
  | { name: 'records' }
  | { name: 'editor' }
  | { name: 'templates' }
  | { name: 'camera' }
  | { name: 'confirm'; result: CaptureResult }
  | { name: 'import' }
  | { name: 'detail'; id: string; ids: string[] }
  | { name: 'boardFix'; id: string; ids: string[] }
  | { name: 'settings'; from: Screen };

/**
 * 施工者名を設定の値で上書きする（要件4.3：施工者名の初期値はログインユーザー名）。
 * 設定が空のときは元の値を残す
 */
function withCurrentWorker(board: BoardContent): BoardContent {
  const worker = prefs.getWorkerName().trim();
  if (!worker) return board;
  return board.map((it, i) => (i === SLOT_WORKER ? { ...it, value: worker } : it));
}

/** 黒板を開くときの初期内容：その台帳で最後に使った黒板。なければ初期値（要件6.4） */
function initialBoard(ledger: Ledger, customerName: string): BoardContent {
  const last = normalizeBoard(ledger.lastBoard);
  if (last) return withCurrentWorker(withToday(last));
  return createDefaultBoard({ customerName, worker: prefs.getWorkerName() });
}

export default function App() {
  const session = useAuthSession();
  const sync = useSyncState();
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  // 管理者に停止されたら、未送信データを送り終えた時点でログアウトする（要件4.1）
  useEffect(() => {
    if (!sync.accountDisabled) return;
    void getProvider()
      .signOut()
      .then(() => {
        setLoginNotice('このアカウントは管理者によって停止されました。未送信のデータは送信済みです');
        resetSyncState();
      });
  }, [sync.accountDisabled]);

  if (session === undefined) return <div className="splash">GeoBoard</div>;
  if (session === null) return <Login notice={loginNotice} />;
  // PC管理画面は別のURL（…/geoboard/#admin）で開く
  if (hash === '#admin')
    return (
      <Suspense fallback={<div className="splash">GeoBoard 管理画面</div>}>
        <AdminApp session={session} />
      </Suspense>
    );
  return <MainApp session={session} />;
}

function MainApp({ session }: { session: AuthSession }) {
  const me = useMyProfile();
  const isAdmin = me?.role === 'admin' && !me.disabled;
  // 前回開いていた台帳から再開する
  const [ledgerId, setLedgerId] = useState<string | null>(() => prefs.getLastLedger());
  const [screen, setScreen] = useState<Screen>(() => (prefs.getLastLedger() ? { name: 'records' } : { name: 'customers' }));
  const [board, setBoard] = useState<BoardContent>(() => createDefaultBoard());
  const [mode, setMode] = useState<CaptureMode>('with_board');
  const [handover, setHandover] = useState<Handover>(EMPTY_HANDOVER);
  // 黒板編集のあと、撮影に進むか取り込みに進むか
  const [importFiles, setImportFiles] = useState<File[] | null>(null);

  // 直前の台帳の結果が一瞬残るため、どのIDで読んだ結果かを持たせて照合する
  const ledgerRes = useLiveQuery(async () => ({ id: ledgerId, value: ledgerId ? ((await db.ledgers.get(ledgerId)) ?? null) : null }), [ledgerId]);
  const ledger = ledgerRes && ledgerRes.id === ledgerId ? ledgerRes.value : undefined;
  const customerId = ledger?.customerId ?? null;
  const customerRes = useLiveQuery(async () => ({ id: customerId, value: customerId ? ((await db.customers.get(customerId)) ?? null) : null }), [customerId]);
  const customer = customerRes && customerRes.id === customerId ? customerRes.value : undefined;

  useEffect(() => {
    requestPersistentStorage();
  }, []);

  // 開いていた台帳が削除されていたら顧客一覧に戻す
  const ledgerMissing = ledger === null || ledger?.deletedAt != null;
  useEffect(() => {
    if (ledgerMissing) prefs.setLastLedger(null);
  }, [ledgerMissing]);

  const openLedger = (id: string) => {
    setLedgerId(id);
    prefs.setLastLedger(id);
    setScreen({ name: 'records' });
  };
  const leaveLedger = () => {
    prefs.setLastLedger(null);
    setScreen(ledger ? { name: 'ledgers', customerId: ledger.customerId } : { name: 'customers' });
  };

  // 台帳を扱う画面で、台帳がまだ読み込まれていない・見つからない場合
  const needsLedger = !['customers', 'ledgers', 'ledgerNew', 'settings'].includes(screen.name);
  if (needsLedger) {
    if (ledger === undefined || (ledger && customer === undefined)) return <div className="splash">GeoBoard</div>;
    if (ledgerMissing) {
      return <CustomerList onOpen={(id) => setScreen({ name: 'ledgers', customerId: id })} onSettings={() => setScreen({ name: 'settings', from: { name: 'customers' } })} />;
    }
  }
  const customerName = customer?.name ?? '';

  const openEditor = (files: File[] | null) => {
    if (!ledger) return;
    setBoard(initialBoard(ledger, customerName));
    // 引継ぎ事項は前回の内容を引き継がない
    setHandover(EMPTY_HANDOVER);
    setImportFiles(files);
    setScreen({ name: 'editor' });
  };

  switch (screen.name) {
    case 'customers':
      return (
        <CustomerList
          onOpen={(id) => setScreen({ name: 'ledgers', customerId: id })}
          onSettings={() => setScreen({ name: 'settings', from: screen })}
        />
      );
    case 'ledgers':
      return (
        <LedgerList
          customerId={screen.customerId}
          onBack={() => setScreen({ name: 'customers' })}
          onOpen={openLedger}
          onCreate={() => setScreen({ name: 'ledgerNew', customerId: screen.customerId })}
        />
      );
    case 'ledgerNew':
      return (
        <LedgerNewScreen
          customerId={screen.customerId}
          onBack={() => setScreen({ name: 'ledgers', customerId: screen.customerId })}
          onCreated={openLedger}
        />
      );
    case 'ledgerEdit':
      return (
        <LedgerForm
          title="台帳情報"
          customerName={customerName}
          initial={ledger!}
          onBack={() => setScreen({ name: 'records' })}
          onSave={async (input) => {
            await updateLedger(ledger!.id, input);
            setScreen({ name: 'records' });
          }}
          onDelete={
            isAdmin
              ? async () => {
                  if (!confirm(`台帳「${ledger!.name}」を削除しますか？\nPC管理画面の「削除済みデータ」から元に戻せます。`)) return;
                  await deleteLedger(ledger!.id);
                  prefs.setLastLedger(null);
                  setScreen({ name: 'ledgers', customerId: ledger!.customerId });
                }
              : undefined
          }
        />
      );
    case 'records':
      return (
        <RecordList
          ledger={ledger!}
          customerName={customerName}
          onBack={leaveLedger}
          onEditLedger={() => setScreen({ name: 'ledgerEdit' })}
          onShoot={() => openEditor(null)}
          onImport={(files) => openEditor(files)}
          onOpen={(id, ids) => setScreen({ name: 'detail', id, ids })}
        />
      );
    case 'editor':
      return (
        <BoardEditor
          board={board}
          onBoardChange={setBoard}
          mode={mode}
          onModeChange={setMode}
          handover={handover}
          onHandoverChange={setHandover}
          nextLabel={importFiles ? (importFiles.length > 1 ? `${importFiles.length}枚の写真から記録を作る` : '写真に黒板を配置') : '撮影に進む'}
          dateHint={
            importFiles
              ? importFiles.length > 1
                ? '選んだ写真は1つの記録になります。黒板はメイン写真に付き、ほかは追加写真になります。撮影日はメイン写真の撮影日時から自動で入ります'
                : '撮影日は写真の撮影日時から自動で入ります'
              : undefined
          }
          onBack={() => setScreen({ name: 'records' })}
          onOpenTemplates={() => setScreen({ name: 'templates' })}
          onNext={() => {
            if (importFiles) {
              setScreen({ name: 'import' });
              return;
            }
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
            const picked = withCurrentWorker(withToday(normalizeBoard(t.content) ?? createDefaultBoard()));
            // 顧客名が空なら台帳の顧客名で補う
            if (!picked[SLOT_CUSTOMER].value) picked[SLOT_CUSTOMER].value = customerName;
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
              ledgerId: ledger!.id,
              mode,
              board,
              handover,
              layout: screen.result.layout,
              photo: screen.result.photo,
              geo: screen.result.geo,
              shotAt: screen.result.shotAt,
              source: 'camera',
            });
            diag('confirm:navigate');
            setScreen({ name: 'records' });
          }}
          onGiveUp={() => setScreen({ name: 'records' })}
        />
      );
    case 'import':
      return (
        <ImportAdjust
          files={importFiles ?? []}
          ledgerId={ledger!.id}
          board={board}
          mode={mode}
          handover={handover}
          onBack={() => setScreen({ name: 'editor' })}
          onDone={() => {
            setImportFiles(null);
            setScreen({ name: 'records' });
          }}
        />
      );
    case 'detail':
      return (
        <RecordDetail
          id={screen.id}
          ids={screen.ids}
          onNavigate={(id) => setScreen({ ...screen, id })}
          onBack={() => setScreen({ name: 'records' })}
          onFixBoard={(id) => setScreen({ name: 'boardFix', id, ids: screen.ids })}
        />
      );
    case 'boardFix':
      return <BoardFix recordId={screen.id} onBack={() => setScreen({ name: 'detail', id: screen.id, ids: screen.ids })} />;
    case 'settings':
      return <Settings session={session} onBack={() => setScreen(screen.from)} />;
  }
}

function LedgerNewScreen({ customerId, onBack, onCreated }: { customerId: string; onBack: () => void; onCreated: (id: string) => void }) {
  const customer = useLiveQuery(() => db.customers.get(customerId), [customerId]);
  return (
    <LedgerForm
      title="台帳を追加"
      customerName={customer?.name ?? ''}
      onBack={onBack}
      onSave={async (input) => {
        const l = await createLedger(customerId, input);
        onCreated(l.id);
      }}
    />
  );
}
