# ブランド素材

## 元データ（原本・手で編集しない）

| ファイル | 内容 |
|---|---|
| `mark.png` | T マーク（1254×1254）。ユーザー提供の公式ロゴ |
| `logo.png` | 横組みロゴ（1672×941）。ユーザー提供の公式ロゴ |

この 2 つが唯一の原本です。以下の生成物はすべてスクリプトから作り直せます。

## 生成コマンド

```bash
npx tsx scripts/brand-assets.ts        # アイコン・横組みロゴ・OGP
npx tsx scripts/line-richmenu-image.ts # LINE Rich Menu の画像
```

どちらも `sharp`（devDependency）だけで動きます。日本語は Windows の Noto Sans JP を SVG 経由で描画しています。

## 生成物と用途

| ファイル | サイズ | 用途 |
|---|---|---|
| `src/app/icon.png` | 256×256 | ファビコン（Next の app icon 規約で自動配信） |
| `src/app/apple-icon.png` | 180×180 | iOS のホーム画面アイコン |
| `mark-192.png` / `mark-512.png` | 192 / 512 | PWA マニフェストのアイコン（`src/app/manifest.ts`） |
| `logo-wide.png` | 高さ 96（透過） | ヘッダー・ホーム・ログインの横組みロゴ |
| `src/app/opengraph-image.png` | 1200×630 | OGP（SNS・LINE のリンクカード） |
| `src/app/twitter-image.png` | 1200×630 | Twitter カード（OGP と同一画像） |
| `../line/richmenu.png` | 2500×1686 | LINE Rich Menu。`scripts/line-richmenu.ts` が存在すれば自動で使う |

## 実装メモ

- **マーク（アイコン類）は不透明**にしています。マーク内部の本・ペン先が白で描かれているため、白を透明化すると穴が空くからです。背景は `--bg`（`#fafaf7`）で塗っています。
- **横組みロゴは透過**です。原本の背景がオフホワイト（`#f7f7f5` 前後）で `sharp` の `unflatten`（純白のみ透過）では抜けないため、明度からアルファを作る処理を `scripts/brand-assets.ts` の `transparentLogo()` に実装しています。
- **OGP は静的 PNG** です。`ImageResponse`（`@vercel/og`）を使うと standalone Docker に実行時依存が増えるため、ビルド前に生成した画像をコミットする方式にしています。
- **Rich Menu の絵柄はタップ領域と一致**させています。領域は `scripts/line-richmenu.ts` が幅 3 等分・高さ 2 等分で定義しているので、画像側のカードもその 6 セルの内側に描いています（上段 READ / WRITE / CODE、下段 今日の学習 / 履歴 / PROFILE）。並びを変えるときは両方を直してください。
- Rich Menu 画像は LINE の制限（1MB 以下）に収まっています（現在 56KB）。
