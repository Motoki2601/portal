# マイポータル

個人用のポータルアプリ。Googleログイン後、以下のリストを管理できる。

- 欲しいものリスト
- 作ってみたい料理
- 読んだ本（Google Books検索でタイトル/著者を補完）
- つぶやきメモ（近日公開）

各データはFirebase Authでログインしたユーザーごとに、Firestoreへリアルタイム同期される。

## 使用技術

- React 19 / TypeScript / Vite
- Tailwind CSS
- Firebase (Authentication / Firestore)

## 開発

```bash
npm install
npm run dev
```

## ビルド

```bash
npm run build
```

読んだ本のGoogle Books検索でAPIキーを使う場合は `VITE_GOOGLE_BOOKS_API_KEY` を環境変数で渡す（未設定でもキーなしでAPIは動くが、リクエスト数が多いとレート制限にかかりやすい）。

## デプロイ

`main` ブランチへのpushで GitHub Actions (`.github/workflows/deploy.yml`) が GitHub Pages へ自動デプロイする。
