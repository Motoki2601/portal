# 生活データ基盤：商品・在庫イベント論理モデル

関連: #9 / #10 / #11 / #12 / #13 / PR #14

## 目的
商品、商品バリエーション、購入明細、在庫イベント、個体/ロット、現在状態の関係を定義し、購入履歴取込と手入力のどちらからでも同じルールで在庫を再計算できる論理モデルを作る。

本設計はデータストア非依存。DDLやBigQuery/Firestore上の物理配置は #12 で決める。

## 1. 設計原則
- 購入と入荷を分ける。`purchase_line` が作成されても在庫は増やさない。
- 現在在庫はイベント履歴から導出できる状態とし、訂正時に再計算できるようにする。
- 商品の意味上の同一性と、容量・包装・型番などのバリエーションを分ける。
- 個体追跡が不要な商品は無理に1個ずつ管理しない。
- 実測値と推定値を分離する。
- 日付不明を登録日時で補完しない。
- 同一イベントの再送で在庫が二重加算されないよう `idempotency_key` を持つ。
- 訂正は元イベントを書き換えて消すのではなく、参照を残して無効化・置換する。

## 2. エンティティ関係

```text
products
  1 ── N product_variants
             1 ── N purchase_lines
             1 ── N inventory_units_or_lots
             1 ── N inventory_events

purchase_orders
  1 ── N purchase_lines
             1 ── 0..N inventory_events

inventory_units_or_lots
  1 ── N inventory_events

inventory_events
  0..1 ── 1 inventory_events (supersedes/corrects)
```

金融明細との関係は `purchase-reconciliation-model.md` を参照する。

## 3. products
「何の商品か」を表す概念単位。同じ用途・同じ商品系列でも、容量・包装が違う場合はvariantで分ける。

主な項目:
- `product_id`
- `user_id`
- `display_name`
- `category`
- `brand`
- `default_management_unit`
- `active`
- `created_at`
- `updated_at`

例:
- product: 架空の洗剤A
- variant: 500mlボトル / 900ml詰替

`display_name` のみで重複判定しない。

## 4. product_variants
容量、包装、型番等を含む管理単位。

主な項目:
- `product_variant_id`
- `product_id`
- `variant_name`
- `content_amount`
- `content_unit`
- `package_count`
- `package_unit`
- `manufacturer_code`
- `jan_code`
- `external_product_refs`
- `tracking_mode`
- `created_at`
- `updated_at`

### tracking_mode
- `quantity`: 未開封個数等を数量で管理。紙類・詰替等の標準。
- `lot`: 同時購入/同時入荷したまとまり単位で管理。
- `unit`: 1個ずつ個体を追跡。必要な商品だけ。

MVPの既定値は `quantity`。個体管理は必要性が明確な場合のみ採用する。

## 5. inventory_units_or_lots
`tracking_mode = unit / lot` の場合に利用する追跡対象。

主な項目:
- `inventory_unit_id`
- `product_variant_id`
- `purchase_line_id`
- `tracking_type`
- `received_at`
- `opened_at`
- `finished_at`
- `status`
- `external_lot_ref`

`quantity` モードの商品では必須としない。

## 6. inventory_events
在庫状態を変化・観測させる事実。現在状態の正本はイベント履歴とする。

主な項目:
- `inventory_event_id`
- `user_id`
- `product_variant_id`
- `inventory_unit_id`
- `purchase_line_id`
- `event_type`
- `occurred_at`
- `occurred_at_precision`
- `recorded_at`
- `quantity_delta`
- `quantity_unit`
- `remaining_amount`
- `remaining_ratio`
- `source_type`
- `source_ref`
- `idempotency_key`
- `supersedes_event_id`
- `voids_event_id`
- `schema_version`
- `note`

### event_type
MVPでは以下を定義する。

- `initial_balance`: 確認日時点の初期在庫
- `receipt`: 入荷。在庫増加
- `open`: 開封。未開封から使用中へ状態移動
- `remaining_observation`: 残量確認。総在庫数量そのものは増減させない
- `finish`: 使い切り
- `discard`: 廃棄
- `return`: 返品
- `adjustment`: 棚卸し等の手動調整
- `void`: 元イベント取消
- `correction`: 元イベント訂正

購入は `purchase_order / purchase_line` 側で表現し、原則 `inventory_event` の `purchase` は作らない。

## 7. 日付の扱い

### occurred_at
実際にイベントが発生した日時。

### recorded_at
システムへ登録した日時。

`occurred_at` が不明な場合は null を許容し、`recorded_at` で置換しない。

### occurred_at_precision
- `exact`: 日時まで既知
- `date`: 日付のみ
- `unknown`: 不明

発生日不明の `open / finish` は現在状態には反映できるが、消費日数計算には利用しない。

## 8. 数量・包装の扱い

以下は別概念として扱う。

- `ordered_quantity`: 注文明細を何個注文したか
- `package_count`: 1商品パッケージ内部に何単位入っているか
- `content_amount`: 1単位あたりの容量
- `quantity_delta`: 在庫上の増減

例:
「12ロール入りを2パック注文」
- ordered_quantity = 2
- package_count = 12
- package_unit = roll

注文履歴の商品名から `12ロール` を見つけても、ordered_quantity=12とはしない。

## 9. 状態更新規則

