# GCPを待たずに進める独立作業（2026-10-06）

ユーザー指示「後戻りが少なく、gcp待ちにならない箇所を特定して進めて」に基づき、依存先の実環境受入から、確定済み業務ルールの独立部品を分離する。元Issue全体の着手・受入条件を完了扱いにせず、実接続/書込み/運用開始は従来の依存関係を維持する。

## 選定

| 箇所 | 後戻りが少ない根拠 | 今回の扱い |
|---|---|---|
| #37 属性一致/本人固定/曖昧保留 | Productの名称・brand・容量・包装・packCountと本人overrideが基本設計で確定。外部API非依存 | 読取り専用の純粋関数と匿名試験を実装 |
| #34 MIME復号の匿名fixture | raw/charset/plain優先/復号不良保留が契約確定 | 次候補。実decoder/ランタイム選定は別レビュー |
| #41 Job再開/台帳 | 重複防止方針は確定だが取込operationと保存境界に依存 | 今回は実装しない |
| #40 会話UI | 会話/根拠/補正の応答契約と認証付きURLが未受入 | 今回は実装しない |

## 今回の独立部品

`server/product-attributes.mjs`の`matchProductAttributes({candidate,products,explicitProductId?})`。入力candidateは抽出後の既存Product属性形で、rawメールの解析を担当しない。productsは呼出側がverified UIDに絞った既存Product一覧。外部通信・DB・時刻・書込み・AI推定なし。

- explicitProductIdは検証済み本人overrideだけを呼出側が渡す。本人指定nullはUSER_UNMATCHED、参照先不在は確認待ちであり属性照合に戻らない。
- candidateに非空identifierがあればIDENTIFIER_RESOLUTION_REQUIRED。既存SKU/強いidentifier処理を属性一致で迂回しない。本部品はidentifierなしの属性fallbackのみを担当する。
- candidate/既存Productはeffective overlayで本人訂正を反映。元データとoverrideは書き換えない。
- canonicalName/brand/sizeValue/sizeUnit/packageType/packCountが全て既知で一致し、候補が一意な場合だけattributesで照合。名称/brand等はNFKCと空白整理のみ。alias・類似名称・単位換算・容量推測を一致根拠にしない。
- 容量/包装/個数差は別商品。未知属性はwildcardとして確定に使わない。完全一致候補に加え、既知属性に矛盾のない不完全Productが存在する場合も曖昧として保留する。
- 出力はproductId/matchMethod/needsReview/code?/methodVersion。確認待ちはmissingFields/candidateProductIdsを必要時に返す。ID順で安定した結果を返し、再実行でDBを変更しない。
- 入力一覧は5000件まで、重複/不正Product IDを拒否。実保存時のrevision再確認・予約/監査transactionは後続で必要。

## 受入と残作業

匿名単体で一意/複数候補、容量/包装/個数違い、不明/無効属性、NFKC/空白、本人指定/null/参照不在、override維持、identifier迂回拒否、再実行/順序、入力境界を検証。

#37全体は未完了。#35/#36受入後の統合、商品属性の根拠抽出・カテゴリ分類、強いidentifier処理、Firestoreへのrevision/監査付き保存、周期再計算は残る。既存`matchProducts`/HTTP/runtimeは変更せず、本番・本人データ・有料APIを使わない。別branch/PRでレビューできる。
