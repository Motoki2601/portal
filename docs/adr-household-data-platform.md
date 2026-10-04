# ADR: 生活データ基盤の構成方針

関連: #9 / #11 / #12 / #13 / PR #14
状態: Proposed（Amazon固有項目と料金最終確認後にAcceptedへ更新）

## 1. 結論
既存PortalのFirebase Auth / Firestoreは維持し、生活データ基盤はGoogle Cloud上に段階追加する。

採用候補構成:

```text
Portal (GitHub Pages)
  ├─ 既存機能 → Firebase Auth / Firestore
  └─ 生活データ機能
       ↓ Firebase ID token
     Backend API (Cloud Run第一候補)
       ├─ Cloud Storage: raw原本
       ├─ BigQuery: parsed / curated / reconciliation / analytics
       └─ 必要に応じてジョブ実行
```

既存Firestoreデータは移行しない。
PortalからCloud Storage / BigQueryへ直接アクセスさせない。

## 2. 判断理由

### 既存Firebaseを残す理由
- Googleログインと既存3機能がすでに動作している。
- Wishlist/Recipes/Booksは`users/{uid}/...`配下の単純なデータ構造で、現状のFirestore方式で要件を満たしている。
- 全面移行は認証・既存データ移行・回帰試験を増やすが、MVPの価値には直結しない。

### 生活データを別レイヤーにする理由
生活データ側では次が必要になる。
- PDF/CSV原本の保管
- raw / parsed / curatedの再処理
- purchase / financial transactionの多対多突合
- append中心の在庫イベント履歴
- 冪等性
- 訂正後の再計算
- 分析・購入周期計算

既存の「1ドキュメントへ配列全体を書き戻す」方式をそのまま拡張するより、API境界と分析用ストアを分ける方が変更影響を限定できる。

## 3. コンポーネント

### Firebase Auth
継続利用する。
Portalで取得したFirebase ID tokenをBackend APIへ送信し、API側で検証する。
API内の`user_id`は検証済みtokenのuidから決定し、クライアント指定値を信用しない。

### Firestore
既存Wishlist / Recipes / Booksで継続利用する。
生活データ基盤の正本としては原則利用しない。
MVPで低レイテンシな小規模UI状態が必要になった場合だけ補助用途を再評価する。

### Cloud Storage
非公開raw原本を保持する。

推奨パス概念:
`raw/{user_uid}/{source_type}/{yyyy}/{mm}/{opaque_file_id}`

要件:
- public access禁止
- API/取込サービスアカウントのみ必要最小権限
- `source_files`にstorage URI / hash / parser_version / statusを記録
- 原本削除と正規化データ削除を別々に追跡可能にする

### BigQuery
第一候補の分析・突合ストア。

論理dataset例:
- `ingestion`: source_files / import metadata
- `parsed`: 原本から機械抽出した値
- `curated`: products / variants / purchase_orders / purchase_lines / inventory_events
- `reconciliation`: financial_transactions / transaction_order_links
- `derived`: inventory_state / consumption_metrics / replenishment_candidates

物理dataset分割は実装時に簡素化してよいが、raw/parsed/curated/derivedの責務は混ぜない。

### Backend API
Cloud Runを第一候補とする。

理由:
- HTTP APIとバッチ/ジョブ処理を同じコンテナ技術へ寄せやすい
- PDF/CSVパーサ、ライブラリ、処理時間の自由度がFunctionsより高い
- 将来のChatGPT/iPhone Shortcut等の外部入口も同じ認証境界へ寄せられる

Cloud Functionsは、単純なStorageイベント起動等が必要になった場合の補助候補とする。MVPでは両方を導入しない。

## 4. 書き込み経路

### 手入力イベント
Portal → API → 検証 → inventory_event保存 → 現在状態再計算

### ファイル取込
Portal → APIでアップロード開始 → Cloud Storage raw保存 → parser実行 → parsed保存 → candidate生成 → ユーザー確認 → curated確定

### 原則
- PortalからBigQueryへの直接writeは禁止
- inventory_eventはAPIを共通書き込み境界とする
- `user_id + idempotency_key`を一意として再送をno-op化
- 同一keyで異なるpayloadは409相当の競合として扱う

## 5. 必要なAPI（MVP）
1. `POST /imports` 原本登録/取込開始
2. `GET /imports/{id}` 解析状況・エラー取得
3. `GET /purchase-candidates` 取込候補確認
4. `POST /inventory-events` 在庫イベント登録
5. `GET /inventory` 現在状態取得
6. `GET /inventory-events` 履歴取得
7. `POST /inventory-events/{id}/void-or-correct` 訂正/取消

