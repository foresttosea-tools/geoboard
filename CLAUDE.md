# GeoBoard 開発ガイド（Claude Code向け）

現場の設置工事を記録する社内向けPWA。工事黒板を重ねた写真を撮影し、顧客 > 台帳 > 作業記録の階層で保存する。圏外での利用が前提。

## 必ず読むドキュメント

- 要件定義書：`docs/requirements.md`
- 画面一覧・画面遷移：`docs/screens.md`

仕様に迷ったら上記を正とする。上記に書かれていない仕様を勝手に決めず、確認すること。

## 技術構成

React + TypeScript + Vite / vite-plugin-pwa / Dexie.js（IndexedDB）/ Supabase / Canvas API / Leaflet + 国土地理院タイル / pdfmake / JSZip / GitHub Pages

- サーバー操作は必ず `DataProvider` インターフェース（接続先アダプター）経由で行う。Supabase SDKを画面コンポーネントから直接呼ばない
- IDは端末側でUUID v4を生成する（オフライン作成のため）

## セキュリティルール（公開リポジトリ）

- コミットしてよいのはSupabaseの公開用キー（anon key）のみ
- service_role key、パスワード、トークンなどの秘密情報は絶対にコミットしない
- 実在の顧客名・写真・位置情報をコミットしない。サンプルデータは架空の名前で作る
- `.env*` ファイルはコミットしない

## 開発ステップ

要件定義書の「12. 開発ステップ」の順に進める。進捗は README.md の「進捗」を参照。

## コマンド

- `npm run dev`：開発サーバー
- `npm run build`：型チェック＋本番ビルド（変更後は必ず通すこと）
- `npx oxlint`：Lint

## コード構成

- `src/blackboard/`：黒板の定義（`model.ts`）と描画（`render.ts`）。プレビューも写真への合成も同じ `drawBoard` を使う
- `src/lib/`：カメラ、センサー（位置情報・水平器）、画像処理、保存処理
- `src/screens/`：画面（`docs/screens.md` の画面IDに対応）
- `src/db.ts`：IndexedDB（Dexie）の定義
