# ADR: 生活データ基盤の構成方針

関連: #9 / #11 / #12 / #13 / #15 / PR #14
状態: Accepted（2026-10-04）

## 1. 結論
既存PortalのFirebase Auth / Firestoreを維持し、生活データ基盤も**Firestoreをoperational write model（正本）**として利用する。
PDF/CSV原本はCloud Storage、API/取込処理はCloud Run、分析・突合検証・消費周期計算はBigQueryへ分離する。

```text
Portal (GitHub Pages)
  ↓ Firebase ID token
Cloud Run API
  ├─ Firestore: operational source of truth
  │    products / variants / purchases / transactions / links / inventory_events
  ├─ Cloud Storage: private raw PDF/CSV
  └─ BigQuery: analytics / reconciliation analysis / derived metrics
       （必要データをFirestore/parsed結果から連携）
```

既存Wishlist / Recipes / Booksのデータ構造は移行しない。
PortalからCloud Storage / BigQueryへ直接アクセスさせない。

## 2. 判断理由
### Firebase Authを残す
- Googleログインが既に動作している。
- 認証移行をMVPのクリティカルパスにしない。
- Cloud RunではFirebase ID tokenを検証し、uidをサーバー側で確定する。

### Firestoreをwrite modelにする
在庫イベントでは単一イベント登録、`user_id + idempotency_key`の重複防止、訂正/取消、状態遷移競合、ユーザー単位のアクセス制御、低レイテンシ参照が必要。
既存プロジェクトですでにFirestoreを利用しており、個人MVPの書込量では新たなRDBを増やす便益が小さい。
BigQueryは分析用途を主眼とし、inventory_eventの正本にはしない。

### BigQueryを残す
- 過去3〜6か月の購買分析
- purchaseとfinancial transactionの候補突合
- 消費期間/購入間隔の集計
- 将来の補充候補分析
- parsed/curatedデータの横断確認

MVP初期から全処理をBigQueryへ寄せず、分析が必要なデータだけ連携する。

## 3. データ責務
### Firestore: operational
推奨collection概念:
- `users/{uid}/products/{productId}`
- `users/{uid}/productVariants/{variantId}`
- `users/{uid}/purchaseOrders/{orderId}`
- `users/{uid}/purchaseLines/{lineId}`
- `users/{uid}/financialTransactions/{transactionId}`
- `users/{uid}/transactionOrderLinks/{linkId}`
- `users/{uid}/inventoryEvents/{eventId}`
- `users/{uid}/imports/{importId}`

既存機能のような「1 documentに配列全体を保存」は生活データでは採用せず、1論理レコード=1 documentを基本にする。

### Cloud Storage: raw
パス概念: `raw/{uid}/{source_type}/{yyyy}/{mm}/{opaque_file_id}`

要件:
- public access禁止
- API/取込サービスアカウントのみアクセス
- content hashを保持
- parser version / parse statusをFirestoreのimport metadataに保持
- 実データをGitHubへ保存しない

### BigQuery: analytical
論理領域:
- `parsed_*`
- `reconciliation_*`
- `derived_*`

Firestore正本とBigQuery派生データが競合した場合はFirestoreを正とし、BigQuery側は再生成可能にする。

## 4. Cloud Run API
Cloud RunをMVPのバックエンド第一候補とする。

理由:
- HTTP APIとparser/バッチをコンテナで統一できる
- PDF/CSV処理ライブラリの自由度が高い
- Firebase token検証を共通化できる
- 将来のiPhone Shortcut / ChatGPT等も同じAPI境界へ接続できる

Cloud Functions / Pub/Sub / Dataflowは、必要性が出るまで追加しない。

## 5. 書き込み経路
### 手入力
Portal → Cloud Run API → token検証 → Firestore transaction/batch → inventory_event保存 → 状態更新

### raw取込
Portal → Cloud Run → Cloud Storage raw保存 → import metadata保存 → parser → parsed結果 → 候補確認 → Firestore curated確定

