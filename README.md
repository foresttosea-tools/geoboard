# GeoBoard

現場の設置工事を、黒板付きの写真で記録するPWA。

- 要件定義書：[docs/requirements.md](docs/requirements.md)
- 画面一覧・画面遷移：[docs/screens.md](docs/screens.md)

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
- [ ] ステップ3：Supabaseとの同期
- [ ] ステップ4：重複検出・統合、衝突処理
- [ ] ステップ5：PC管理画面
