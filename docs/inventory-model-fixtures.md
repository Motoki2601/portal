# 在庫モデル匿名fixture検証

関連: #11 / #12 / PR #14

## 目的
`household-inventory-data-model.md` の在庫イベント規則が、代表シナリオで一貫して再計算できることを匿名データで確認する。

## 前提
- 商品: 架空洗剤A 500ml
- tracking_mode: quantity
- 現在状態はイベント履歴から導出する
- `purchase_line` の存在だけでは在庫を増やさない
- 同一 `user_id + idempotency_key` は同一イベント
- `void` 済みイベントは再計算から除外する

## Fixture 1: 入荷→開封→残量確認→使い切り

入力:
1. `receipt +2` (`idem-r1`)
2. `open 1` (`idem-o1`)
3. `remaining_observation 0.4` (`idem-rem1`)
4. `finish 1` (`idem-f1`)

期待状態:
- unopened_quantity = 1
- in_use_count = 0
- latest_remaining_ratio = 0
- receipt件数 = 1
- finish件数 = 1

判定: PASS。購入と在庫変化を分離しても状態を一意に再計算できる。

## Fixture 2: purchaseとreceiptの二重加算防止

入力:
1. purchase_line: ordered_quantity = 2
2. `receipt +2` (`idem-r2`)

期待状態:
- unopened_quantity = 2
- purchase_lineは在庫量へ直接加算しない

判定: PASS。

## Fixture 3: 同一receipt再送

入力:
1. `receipt +2` (`idem-r3`)
2. 同一payload・同一`idem-r3`を再送

期待状態:
- unopened_quantity = 2
- 2回目はno-op

判定: PASS。実装では一意制約または同等の冪等性保証が必要。

## Fixture 4: 同一idempotency_keyで異なるpayload

入力:
1. `receipt +2` (`idem-r4`)
2. `receipt +3` (`idem-r4`)

期待状態:
- 自動上書きしない
- conflictとして扱い、訂正フローを要求

判定: PASS。サイレント更新は禁止する。

## Fixture 5: 過去receipt訂正

入力:
1. `receipt +2` (`idem-r5a`)
2. `open 1` (`idem-o5`)
3. 元receiptを`void`
4. 正しい`receipt +1` (`idem-r5b`)

再計算結果:
- receipt由来在庫 = 1
- open済み = 1
- unopened_quantity = 0
- in_use_count = 1

判定: PASS。このケースは整合する。

## Fixture 6: 訂正により後続イベントが矛盾

入力:
1. `receipt +2`
2. `open 2`
3. receiptを`+1`へ訂正

期待状態:
- 単純再計算では未開封数量が負になる
- 現在状態を黙って確定せず`conflict`を返す
- 後続openの訂正/取消をユーザーに要求

判定: PASS。負在庫を許容して確定しない。

## Fixture 7: 初期残高と過去購入履歴

入力:
1. `initial_balance`: unopened=2, in_use=1, observed_at=2026-10-01
2. observed_at以前のpurchase履歴10件を後から取込

期待状態:
- unopened_quantity = 2
- in_use_count = 1
- 過去purchaseは現在庫へ再加算されない

判定: PASS。

## Fixture 8: 日付不明のopen/finish

入力:
1. `open` with occurred_at=null / precision=unknown
2. `finish` with occurred_at=null / precision=unknown

期待状態:
- 現在状態の更新には利用可能
- 開封〜使い切り日数の学習データから除外

判定: PASS。

## Fixture 9: refundとreturnの分離

入力:
1. 金融明細にrefund
2. inventory_eventは未登録

期待状態:
- 金融上は返金あり
- 在庫は自動減算しない

その後、物理返品を確認して`return`を登録した場合のみ在庫減算。

判定: PASS。

## Fixture 10: 別ユーザー参照

入力:
- user_A のイベントから user_B のproduct_variant_idを指定

期待状態:
- 書き込み拒否

判定: PASS。API/DB双方でユーザー境界を強制する必要がある。

## 結論
#11で定義したイベントモデルは、MVPに必要な代表ケースについて論理的に一貫する。

技術実装に必須の制約:
- `user_id + idempotency_key` の一意性
- event append中心の履歴保持
- void/correctionを含む再計算
- 負在庫・状態遷移矛盾の検出
- purchaseとinventoryの分離
- user_id境界の認可

Amazon実サンプル待ちの論点は、EC由来の外部ID・分割発送・数量/価格粒度であり、上記在庫イベントモデルの成立性には影響しない。