### 分析
Firestore/parsed結果 → BigQuery → 集計/突合候補 → API → Portal

BigQueryの結果からinventory_eventを無確認で直接確定しない。

## 6. 冪等性・整合性
- `user_id + idempotency_key`を論理的一意キーとする。
- 同一key・同一payloadはno-op。
- 同一key・異なるpayloadは409相当の競合。
- purchase_lineだけでは在庫を増やさない。
- receipt等のinventory_eventのみ在庫変化へ反映。
- void/correction後は履歴から状態を再計算できる。
- 負在庫・不正な状態遷移は確定せずconflict扱い。

Firestoreではidempotency keyをdocument IDまたは専用lock/index documentとして設計し、transactionで競合を防ぐ。

## 7. MVP API
1. `POST /imports`
2. `GET /imports/{id}`
3. `GET /purchase-candidates`
4. `POST /inventory-events`
5. `GET /inventory`
6. `GET /inventory-events`
7. `POST /inventory-events/{id}/void-or-correct`

汎用CRUD APIにはしない。

## 8. 主要クエリ
- 商品別現在在庫
- 商品別イベント履歴
- 未確認purchase/financial突合候補
- 過去3〜6か月の購入回数・購入間隔
- 開封〜使い切りの有効観測

現在在庫と直近履歴はFirestore/API、期間集計・横断分析はBigQueryを使う。

## 9. リアルタイム性
MVPでは秒単位リアルタイム分析は不要。
- 在庫登録: API完了直後に反映
- import: pollingで十分
- BigQuery分析: オンデマンドまたは低頻度バッチ

常時ストリーミング処理は導入しない。

## 10. セキュリティ
### 現行確認結果
- Firestore location: `asia-northeast1`（東京）
- Firestore Rules: `request.auth.uid == userId` により既存 `users/{uid}/{collection}/{docId}` は本人のみread/write
- App Check: OFF
- Billing: Spark / OFF

### API認可
- Firebase ID tokenをCloud Runで検証する。
- uidはtokenから確定し、request bodyのuser_idを信用しない。
- Cloud RunのAdmin SDKアクセスはSecurity Rulesをバイパスするため、API側認可を必須にする。
- App CheckはMVP着手の必須条件にはしない。公開運用前の追加防御として再評価する。

### Firestore Rules
生活データで `users/{uid}/inventoryEvents/{eventId}` 等をフロントから直接操作する場合は現行Rulesでも2階層サブコレクションに適用できるが、MVPでは生活データ書込をCloud Run APIに寄せる。
将来さらに深いパスを追加する場合はRulesを明示的に追加する。

## 11. IAM / Service Account
MVPでは**Cloud Run用専用Service Accountを1つ**作り、デフォルトCompute Service AccountやOwner/Editor権限を使わない。

Cloud Run runtime SAの必要権限方針:
- Firestore: 対象プロジェクトのFirestoreデータ読書きに必要な最小ロール
- Cloud Storage: raw専用bucketのObject read/write。bucket管理権限は付与しない
- BigQuery: 対象datasetへのjob実行 + 必要datasetのread/write。project全体のData Ownerは付与しない
- Logging/Monitoring: Cloud Run標準のログ出力に必要な範囲

デプロイ主体とruntime主体を分離する。
- runtime SA: アプリ実行時だけ必要なデータ権限
- deploy権限: Cloud Run更新、Service Account利用等。GitHub Actions導入時はWorkload Identity Federationを優先し、長期Service Account key JSONをGitHub Secretsへ置かない

秘密値をコードやGitHub公開リポジトリへ保存しない。

## 12. dev / prod分離
MVPでは**同一GCP project内で論理分離して開始**する。個人利用初期に別projectを2つ維持する運用コストを避ける。

