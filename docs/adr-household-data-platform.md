# ADR: 生活データ基盤の構成方針

関連: #9 / #11 / #12 / #13 / PR #14
状態: Proposed（実環境のSecurity Rules確認後にAcceptedへ更新）

## 1. 結論
既存PortalのFirebase Auth / Firestoreを維持し、生活データ基盤も**Firestoreをoperational write model（正本）**として利用する。
PDF/CSV原本はCloud Storage、API/取込処理はCloud Run、分析・突合検証・消費周期計算はBigQueryへ分離する。

```text
Portal (GitHub Pages)
  ↓ Firebase ID token
Cloud Run API
  ├─ Firestore: operational source of truth
  │    products / variants / purchases / transactions / links / inventory_events
  │
  ├─ Cloud Storage: private raw PDF/CSV
  │
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
在庫イベントでは以下をアプリケーション側で確実に扱う必要がある。
- 単一イベントの登録
- `user_id + idempotency_key`の重複防止
- 訂正/取消
- 状態遷移競合
- ユーザー単位のアクセス制御
- Portalからの低レイテンシ参照

既存プロジェクトですでにFirestoreを利用しており、個人MVPの書込量では新たなRDBを増やす便益が小さい。

BigQueryは主キー/外部キー制約を強制しない。また単行DMLを中心とするOLTP用途より分析用途を主眼とするため、inventory_eventの正本にはしない。

### BigQueryを残す
以下はBigQueryが得意な領域として分離する。
- 過去3〜6か月の購買分析
- purchaseとfinancial transactionの候補突合
- 消費期間/購入間隔の集計
- 将来の補充候補分析
- raw/parsed/curatedデータの横断確認

MVP初期から全処理をBigQueryへ寄せず、分析が必要なテーブルだけ連携する。

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

既存機能のような「1 documentに配列全体を保存」は生活データでは採用しない。1論理レコード=1 documentを基本にする。

### Cloud Storage: raw
非公開原本を保持する。

パス概念:
`raw/{uid}/{source_type}/{yyyy}/{mm}/{opaque_file_id}`

要件:
- public access禁止
- API/取込サービスアカウントのみアクセス
- content hashを保持
- parser version / parse statusをFirestoreのimports/source metadataに保持
- 実データをGitHubへ保存しない

### BigQuery: analytical
論理領域:
- `parsed_*`: 原本から機械抽出した行
- `reconciliation_*`: 突合候補・検証用
- `derived_*`: purchase interval / consumption metrics / replenishment candidates

Firestore正本とBigQuery派生データが競合した場合はFirestoreを正とする。
BigQuery側は再生成可能にする。

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

Firestoreでは一意制約そのものではなく、idempotency keyをdocument IDまたは専用lock/index documentとして設計し、transactionで競合を防ぐ。

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

現在在庫と直近履歴はFirestore/APIで返す。
期間集計・横断分析はBigQueryを使う。

## 9. リアルタイム性
MVPでは秒単位リアルタイム分析は不要。
- 在庫登録: API完了直後に反映
- import: pollingで十分
- BigQuery分析: オンデマンドまたは低頻度バッチ

常時ストリーミング処理は導入しない。

## 10. セキュリティ
- Firebase ID tokenをCloud Runで検証
- uidはtokenから確定し、request bodyのuser_idを信用しない
- Firestore/Storage/BigQueryへの生活データ書込は原則APIサービスアカウント経由
- Cloud Storageは非公開
- BigQueryはブラウザ直接アクセス禁止
- サービスアカウントは最小権限
- 実データを公開GitHubに置かない

未確認:
- 現行Firestore Security Rules
- App Check
- 本番Firebase/GCPのIAM設定

## 11. バックアップ/復元
優先順位:
1. raw原本
2. Firestore operational record / inventory event履歴
3. BigQuery派生データ

BigQuery派生データは再生成可能にする。
現在状態もinventory_eventから再構築できるようにする。

## 12. 候補比較

### Firestoreだけ
優先: サービス数・実装量の最小化。
弱点: 大量の横断分析・多対多突合SQLが増えると実装が煩雑。

### Firestore + BigQuery + Storage + Cloud Run（採用候補）
優先: 既存Portalを壊さず、operationalとanalyticsを分離する。
弱点: サービス数とIAM/監視対象は増える。

### PostgreSQL/Supabase/Cloud SQL
優先: JOIN、外部キー、一意制約、複雑なOLTPを単一RDBで厳密に扱う。
弱点: 今回の個人MVPでは新DB運用・認証統合コストが先に発生する。

### 全面移行
優先: 最終的な基盤統一。
弱点: MVP価値に対して移行工数が過大。

現時点では「MVPを早く動かす」「既存ログイン/機能を壊さない」「後から分析を拡張する」を優先し、Firestore write model + GCP分析系を採る。

## 13. 費用前提（2026-10確認）
個人利用MVPの仮定:
- 1ユーザー
- inventory event: 100〜1,000件/月
- API: 数百〜数千request/月
- rawファイル: 数十〜数百MB、将来1GB程度
- BigQuery query: 数GB〜数十GB/月

この規模は公式free tierと比較して十分小さい。
- Firestore Standard: 1GiB保存、50,000 reads/day、20,000 writes/day等のfree quotaあり。
- Cloud Run: CPU 240,000 vCPU-sec/月、memory 450,000 GiB-sec/月等のfree tierあり。
- BigQuery on-demand: query 1TiB/月までfree、logical storage 10GiBまでfree。
- Cloud Storageは保存量・操作・転送に従量課金。1GB前後ならストレージ料金自体は月数セント規模を想定するが、リージョン/操作/転送で変動する。

したがってMVPの**目標月額は0〜数百円、通常利用ではほぼ無料枠内**と置く。請求ゼロは保証しないためbilling budget alertを設定する。

## 14. リージョン
ユーザー/Portal利用地とレイテンシを考慮し、東京リージョンを第一候補とする。
Storage / Cloud Run / BigQueryのデータ配置は可能な範囲で同一地域へ寄せ、不要なリージョン間転送を避ける。

既存Firestoreのlocationは変更困難なため、実プロジェクトのlocation確認後に最終決定する。

## 15. 撤回可能性
- 既存Wishlist等を変更しない
- 新生活データはcollection/API境界を分離
- BigQueryは派生先なので削除してもoperational dataは残る
- export可能なJSON/CSV形式を持つ

将来RDBが必要になった場合もCloud Run APIの背後を置換しやすくする。

## 16. Amazon待ちでも進められる範囲
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

## 17. 次の実装Issue
1. GCP/Firebase実環境・Security Rules・location確認
2. Cloud Run API skeleton + Firebase ID token検証
3. Cloud Storage raw upload + imports metadata
4. Firestore生活データcollection + security/index設計
5. MF CSV parser
6. inventory event write + idempotency + state再計算
7. Portal在庫/履歴UI
8. BigQuery分析連携
9. purchase-financial reconciliation UI
