# GeoBoard

現場の設置工事を、黒板付きの写真で記録するPWA。

- 要件定義書：[docs/requirements.md](docs/requirements.md)
- 画面一覧・画面遷移：[docs/screens.md](docs/screens.md)
- サーバーの準備と引っ越し：[docs/server.md](docs/server.md)

## 開発

```bash
npm install
npm run dev      # 開発サーバー（http://localhost:5173/geoboard/）
npm run build    # 本番ビルド（dist/）
npm run preview  # ビルド結果の確認
```

カメラと位置情報はHTTPSか `localhost` でしか動かないため、スマホでの動作確認は GitHub Pages に公開したURLで行う。

## 公開

`main` ブランチにpushすると、GitHub Actions（`.github/workflows/deploy.yml`）が自動でビルドし、GitHub Pagesに公開する。

## 進捗

- [x] ステップ1：黒板と撮影（オフライン）
- [x] ステップ2：顧客・台帳・作業記録の管理
- [x] ステップ3：Supabaseとの同期
- [x] ステップ4：重複検出・統合、衝突処理（項目単位マージ、変更履歴からの復元、通知、操作ログ。`supabase/migrations/20261119000000_step4.sql` の実行が必要）
- [x] ステップ5：PC管理画面（`#admin`）
- [x] ステップ4のSQLは本番のSupabaseに実行済み（2026-11-19）

## 残っていること（2026-11-19時点）

- 実機での確認
  - ステップ4：同時編集・通知・変更履歴からの復元・重複の検出と統合・取り消し・「重複ではない」・操作ログ
  - PC：PDF・ZIPのファイル名（日本語になるか）、地図の表示、PDFの日本語フォント
  - テスト項目の残り：電波が弱い場所での送信、1日以上たってからの送信
- Pixel 11 Proで保存後に固まった件（v0.3.1）：再現待ち。起きたら設定画面の診断ログで原因を調べる
- 本番運用の前に、Supabaseのテストデータを消す（`docs/server.md` の「テストデータを消すとき」）
- アカウントの発行（`docs/server.md` の「アカウントの運用」）
- GitHub・Supabaseを会社用アカウントの管理に移す（URL・接続先は変えない）
- 保留：本番のサーバー（当面はSupabase無料プラン＋週1回のアクセスで一時停止を防ぐ。容量は数年もつ見込み）、協力会社の利用ルール

## Claude Code のクラウド環境

- ネットワーク：Supabaseのホスト `fmmqxpunqxwxrsicfbev.supabase.co` への通信を許可する
- セットアップスクリプト：`if [ -d geoboard ]; then (cd geoboard && npm ci); fi`
