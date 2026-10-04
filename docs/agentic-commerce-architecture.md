# Agentic Commerce Architecture

関連: #9 / #12 / #13 / #16 / #17

## 1. 目的
既存の生活データ基盤を、将来のAgentic Commerceに拡張できる構成へ整理する。

本ドキュメントでは、現在のFirebase / Firestore / Cloud Run / Cloud Storage / BigQuery構成を残しつつ、Agent Runtime、Tool/MCP境界、Commerce protocol adapter、購入承認をどこに追加するか定義する。

## 2. 結論
現在の基盤はData / Transaction Planeとして継続利用する。
Agentic Commerce化では上位に以下を追加する。

```text
Portal
  ↓
Firebase Auth
  ↓
Personal Commerce Agent
  ↓
Tool / Policy / Commerce Adapter layer
  ├─ Internal Tools → Cloud Run application usecases
  │    ├─ Firestore: operational source of truth
  │    ├─ Cloud Storage: raw purchase/finance files
  │    └─ BigQuery: analytics / predictions
  ├─ Commerce adapters → merchant APIs / UCP / ACP / A2A where available
  └─ Authorization → user approval / policy / mandate record
```

決済カード情報は本基盤で保持しない。

## 3. Agentic Commerceの責務分離
### Data Plane
既存構成。
- Firestore: 商品、購入、在庫、intent、offer、authorization等のoperational state
- Cloud Storage: raw PDF/CSV
- BigQuery: 購入周期、消費速度、価格・履歴分析、候補生成

### Tool Plane
Agentが安全に呼べるドメイン操作。
例:
- get_current_inventory
- get_purchase_history
- get_replenishment_candidates
- create_purchase_intent
- record_offer
- request_purchase_authorization

Firestore/BigQuery SDKをAgentへ直接公開しない。

### Agent Plane
Personal Commerce Agentが、利用者の目的を解釈し、必要なToolを順序立てて実行する。
MVPでは単一Agentから開始し、必要になった場合だけsub-agentを追加する。

### Commerce Integration Plane
外部merchantとの接続をadapterで隔離する。
- normal REST/API
- MCP tool
- UCP
- ACP
- A2A

内部ドメインモデルを特定protocolへ従属させない。

### Trust / Authorization Plane
Agentの推薦と購入実行を分離する。
「おすすめした」と「購入を許可した」を同一レコードにしない。

## 4. 追加ドメインモデル
### purchase_intents
購入ニーズを表す。
主な項目:
- purchase_intent_id
- user_id
- product_variant_id / category
- reason
- desired_quantity
- required_by
- max_total_amount
- constraints
- source_type
- created_at
- status

status候補:
- draft
- active
- fulfilled
- cancelled
- expired

### merchant_offers
merchantから取得した購入候補。
- offer_id
- purchase_intent_id
- merchant
- external_product_ref
- title
- quantity / unit
- item_price
- shipping_amount
- total_amount
- points / rewards
- availability
- delivery_estimate
- observed_at
- expires_at
- source_type
- source_ref

### recommendations
Agentがoffer群から生成した推薦。
- recommendation_id
- purchase_intent_id
- selected_offer_id
- rationale_summary
- alternatives
- generated_at
- agent_run_id

### purchase_authorizations
購入実行の許可。
- authorization_id
- purchase_intent_id
- offer_id
- authorization_type
- scope
- max_amount
- granted_at
- expires_at
- granted_by
- status

MVPでは `explicit_user_approval` のみ。
将来 `standing_policy` 等を追加可能にする。

### agent_runs
Agentの実行単位。
- agent_run_id
- user_id
- trigger_type
- started_at
- completed_at
- status
- model/provider
- policy_version
- result_summary

### tool_calls
Agentの監査ログ。
- tool_call_id
- agent_run_id
- tool_name
- request_id
- input_summary / input_hash
- output_summary / output_hash
- started_at
- completed_at
- status
- side_effect_level

個人情報・秘密値は丸ごとログに保存しない。

## 5. MVPフロー
最初のAgentic Commerce MVPは完全自動購入ではなく、以下とする。

```text
inventory / consumption history
   ↓
replenishment candidate
   ↓
purchase_intent
   ↓
product / offer search
   ↓
comparison
   ↓
recommendation
   ↓
explicit user approval
   ↓
merchant checkout handoff
   ↓
order history import
   ↓
receipt / inventory update
```

merchant checkout handoffは、merchant APIが利用できない場合は購入ページへの遷移でもよい。

## 6. Automation level
### Level 0
記録・分析のみ。

### Level 1
Agentが不足を検知し、商品候補と理由を提示する。

### Level 2
Agentが購入intent作成、offer比較、1候補推薦まで行い、ユーザー承認後にcheckoutへ遷移する。

### Level 3
事前ポリシー内の低額・定型商品について購入実行を委任する。

### Level 4
複数merchant、予算、配送、在庫、ポイント等を含めて継続的に自律最適化する。

当面の目標はLevel 2。

## 7. Policy
MVPでは自動購入しない。

将来用policy例:
- allowed_categories
- blocked_categories
- max_amount_per_order
- max_amount_per_month
- allowed_merchants
- require_explicit_approval_above
- allow_substitution
- delivery_deadline

policy評価結果はauthorizationと分離して監査可能にする。

## 8. Payment
カード番号・CVV等の決済credentialはFirestore / BigQuery / GitHubに保存しない。

購入実行はmerchant checkout / payment provider / agentic payment protocolへ委譲する。
本システムが保持するのは、購入intent、offer、承認、order参照、監査情報までとする。

## 9. MCP / protocol strategy
内部tool contractを先に固定する。
MCP、UCP、ACP、A2A等はadapterとする。

```text
Agent
  ↓
Internal Tool Contract
  ↓
Application Usecase
  ↓
Domain
```

外部protocol:

```text
Commerce Adapter
  ├─ REST merchant API
  ├─ MCP
  ├─ UCP
  ├─ ACP
  └─ A2A
```

protocol変更でdomain modelを書き換えないことを要件とする。

## 10. セキュリティ
- Agent/tool呼び出しでもFirebase uidを基準とする
- Cloud Run runtime SAの権限以上の操作はできない
- write toolはidempotency keyを必須化
- side effectのあるtoolは監査ログを残す
- authorizationなしにorder確定しない
- raw金融データをモデルpromptへ無制限投入しない
- agent runごとにrequest id / policy versionを保持

## 11. Amazon待ちとの関係
Amazonデータ待ちはAgentic Commerce設計のブロッカーではない。

今進められる:
- Tool API boundary
- purchase_intent
- offer
- recommendation
- authorization
- agent_run / tool_call
- inventory不足→purchase intent生成

Amazon確認後:
- Amazon固有product/order/shipment ID
- offer取得方法
- checkout/購入連携可否
- 返品/キャンセル同期

## 12. 実装順序
1. #17 Billing / Budget
2. #16 Cloud Run API / Tool boundary
3. Agentic Commerce domain model
4. Inventory → replenishment candidate → purchase intent
5. Offer ingest/search abstraction
6. Recommendation + approval UI
7. Personal Commerce Agent runtime
8. MCP transport
9. merchant adapter
10. protocol-specific UCP/ACP/A2A/AP2等を必要に応じて追加
