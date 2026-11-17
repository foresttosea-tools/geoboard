# サーバー（Supabase）の準備と引っ越し

## 初回の準備

1. Supabaseでプロジェクトを作る（リージョンは Northeast Asia (Tokyo)）
   - Security：「Automatically expose new tables」はオフ、「Enable automatic RLS」はオン
2. SQL Editor で `supabase/migrations/` のSQLを古い順に実行する
3. Authentication → Sign In / Providers で「Allow new users to sign up」をオフにする
4. Authentication → Users → Add user → Create new user でアカウントを作る（「Auto Confirm User」にチェック）
   - SQLを実行した後に最初に作ったアカウントが、自動で管理者になる
5. アプリの接続先（URLと公開用キー）を `src/sync/config.ts` の初期値、または設定画面（管理者）で指定する

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