分離方法:
- Cloud Run service: `portal-household-api-dev` / `portal-household-api-prod`
- Cloud Storage bucket: dev/prodを別bucketにする
- Firestore: productionデータとfixture/testデータのcollection namespaceを混在させない。ローカル/自動テストはFirebase Emulatorを優先する
- BigQuery: `household_dev` / `household_prod` datasetを分離
- 環境変数・CORS・service accountをdev/prodで分離
- 本番rawデータをdevへコピーしない。fixtureは匿名ダミーデータのみ

将来、複数ユーザー化・CI/CD高度化・誤操作リスク増大時に、prodを別GCP projectへ分離する。

優先順位が「強い環境隔離」なら最初から別projectが有利だが、現段階では運用簡素化を優先して同一project論理分離を採用する。

## 13. バックアップ/復元
優先順位:
1. raw原本
2. Firestore operational record / inventory event履歴
3. BigQuery派生データ

BigQuery派生データは再生成可能にする。
現在状態もinventory_eventから再構築できるようにする。

## 14. 候補比較
### Firestoreだけ
有利: サービス数・実装量を最小化したい場合。
不利: 大量の横断分析・多対多突合SQLが増えると実装が煩雑。

### Firestore + BigQuery + Storage + Cloud Run（採用）
有利: 既存Portalを壊さず、operationalとanalyticsを分離できる。
不利: サービス数とIAM/監視対象が増える。

### PostgreSQL/Supabase/Cloud SQL
有利: JOIN、外部キー、一意制約、複雑なOLTPを単一RDBで厳密に扱いたい場合。
不利: 今回の個人MVPでは新DB運用・認証統合コストが先に発生する。

### 全面移行
有利: 最終的な基盤統一。
不利: MVP価値に対して移行工数が過大。

「MVPを早く動かす」「既存ログイン/機能を壊さない」「後から分析を拡張する」を優先し、Firestore write model + GCP分析系を採る。

## 15. 費用前提
個人利用MVPの仮定:
- 1ユーザー
- inventory event: 100〜1,000件/月
- API: 数百〜数千request/月
- rawファイル: 数十〜数百MB、将来1GB程度
- BigQuery query: 数GB〜数十GB/月

目標月額は0〜数百円。請求ゼロは保証しない。
現在はSparkプランのため、Cloud Run / Cloud Storage / BigQueryを使う実装前にCloud Billingを有効化する。
有効化直後にBudget Alertを設定する。

## 16. リージョン
Firestoreが `asia-northeast1` のため、以下を第一候補とする。
- Cloud Run: `asia-northeast1`
- Cloud Storage: 東京リージョン
- BigQuery: 東京リージョン

可能な範囲で同一地域へ寄せ、レイテンシとリージョン間転送を抑える。

## 17. 撤回可能性
- 既存Wishlist等を変更しない
- 新生活データはcollection/API境界を分離
- BigQueryは派生先なので削除してもoperational dataは残る
- export可能なJSON/CSV形式を持つ
- 将来RDBが必要になった場合もCloud Run APIの背後を置換しやすくする

## 18. Amazon待ちでも進められる範囲
Amazonに依存しない:
- Firebase token認証API
- raw Storage
- import metadata
- MF CSV parser
- products/productVariants
- inventoryEvents + idempotency
- inventory state API/UI

Amazon確認後に追加確定:
- external_line_id/product_code/product_url
- quantity/price粒度
- shipment識別子
- EC返品/キャンセル連携

## 19. 実装ゲートと次Issue
設計はAcceptedとする。実装開始のゲートはCloud Billing有効化とBudget Alert設定。

実装順序:
1. Billing有効化 + Budget Alert
2. Cloud Run API skeleton + Firebase ID token検証
3. Cloud Storage raw upload + imports metadata
4. Firestore生活データcollection + index/security設計
5. MF CSV parser
6. inventory event write + idempotency + state再計算
7. Portal在庫/履歴UI
8. BigQuery分析連携
9. purchase-financial reconciliation UI