### initial_balance
確認日時点の状態を基準点として登録する。
過去の購入履歴を後から取り込んでも、この基準点以前の購入を現在庫へ再加算しない。

### receipt
`quantity_delta > 0`。
`purchase_line_id` が分かる場合は関連付ける。
同じ注文を再送しても、同一 `idempotency_key` ならno-op。

### open
未開封数量を1減らし、使用中を1増やす。
保有総個数自体は変えない。

### remaining_observation
観測値として保持する。
過去の観測値を削除せず時系列で残す。

### finish
使用中対象を終了状態にする。
内容量ベースで管理する場合は残量0の観測として扱える。

### discard / return
在庫を減らすが、金融上の返金とは別イベント。
返金明細があっても `return` を自動生成しない。

### adjustment
棚卸しとの差分修正。
通常イベントで説明できない差異に限定し、理由を残す。

## 10. 再送・重複防止

`idempotency_key` は書き込み元で安定生成する。

例:
- 手入力: `user_id + client_generated_uuid`
- EC入荷連携: `source_system + external_order_id + external_line_id + shipment_or_receipt_ref`
- Shortcut/API: クライアント側UUID

同一 `user_id + idempotency_key` は同一イベントとして扱う。
payloadが同一ならno-op、内容が異なる場合は競合としてエラーまたは明示訂正を要求する。

## 11. 訂正・取消

履歴監査性を保つため、確定済みイベントを破壊的更新しない。

### 取消
誤登録イベントを `void` で参照する。

### 訂正
新しい `correction` または置換イベントを追加し、`supersedes_event_id` で元イベントを参照する。

再計算時は、取消済みイベントを除外し、最新の有効な訂正系列だけを適用する。

例:
1. receipt +2
2. 実際は +1 と判明
3. 元receiptをvoidし、正しいreceipt +1を追加

または実装上、correctionイベントで差分 -1 を表現してもよいが、どちらを採るかは物理設計時に統一する。
MVPでは「元イベント参照 + 置換」を優先する。

## 12. 整合性ルール

最低限以下を検証する。

- 未開封数量は原則0未満にしない。
- 使用中でない個体を `finish` しない。
- `finish` 済み個体を再度 `open` しない。
- `receipt` の重複再送で数量が増えない。
- `purchase_line` が存在しても `receipt` がなければ在庫を増やさない。
- `return` と金融上のrefundは別管理とする。
- 別ユーザーのproduct / purchase_line / inventory_unitを参照できない。

矛盾する過去イベントが後から入った場合は、黙って現在状態を書き換えず再計算結果と競合を表示する。

## 13. 現在状態の導出

Portal表示用にはイベントから派生状態を作ってよい。

例:
- unopened_quantity
- in_use_count
- latest_remaining_amount
- latest_remaining_ratio
- latest_observed_at
- last_received_at
- last_opened_at
- last_finished_at

派生状態はキャッシュ可能だが、正本ではない。
訂正後に再構築できることを要件とする。

## 14. 推定値

消費速度や使い切り予測はイベントとは別の派生データとして扱う。

最低限保持する情報:
- 算出対象product_variant
- observation_count
- calculated_at
- source_period
- estimate_value
- estimate_unit
- confidence / uncertainty

履歴不足の場合は `null / 未算出` とする。
推定値を実測イベントへ書き戻さない。

## 15. 代表シナリオ

### A. 初期在庫
- initial_balance: unopened=2, in_use=1
- 過去購入履歴10件を取込
- 現在状態は unopened=2, in_use=1 のまま

### B. EC注文→入荷
- purchase_line: 2個注文
- receipt: +2
- 現在状態: unopened +2

### C. 開封
- open: 1個
- unopened -1 / in_use +1

### D. 残量確認
- remaining_observation: 0.4
- 在庫個数は変化しない

### E. 使い切り
- finish
- in_use -1

### F. 同一receipt再送
- 同じidempotency_keyを再送
- 状態変化なし

### G. 過去receipt訂正
- receipt +2をvoid
- receipt +1を追加
- 後続openと整合しなければ競合として表示

## 16. Amazon確認後に残す未確定項目

以下だけは実サンプル確認後に最終確定する。
- `purchase_line.external_line_id`
- `product_code / product_url` の安定性
- 注文数量、商品単価、明細金額の粒度
- 分割発送時に `receipt` を何の外部IDで冪等化するか
- EC上の返品/キャンセル状態からinventory_event候補をどこまで生成するか

Amazonデータが来るまでは、これらをnullable / optionalとして設計を進める。

## 17. #12への技術要件

技術選定では次を満たすこと。
- イベント履歴を追記・再計算できる
- `user_id + idempotency_key` の一意性を担保できる
- 訂正前の履歴を保持できる
- 多対多のpurchase/financial linkを扱える
- raw原本、parsed、curated、派生状態を分離できる
- Portalから認証済みAPI経由で安全に読み書きできる

## 18. #11の完了判定

Amazon依存部分を除き、以下は本書で確定可能。
- product / variant / unit・lot / inventory_event の関係
- event_type
- occurred_at / recorded_at
- 再送防止
- 訂正/取消
- 在庫再計算
- 実測値/推定値の分離

残作業は匿名fixtureで代表ケースを検証し、Amazon確認後にEC固有項目を確定すること。