初期MVPではこの程度に限定し、汎用CRUD APIにはしない。

## 6. 主要クエリ/集計

最低限次を支える。
1. 商品別の現在在庫
2. 商品別イベント履歴
3. 未突合purchase / financial transaction候補
4. 過去3〜6か月の購入回数・購入間隔
5. 開封〜使い切りの有効観測一覧

JOINが必要なため、purchase / line / transaction / linkをFirestoreのネストだけで完結させるよりBigQuery等の関係・分析処理に向く基盤が有利。

## 7. リアルタイム性
MVPでは秒単位リアルタイム同期を要件にしない。

- 手入力後: APIレスポンス後に再取得で十分
- ファイル取込: status pollingまたは明示更新で十分
- 補充候補: イベント登録時または閲覧時更新から開始

Pub/Sub / Dataflow /常時ストリーミング処理は導入しない。

## 8. セキュリティ
- Firebase ID tokenをAPIで検証
- uidをサーバー側で確定
- Cloud Storage bucketは非公開
- BigQueryへブラウザから直接接続しない
- サービスアカウントは最小権限
- 実データ・注文番号・金融明細を公開GitHubへ保存しない
- 開発/本番は少なくともStorage bucket / dataset / API設定を分離する

Firestore Security RulesとApp Checkの現状は別途実環境確認が必要。

## 9. バックアップ/復元
- raw原本は再解析可能な一次ソースとして保持
- curatedデータはエクスポート可能にする
- inventory current stateはイベントから再構築可能にする
- 派生テーブルは消失しても再計算可能にする

「派生状態のバックアップ」より「raw + event履歴の保持」を優先する。

## 10. 候補比較

### A. Firestore中心
有利: 実装量・サービス数を最小化したい場合。
不利: 多対多突合、履歴再処理、分析クエリが増えるほどモデルが複雑。

### B. Supabase/PostgreSQL追加
有利: 強いトランザクション、関係モデルを単一DBで扱いたい場合。
不利: Firebase Authとの統合と新たな運用系統が増える。Google Cloudで原本/分析を持つ場合は基盤が分散する。

### C. Firebase + Google Cloud併用（採用候補）
有利: 既存機能を壊さず、raw保管・分析・API処理を段階追加できる。
不利: FirestoreとGCPの2系統になり、IAM/課金/監視の理解が必要。

### D. 全面移行
有利: 最終的に単一方式へ統一できる。
不利: MVP前の移行コストが最大。現時点では便益不足。

優先順位が「早くMVPを作り、既存Portalを壊さない」ならCが有利。
「全データを厳密なOLTPの単一RDBへ統一」が最優先ならB/Dを再評価する。

## 11. 費用方針
個人利用MVPのデータ量は小さい前提とし、従量課金サービスを最小構成で使う。

ただし正式な採用前に、Cloud Storage / BigQuery / Cloud Runの現行料金・無料枠・リージョン条件を公式情報で再確認し、月間件数仮定を置いて月額概算を追記する。

費用が想定より高い場合の縮退案:
- BigQuery常用をやめ、Cloud Storage + 小規模DBへ寄せる
- バッチ頻度を下げる
- derived計算をオンデマンドにする

## 12. 撤回可能性
この構成は段階導入とする。

- 既存Firestoreは変更しない
- 新規生活データ機能だけAPI配下へ置く
- UIからAPIを外せば既存Portalへ影響せず撤回できる
- raw/curatedのexport形式を用意し、別DBへ移せるようにする

## 13. 未解決事項
- Amazon原本の外部ID・数量・価格・分割発送粒度
- Firestore Security Rules / App Checkの実設定
- GCP現行料金の正式確認と月額概算
- Cloud RunのリージョンとBigQuery/Storageの配置
- BigQueryをイベント正本にするか、書き込み系に別OLTPストアを追加するかの最終判断

最後の論点は重要。MVPの書き込み頻度・トランザクション要件が低ければBigQuery中心で開始可能だが、イベント登録の一意制約や競合制御を厳密に行うならCloud SQL/Firestore等をwrite modelとして追加する余地を残す。

## 14. 次の実装Issue候補
ADR確定後、以下を分割する。
1. GCPプロジェクト/環境・IAM・Storage作成
2. Firebase ID token検証付きCloud Run API skeleton
3. source_files + raw upload経路
4. MF CSV parser / parsed保存
5. inventory_event write + idempotency
6. inventory state query/API
7. Portal在庫画面/履歴画面
8. purchase-financial reconciliation UI
