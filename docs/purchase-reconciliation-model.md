# 共通購買スキーマと決済突合モデル

関連: #9 / #11 / #12 / #13 / PR #14

## 目的
EC注文履歴とMoney Forward ME等の金融明細を、二重計上せずに共通モデルへ取り込み、後続の在庫・補充判断へ安全に接続できる論理モデルを定義する。

この文書は公開可能な設計のみを扱う。実際の注文番号、商品名、金融機関名、個人の取引履歴はGitHubへ保存しない。

## 1. 設計原則
- EC原本と金融明細は別ソースとして保持する。
- 注文、注文明細、決済、在庫イベントを別エンティティに分ける。
- 「カード明細がある」ことと「商品を購入した」ことを同一視しない。
- 「発送完了」を「入荷済み」と同一視しない。
- 原本から直接取得した値と、正規化・推定した値を分ける。
- 確定できない対応は候補として保持し、勝手に確定しない。
- 再取込で同じ注文・決済・在庫イベントが増えないことを優先する。

## 2. エンティティ

### source_files
原本ファイルとパーサ処理状態を管理する。

主な項目:
- source_file_id
- user_id
- source_type
- storage_uri
- content_hash
- ingested_at
- parser_version
- parse_status
- page_count

同一ユーザー・同一content_hashの再取込は原則no-opとする。

### purchase_orders
EC上の注文単位。

主な項目:
- purchase_order_id
- user_id
- source_file_id
- merchant
- external_order_id
- ordered_at
- ordered_at_semantics
- status_raw
- status_normalized
- currency
- order_total_amount
- order_total_source

`order_total_amount` が原本から取得できない場合はnullを許容する。金融明細から推測して上書きしない。

自然キー候補:
- user_id + merchant + external_order_id

### purchase_lines
注文内の商品明細。

主な項目:
- purchase_line_id
- purchase_order_id
- external_line_id
- line_no
- raw_product_name
- normalized_product_name
- ordered_quantity
- ordered_unit
- package_count
- package_unit
- unit_price
- line_amount
- product_code
- product_url
- category
- normalization_method
- normalization_confidence

`ordered_quantity` と `package_count` は別概念として扱う。商品名中の「12ロール」「2個セット」を注文数量として自動確定しない。

### financial_transactions
Money Forward ME等の金融明細。

主な項目:
- financial_transaction_id
- user_id
- source_system
- source_account_ref
- source_record_id
- source_date
- description_raw
- description_normalized
- amount
- currency
- category_major
- category_minor
- is_transfer
- included_in_budget
- memo_raw
- import_id
- row_number
- parser_version

カード明細だけからproduct / purchase_line / inventory_eventを自動作成しない。

### transaction_order_links
注文と金融明細の対応関係。分割請求、複数注文の合算、返金を考慮して多対多を許容する。

主な項目:
- transaction_order_link_id
- financial_transaction_id
- purchase_order_id
- link_type
- allocated_amount
- match_method
- match_score
- match_status
- matched_at
- confirmed_by_user
- evidence_summary

`match_status`:
- candidate: 機械的候補
- confirmed: ユーザー確認済み、または強い外部ID一致
- rejected: 誤突合

`link_type` 例:
- payment
- refund
- partial_payment
- combined_payment

### inventory_events
物理在庫に影響するイベント。

主な項目:
- inventory_event_id
- user_id
- product_or_variant_id
- purchase_line_id
- event_type
- occurred_at
- recorded_at
- quantity
- unit
- source_type
- idempotency_key
- supersedes_event_id

購入履歴を取り込んだだけでは在庫を増やさない。在庫増加は原則 `receipt` / `initial_balance` 等の明示イベントで行う。

## 3. 突合ルール

### 強い根拠
以下が取れる場合は優先する。
- 注文番号や決済参照番号の一致
- EC側に決済トランザクションIDがあり、金融側と対応できる
- 返金元注文を特定できる外部ID

強い根拠が1つあり、競合候補がなければ `confirmed` にできる。

### 弱い根拠
- merchant/加盟店表記
- 日付差
- 金額
- 近接した注文の有無
- 摘要中のEC名

弱い根拠のみの場合は `candidate` に留める。

### ヨドバシ一覧PDFの場合
現時点で注文金額が一覧PDFから取得できないため、日付だけの一致で自動確定しない。

