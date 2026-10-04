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
  ├─ Cloud Storage: private raw PDF/CSV
  └─ BigQuery: analytics / reconciliation / derived metrics
```

## 2. 認証・認可
- Firebase Authを継続利用する。
- Cloud RunでFirebase ID tokenを検証し、uidはtokenから確定する。
- request bodyのuser_idを信用しない。
- Cloud Run Admin SDKはFirestore Security Rulesをバイパスするため、API側認可を必須にする。
- App CheckはMVP着手の必須条件にはせず、公開運用前の追加防御として再評価する。

## 3. Firestore
生活データのoperational正本とする。
推奨collection:
- `users/{uid}/products/{productId}`
- `users/{uid}/productVariants/{variantId}`
- `users/{uid}/purchaseOrders/{orderId}`
- `users/{uid}/purchaseLines/{lineId}`
- `users/{uid}/financialTransactions/{transactionId}`
- `users/{uid}/transactionOrderLinks/{linkId}`
- `users/{uid}/inventoryEvents/{eventId}`
- `users/{uid}/imports/{importId}`

1論理レコード=1 documentを基本にする。
`user_id + idempotency_key`の冪等性はdocument IDまたは専用lock/index documentとFirestore transactionで担保する。

## 4. Cloud Storage
raw原本を非公開保存する。
パス概念: `raw/{uid}/{source_type}/{yyyy}/{mm}/{opaque_file_id}`
public accessは禁止し、runtime service accountのみ必要なobject read/writeを許可する。

## 5. BigQuery
operational正本にはせず分析用途へ限定する。
- parsed data
- reconciliation analysis
- purchase interval
- consumption metrics
- replenishment candidates

Firestoreと競合した場合はFirestoreを正とし、BigQuery側は再生成可能にする。

## 6. Cloud Run
HTTP API / parserの第一候補。
MVPではCloud Functions / Pub/Sub / Dataflowを追加しない。

## 7. IAM / Service Account
Cloud Run runtime専用Service Accountを作る。
デフォルトCompute Service AccountやOwner/Editorは利用しない。

runtime SA:
- Firestore: 必要なデータread/write
- Cloud Storage: raw専用bucketのobject read/write
- BigQuery: 対象datasetの必要read/write + job実行
- project全体のData Owner等は付与しない

デプロイ主体とruntime主体を分離する。
GitHub ActionsによるGCP deployを導入する場合はWorkload Identity Federationを第一候補とし、長期Service Account key JSONをGitHub Secretsに保存しない。

## 8. dev / prod
MVPでは同一GCP project内で論理分離する。
- Cloud Run: `portal-household-api-dev` / `portal-household-api-prod`
- Storage: dev / prodで別bucket
- BigQuery: `household_dev` / `household_prod`
- Firestore: 本番とfixture/testを混在させない。ローカル/自動テストはFirebase Emulator優先
- 環境変数/CORS/runtime SAをdev/prodで分離
- 本番rawをdevへコピーしない

複数ユーザー化、CI/CD高度化、誤操作リスク増大時にprod別projectを再評価する。

## 9. リージョン
確認済みFirestore locationは `asia-northeast1`（東京）。
- Cloud Run: `asia-northeast1`
- Cloud Storage: 東京
- BigQuery: 東京
を第一候補とする。

## 10. 現行実環境
- project: `wishlist-app-dcd2e`
- Firestore: `asia-northeast1`
- Security Rules: `users/{userId}/{collection}/{docId}` は `request.auth.uid == userId` の本人read/write
- App Check: OFF
- Billing: Spark / OFF
- Budget Alert: なし

## 11. 費用方針
個人MVP想定:
- 1ユーザー
- inventory event 100〜1,000件/月
- API 数百〜数千request/月
- raw 数十〜数百MB、将来1GB程度
- BigQuery 数GB〜数十GB query/月

目標月額は0〜数百円。請求ゼロは保証しない。
Cloud Run / Cloud Storage / BigQuery利用前にCloud Billingを有効化し、直後にBudget Alertを設定する。

## 12. 書き込み経路
手入力:
Portal → Cloud Run → token検証 → Firestore transaction → inventory_event → state更新

raw取込:
Portal → Cloud Run → Cloud Storage → import metadata → parser → parsed → candidate確認 → Firestore curated

分析:
Firestore/parsed → BigQuery → API → Portal

## 13. MVP API
- `POST /imports`
- `GET /imports/{id}`
- `GET /purchase-candidates`
- `POST /inventory-events`
- `GET /inventory`
- `GET /inventory-events`
- `POST /inventory-events/{id}/void-or-correct`

## 14. Amazon待ちでも進める範囲
- Firebase token認証API
- raw Storage
- import metadata
- MF CSV parser
- products/productVariants
- inventoryEvents + idempotency
- inventory state API/UI

Amazon確認後に確定:
- external_line_id / product_code / product_url
- quantity / price粒度
- shipment識別子
- EC返品/キャンセル連携

## 15. 実装ゲート
設計はAccepted。
実装開始前の利用者作業はCloud Billing有効化 + Budget Alert設定。
その後 #16 Cloud Run API skeletonへ進む。
