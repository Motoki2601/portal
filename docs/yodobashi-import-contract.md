# ヨドバシ注文履歴PDF 取込契約

関連: #9 / #11 / #12 / #13 / PR #14

## 目的
ヨドバシ・ドット・コムの注文履歴PDFを、個人データを公開GitHubへ保存せずに共通購買スキーマへ取り込むための最小契約を定義する。

この文書は実データそのものではなく、実サンプルで確認できた構造と変換ルールだけを残す。

## 1. 実サンプルで確認できた項目
注文履歴一覧PDFから、少なくとも以下を抽出できることを確認した。

| 項目 | 取得可否 | 備考 |
|---|---|---|
| 注文日 | 可 | 注文単位 |
| 注文番号 | 可 | 注文単位 |
| 配送状態 | 可 | 例: 発送完了 |
| 商品名 | 可 | 1商品が複数行に分割される場合あり |
| 同一注文内の複数商品 | 可 | 1注文に複数明細を持てる |
| 数量 | 条件付き | 商品名中の数量表現やセット表記と、注文明細数量を分離して扱う必要あり |
| 商品コード/型番 | 条件付き | 商品名末尾等に型番が含まれるケースあり。構造化列ではない |
| 商品価格 | 不可 | 今回確認した一覧PDFでは取得できない |
| 支払総額 | 不可 | 今回確認した一覧PDFでは取得できない |
| 送料/割引/ポイント | 不可 | 一覧PDFでは確認できない |
| 到着日 | 不可 | 発送完了は確認できるが、到着日へ変換しない |

## 2. 3層構造

### raw
原本を改変せず保持する。

例:
```text
source_type = yodobashi_order_history_pdf
storage_uri = gs://<private-bucket>/raw/yodobashi/<opaque-id>.pdf
content_hash = sha256(...)
```

原本PDF、注文番号、個人の商品履歴は公開GitHubへ保存しない。

### parsed
原本から機械的に抽出した結果。推測で補わない。

```json
{
  "source_file_id": "src_xxx",
  "source_type": "yodobashi_order_history_pdf",
  "source_page": 1,
  "order_date": "2026-01-15",
  "external_order_id": "YDB-EXAMPLE-001",
  "delivery_status_raw": "発送が完了しました",
  "lines": [
    {
      "line_no": 1,
      "raw_product_name": "架空商品A 12ロール ダブル",
      "raw_text": "架空商品A 12ロール ダブル"
    }
  ],
  "parser_version": "yodobashi-pdf-v1"
}
```

### curated
商品名、カテゴリ、包装情報等を正規化した結果。AI/ルールで補正した値には根拠と確信度を持つ。

```json
{
  "purchase_order_id": "po_xxx",
  "source_file_id": "src_xxx",
  "merchant": "yodobashi",
  "external_order_id": "YDB-EXAMPLE-001",
  "ordered_at": "2026-01-15",
  "status": "shipped",
  "lines": [
    {
      "purchase_line_id": "pl_xxx",
      "raw_product_name": "架空商品A 12ロール ダブル",
      "normalized_product_name": "架空商品A",
      "package_count": 12,
      "package_unit": "roll",
      "ordered_quantity": null,
      "product_code": null,
      "normalization_method": "rule_or_ai",
      "normalization_confidence": 0.80
    }
  ]
}
```

`ordered_quantity` を、商品名中の `12ロール` や `2個セット` から勝手に `12` / `2` と確定しない。包装内個数と注文数量を別項目にする。

## 3. 共通スキーマへの対応

### source_files
- `source_file_id`
- `source_type`
- `storage_uri`
- `content_hash`
- `ingested_at`
- `parser_version`
- `parse_status`
- `page_count`

### purchase_orders
- `purchase_order_id`
- `source_file_id`
- `merchant`
- `external_order_id`
- `ordered_at`
- `ordered_at_semantics = order_date`
- `status_raw`
- `status_normalized`

### purchase_lines
- `purchase_line_id`
- `purchase_order_id`
- `line_no`
- `raw_product_name`
- `normalized_product_name`
- `ordered_quantity`
- `package_count`
- `package_unit`
- `product_code`
- `category`
- `normalization_method`
- `normalization_confidence`

### financial_transactions
Money Forward等の決済データは注文とは別テーブルで保持する。

### transaction_order_links
ヨドバシ注文と金融明細の対応が十分に確からしい場合だけリンクを作る。

- `financial_transaction_id`
- `purchase_order_id`
- `match_method`
- `match_score`
- `match_status`
- `matched_at`
- `confirmed_by_user`

## 4. Money Forwardとの突合
価格がヨドバシ一覧PDFから取れないため、金額は原則として金融明細側から取得する。

自動リンク候補は複数条件で作る。

1. 店舗/摘要がヨドバシ系表記
2. 金融明細日が注文日・発送日・決済日として妥当な範囲
3. 他のヨドバシ注文候補と競合しない
4. 注文番号等の強い識別子が取得できる場合は優先

`日付 + 金額` だけで確定リンクしない。金額はPDF側にないため、今回のヨドバシ一覧PDFでは日付だけの自動確定を禁止する。

初期ルール:
- `match_status = candidate`: 機械的候補
- `match_status = confirmed`: ユーザー確認済み、または強い外部ID一致
- `match_status = rejected`: 誤突合

## 5. 重複防止

### ファイル単位
`content_hash` が同じ原本は再取込しても同一 `source_file` とみなす。

### 注文単位
`merchant + external_order_id` を第一候補の自然キーとする。

### 明細単位
ヨドバシ一覧PDFでは安定した外部明細IDを確認できていないため、`external_order_id + line_no + raw_product_name` をパーサ内部の暫定キーにする。

同一注文内の同名商品が複数明細として存在する可能性があるため、商品名だけで重複排除しない。

## 6. 在庫への反映
注文履歴取込だけでは現在庫を増やさない。

- `purchase_order`: 発注/購入履歴
- `inventory_receipt`: 入荷確認後に在庫加算
- 過去履歴取込: 補充周期の参考には使うが、現在庫の確定値には使わない

発送完了を到着済みとみなして自動で在庫加算しない。

## 7. provenance
各正規化値がどこから来たか追跡できるようにする。

最低限:
- `source_file_id`
- `source_page`
- `raw_text`
- `parser_version`
- `normalization_method`
- `normalization_confidence`

将来、Portalで「元データを見る」を実装する場合も、公開URLではなく認証済みの原本参照経路を使う。

## 8. 今回の未解決事項
- 注文詳細/領収書PDFで価格・数量・割引・送料まで取得できるか
- ポイント利用/還元を支払金額とどう分離するか
- 分割発送時に1注文をどの粒度で扱うか
- 返品/キャンセルの一覧表示と原本項目
- 商品JAN等の安定識別子を別画面から取得できるか
- Amazon等の他ECと共通化した最終スキーマ

## 9. #13の次の完了条件
- この契約を基にヨドバシ用 parsed / curated JSON のサンプルを匿名データで固定する
- Money Forwardとの候補リンク規則をサンプルケースで検証する
- #11へ共通エンティティとキー設計を渡す
- #12へ raw原本保管・BigQuery配置・取込処理の要件を渡す
