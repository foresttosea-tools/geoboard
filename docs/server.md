# サーバー（Supabase）の準備と引っ越し

## 初回の準備

1. Supabaseでプロジェクトを作る（リージョンは Northeast Asia (Tokyo)）
   - Security：「Automatically expose new tables」はオフ、「Enable automatic RLS」はオン
2. SQL Editor で `supabase/migrations/` のSQLを古い順に実行する
3. Authentication → Sign In / Providers で「Allow new users to sign up」をオフにする
4. Authentication → Users → Add user → Create new user でアカウントを作る（「Auto Confirm User」にチェック）
   - SQLを実行した後に最初に作ったアカウントが、自動で管理者になる
5. アプリの接続先（URLと公開用キー）を `src/sync/config.ts` の初期値、または設定画面（管理者）で指定する

## ステップ4の追加（2026-11-19）

すでに初期スキーマを実行済みのプロジェクトでは、SQL Editor で `supabase/migrations/20261119000000_step4.sql` の内容をまるごと1回実行する。

- 追加されるもの：項目単位のマージと衝突の記録、変更履歴・操作ログ（change_logs）、通知（notifications）、重複ではないペア（duplicate_dismissals）、台帳の統合・取り消し（merge_ledgers / unmerge_ledger）
- 似た名前の判定に `fuzzystrmatch` 拡張（Supabase標準）を使う
- 実行前の端末（古い版のアプリ）から送られたデータも、これまでどおり行ごと受け付ける

## 無料プランの一時停止対策

- Supabaseの無料プランは、1週間アクセスがないとプロジェクトが一時停止される
- `.github/workflows/keepalive.yml` が毎週月曜12:17（日本時間）にサーバーへ軽くアクセスして、停止を防ぐ（GitHubの Actions タブから手動でも実行できる）
- サーバーが応答しないとワークフローが失敗し、GitHubからメールが届く。届いたらSupabaseの管理画面でプロジェクトが止まっていないか確認する
- GitHubは、公開リポジトリに60日間コミットなどの動きがないと、定期実行を自動で止める（事前にメールが届く）。届いたら Actions タブで有効に戻す
- 有料プランに切り替えたら、このワークフローは削除してよい

## 保存容量の確認

- PC管理画面の「保存容量」（管理者）で写真の使用量を確認できる。Supabaseの管理画面の Storage でも見られる
- 黒板を修正すると古い版の写真がサーバーに残るので、同じ画面の「古い写真を削除」でときどき片付ける

## アカウントの運用

- アカウントの発行：Supabaseの管理画面（上記4）。表示名は各自がアプリの設定画面で変更できる
- 権限の変更・アカウントの停止：アプリの設定画面（管理者のみ）
- 停止されたユーザーの端末は、次に電波が入ったときに未送信データを送ってからログアウトする

## 引っ越し（セルフホスト版Supabaseなど）

1. 全員のスマホで未送信データがないことを確認する（設定画面の「同期」）
2. データベースを書き出す：`pg_dump`（接続情報は Project Settings → Database）
3. 写真（Storageの `photos` バケット）を丸ごとコピーする
4. 引っ越し先で `supabase/migrations/` のSQLを流してから、データを読み込む
5. アプリの設定画面（管理者）で接続先を変更する。各端末はログインし直しになる

## テストデータを消すとき

1. Supabaseの SQL Editor で顧客・台帳・記録などの表を空にし、Storage の `photos` の中身を削除する（ステップ4以降は change_logs・notifications・duplicate_dismissals も空にする。外部キーがあるため duplicate_dismissals → records の子（record_extras）→ records → ledgers → customers の順）
2. 管理画面での直接の削除はスマホに伝わらないため、全員のスマホでアプリの設定 →「この端末のデータを消して、サーバーから取り直す」を押す
