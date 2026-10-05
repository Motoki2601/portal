# Gmail raw MIMEの独立受入試験（#34）

2026-10-06。GCP/Google OAuth/実メールに依存しない試験セット。入力・宛先・注文番号・商品名・金額は完全な合成値。[取込契約](gmail-import-contract.md)の復号境界を検証する。#33のOAuthや#34全体の受入完了を意味しない。

## 成果物

- `fixtures/gmail-mime-v1.json`: 23件のraw base64urlと期待結果。特定parserに依存しないため将来のNode decoderでも同じ入力/期待結果を使用できる。
- `scripts/personal_commerce/build_gmail_mime_fixtures.py`: mailbox/networkを参照しない決定的な生成器。JSONと生成結果の一致を検証する。
- `scripts/personal_commerce/gmail_mime_reference.py`: Python標準ライブラリのオフライン参照decoder。MIME tree→transfer encoding→charsetを処理し、plainだけを返す。production runtime/PII除去処理ではない。
- `scripts/personal_commerce/test_gmail_mime_reference.py`: 23ケースの期待結果、再生成一致、失敗時の本文非返却を検証。既存Python CIで実行し、fixture JSONだけの変更でも起動する。

## 検証ケース

| 境界 | ケース・期待結果 |
|---|---|
| charset | ISO-2022-JP/UTF-8正常、壊れたUTF-8/ISO-2022-JP、未知charset、U+FFFD、charsetなし非ASCII |
| transfer | 7bit/8bit/base64/quoted-printable正常、壊れたbase64/QP、未対応encoding |
| plain優先 | plain/HTML双方の順序、入れ子alternative。HTMLを追加計上しない |
| MIME構造 | 添付plainを本文にしない、複数plainは曖昧、boundary不良、Content-Type重複、転送メール |
| fallback | HTML-onlyはHTML_UNVERIFIED、空plainはHTMLに逃げずEMPTY_PLAIN_BODY |
| raw | Gmail base64url不正はDECODE_ERROR。エラー返却には本文/header/payloadを含めない |

`decoded`は文字コード復号が成功しただけ。注文判別、注文ブロック選択、個人情報除去は未実装であり、返却textをそのままAIへ送らない。bodyのUnicode化と改行LF統一だけを行い、商品名/金額/日付は抽出・補修しない。HTMLのみ・複数plain・転送・復号不明はneeds_reviewにする保守的な参照方針。

参照decoderの試験用上限はraw1MiB、MIME深さ16/part64。上限値は本番設定の決定ではない。すべてのRFC/charset/メール形式に対応するdecoderではなく、format=flowed・HTML抽出・送信元認証等は対象外。Node向け実装方式や新規パッケージはこのPRで選定しない。

## 実行

```sh
python scripts/personal_commerce/build_gmail_mime_fixtures.py
python -m unittest discover -s scripts/personal_commerce -p 'test_*.py' -v
```

## 再開

次は本番Node decoderを同じfixture/期待結果へ接続し、契約に従う注文ブロック選択・個人情報除去を検証する。実Gmail全ページ取得、watermark、期間外retry、OAuth/Secret/IAM、Source保存は別作業。本人データ/有料call/本番変更は行わない。#34はopenを維持する。