候補条件:
1. 金融明細のdescriptionがヨドバシ系表記
2. source_dateがordered_atから妥当な期間内
3. 競合する未確定ヨドバシ注文がない

この3条件を満たしても `candidate` とする。

### Money Forward側の日付
Money Forwardの `source_date` は注文日、発送日、入荷日と同一とは限らない。日付差はスコアリング要素に使えるが、意味を上書きしない。

## 4. 初期スコアリング案
最初は説明可能なルールベースに限定する。

例:
- 強い外部ID一致: +100
- merchant一致: +30
- 日付差0〜2日: +20
- 日付差3〜7日: +10
- 金額完全一致: +30
- 候補が1件のみ: +10
- 同期間に競合注文あり: -30
- merchant不一致: -50

判定例:
- 100以上かつ強い外部ID一致: confirmed候補
- 40〜99: candidate
- 39以下: 自動リンクしない

この閾値は実データ検証後に調整する。ヨドバシ一覧PDFのようにEC側金額がない場合は、金額点を付けられないため自動confirmedにしない。

## 5. 二重計上防止

### 注文
`user_id + merchant + external_order_id` を第一候補の同一性キーとする。

### 注文明細
external_line_idがあれば利用する。ない場合は `purchase_order_id + line_no + raw_product_name` を暫定キーとする。

### 金融明細
Money Forwardでは `user_id + source_system + source_account_ref + source_record_id` を同一性の第一候補とする。

### 在庫
purchase_order / purchase_line作成だけでは増加させない。入荷時にinventory_eventを作成し、idempotency_keyで再送を防ぐ。

## 6. 代表ケース

### Case A: 1注文 = 1決済
- purchase_order: 1
- financial_transaction: 1
- transaction_order_link: 1 payment
- 入荷時にinventory_eventを作成

### Case B: 1注文 = 複数商品
purchase_orderは1件、purchase_linesは複数件。決済は注文単位でリンクし、金融明細を各商品へ無理に按分しない。

### Case C: 複数注文 = 1決済
複数のpurchase_orderから同一financial_transactionへlinksを作れる。allocated_amountは根拠がある場合のみ設定する。

### Case D: 1注文 = 複数請求
1つのpurchase_orderに複数financial_transactionsをリンクする。

### Case E: 返金
返金のfinancial_transactionを元注文へ `link_type = refund` で関連付ける。在庫を自動で戻さず、返品・廃棄等のinventory_eventは別途扱う。

### Case F: EC注文はあるが決済明細が見つからない
注文は保持する。金融明細へのリンクを必須にしない。

### Case G: 金融明細はあるが商品が分からない
financial_transactionのみ保持する。商品・在庫を生成しない。

## 7. provenance
正規化・突合結果の根拠を追跡できるようにする。

最低限:
- source_file_id
- source_page / row_number
- raw_text / description_raw
- parser_version
- normalization_method
- normalization_confidence
- match_method
- match_score
- evidence_summary

## 8. #11への引き渡し
#11ではこの文書を土台に、商品/バリエーション/個体・ロットとinventory_eventsを接続する。

確定済みとして扱ってよい点:
- purchase_orders / purchase_lines / financial_transactions / transaction_order_links は分離する。
- 決済と在庫は直接つながない。
- purchase_line と inventory_event を必要に応じて関連付ける。
- 多対多決済を許容する。
- 未確定リンクはcandidateとして保持する。

Amazon等の実サンプル確認後に確定する点:
- external_line_id / product_code / product_urlの取得可否
- 商品数量・単価・割引・送料の粒度
- 分割発送と注文ステータスの扱い

## 9. #12への引き渡し
技術選定では最低限以下を満たす必要がある。
- raw原本を非公開オブジェクトストレージへ保存できる
- parsed / curated / reconciliationを分離できる
- 多対多リンクと履歴更新を扱える
- Portalから原本・BigQuery等へ直接アクセスさせず、認証済みAPI経由にできる
- source_filesとparser_versionで再処理を追跡できる

## 10. 残る検証
- Amazon原本の取得形式と項目
- ヨドバシ注文詳細/領収書で金額・数量・送料・割引が取得できるか
- ポイント利用と返金の表現
- 分割発送時の注文/発送粒度
- 5〜10件程度の匿名fixtureで候補突合を試し、誤突合率を確認
