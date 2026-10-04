# Amazon購入履歴CSV変換契約 v1

関連: #23 / #13 / #16 / #22。既存の基本設計・Gmail取込契約を補完する。
この変更は初期バックフィルの**オフライン変換とdry-run**。Firestore保存、商品照合、Gmailとの実マージ、購入周期再計算は後続。

## 実行

Python 3.11以上・標準ライブラリのみ。フロントエンドへの依存追加はない。

```bash
python scripts/personal_commerce/amazon_orders.py '/private/Your Orders.zip' --account-key INTERNAL_ACCOUNT_UUID
python -m unittest discover -s scripts/personal_commerce -p 'test_*.py' -v
```

入力はZIPまたは展開済みディレクトリ。既定では集計件数・固定理由コードだけをstdoutへ表示。
JSONが必要な場合のみ `--output /private/orders.json` を付ける。新規ファイル専用・POSIX権限0600。出力は個人データであり、GitHubに置かない。
account-keyは後続Gmail取込と共通のmerchantAccountKey（内部UUID）を指定。CLIにはFirebase uidを渡さない。後続サーバーが認証済みuidを決定する。

## 入力・安全性

読むファイルは次の4つに限定し、ZIPを展開しない。住所・カード情報・追跡番号・ギフト情報・PDF・写真・デジタル履歴を出力へコピーしない。

| 入力 | 用途 |
|---|---|
| Your Amazon Orders/Order History.csv | 必須。注文・物品明細 |
| Your Returns & Refunds/Refund Details.csv | 注文単位の返金根拠 |
| Your Returns & Refunds/Returns Status.csv | 注文単位の返品根拠 |
| Your Returns & Refunds/Replacement Orders.csv | 元注文→無償交換注文の関係 |

関連CSVなしは全未除外明細をneeds_reviewへ。空CSVはヘッダのみで明示する。必須ヘッダ不足・列数不正・注文番号欠損・リンク番号欠損は固定コードで停止。追加列は許容し、出力はallowlist。UTF-8 BOM、引用符、商品名内改行を扱う。CSV単位16MiB上限、ZIP同名重複は拒否。

## 変換

| 元項目 | 出力 | 判断 |
|---|---|---|
| Order ID | externalOrderId / orderKey | 既存設計と同じorder identity hash |
| Order Date | orderedOn / orderDateEvidence | timezone付きISO→Asia/Tokyo日付。元timestamp保持 |
| ASIN | identifiers.merchantSku | amazon + account + ASINでscope |
| Product Name | rawProductName | 原名。商品照合は後続、productId=null |
| Original Quantity | quantity | 正整数。0/欠損/不正はnull＋理由、1補完なし |
| Currency | currency | v1はJPYのみ。他通貨は確認待ち |
| 価格項目 | amountMinor=null | 単価/小計等の意味が未検証のため全件未確定 |

価格をnullにしても購入日ベースの周期計算に使える。数量で周期を割らない。
`orderDateBasis=csv_order_date` をCSV契約の追加enumとして提案する。基本設計のbody/gmail_received_dateおよびsource.provider=gmailへそのまま保存しない。保存前に#16でCSV sourceへのschema拡張を適用する。

## 状態・購入周期入力

| 条件 | disposition | 周期入力 |
|---|---|---|
| Closed + Shipped + 正数量、必須正常、関連問題なし | accepted | 商品照合後に利用可能 |
| Cancelled | excluded | 除外 |
| 交換注文IDに該当 | excluded | 無償交換を新購入と数えない |
| 返品/返金の注文IDに該当 | needs_review | 対象明細が特定できないため除外 |
| 数量0/不正、Authorized、未発送、未知状態 | needs_review | 除外 |
| 同注文で同ASIN複数行、注文日不整合 | needs_review | 自動統合せず除外 |

返品・返金は完了/取消の詳細を確定できるまで、注文内の全明細を確認待ちにする。返金だけでreturnedとは断定しない。
order.statusはcancelled明細だけならcancelled、有効ordered明細があればordered、他はunknown。混在注文の1明細取消で注文全体を取消にしない。
line.statusはacceptedのみordered、取消はcancelled、それ以外unknown。
`cycleEligibleAfterProductMatch` は変換上の適格性であり、消耗品分類・現用状態・通知適格性とは異なる。

## 出力・再取込・Gmail統合

返却は `{contractVersion, importBatchKey, summary, source, orders[]}` の**保存候補**。DB documentではない。共通revision/Timestamp/監査/lineIdはサーバー側で付ける。

- sourceId: SHA-256(JSON配列["v1","amazon_csv",accountKey,historyFileHash])。行根拠はファイル相対パスとCSV論理レコード番号（ヘッダを1とする）。
- importBatchKey: 関連ファイルも含むsorted fileHashesのhash。返品CSV等だけ変化しても新しい検証試行が必要。sourceIdだけを理由に再評価を飛ばさない。
- orderKey: SHA-256(["v1","order","amazon",merchantAccountKey,externalOrderId])。Gmailと共通。JSONはUTF-8・空白なし・ensure_ascii=false。
- lineMatchKey: orderKey+ASINによる**照合ヒント**。外部明細IDではなく、Firestore lineIdにも採用しない。複数行は確認待ち。
- 再取込はorder identity予約と既存明細照合でno-op/更新。別メールsourceとの明細対応を一意に確定できない場合は追加計上せず確認待ち。
- CSVの実注文日はGmail受信日のfallbackより根拠が強い。訂正なしの同一注文で差異がある場合、サーバーはCSV日付への変更を監査する。本文注文日との矛盾、数量/状態の矛盾は確認待ち。取込順で上書きしない。
- ユーザーoverrideは最優先。CSVはoverrideを出力せず、保存処理はexisting userOverridesを維持する。取消/返品/交換の新根拠で既存周期入力が変わる場合は再評価する。

以上のマージ・訂正維持規則は後続保存処理への契約で、このCLIによる実装済み保証ではない。

## 検証結果（2026-10-05）

完全合成unittest 18ケースと実ZIPで検証。実データ由来fixture/hash/商品名はリポジトリへ含めない。

- 312注文 / 424明細
- accepted 397 / excluded 19 / needs_review 8
- 除外は取消18明細＋無償交換1明細。確認待ちは返品/返金3明細＋未確定/数量0等5明細。
- 価格は424明細すべて未確定。関連CSV欠損なし。

テスト範囲: 日付/JST、複数商品、数量2、取消混在、数量0、未発送、返品/返金、交換、同ASIN複数行、注文日不整合、不正値、ID安定性、CSV BOM/引用符/改行、関連ファイル欠損、ZIP読み取り範囲、出力権限と上書き拒否。
未検証: Firestore transaction、Gmail実マージ、商品照合、ユーザー訂正維持、アプリUI。#23全体はまだ完了扱いにしない。
