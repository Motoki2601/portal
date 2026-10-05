# #16 本番反映準備・承認資料

最終確認: 2026-10-05。親: [#9](https://github.com/Motoki2601/portal/issues/9)、実施順序: [execution-plan.md](execution-plan.md)。
状態: ソース準備/匿名ローカル検証。本番変更未実施。#16はopenを維持する。

## 現在確認できたこと

- mainのAPI・Rulesソース・Tool境界はマージ済み。基準commit: `ec174d03d795a592cf0dc9ade9d95339224d3260`。
- API最終コード変更の[Commerce API checks](https://github.com/Motoki2601/portal/actions/runs/37272800977)は成功、コードcommit `852d737c37cc2e9f3aaa591560e4f07f44dfaefe`。
- Firebase projectは既存Portal設定の `wishlist-app-dcd2e`。Portal origin候補は `https://motoki2601.github.io`（パスは含めない）。
- #17のBilling/Blaze・Budget Alertは設定済みという既存記録を維持。現時点のBudget・課金状態は実環境で再確認が必要。Alertは停止制御ではない。
- この作業環境はNode 22/Java 22、gcloudはPATHとWindowsの一般的な3インストール先に見つからない。GCP実環境へ認証/接続はしていない。
- 現在のCloud Run revision、runtime IAM、公開設定、実Rulesは未取得。下記は提案するdesired stateであり、現行本番との差分確定ではない。

## 提案する変更と承認前の確定INPUT

| 対象 | 提案 | 確定前に読む現行情報 |
|---|---|---|
| runtime SA | Commerce専用SA。Owner/Editorなし。Firestore用 `roles/datastore.user` と失効/disabled確認用 `roles/firebaseauth.viewer` を必要範囲で付与 | 同名SAの有無、project/SA IAM binding、組織制約 |
| Cloud Run | `portal-commerce-api`、`asia-northeast1`、min 0/max 1、request timeout 30秒、runtime SA、固定ソースcommit/image digest | service/revision/traffic/config、最大課金・CPU/メモリ見積、既存rollback revision |
| API入口 | Cloud Run入口をFirebase ID tokenで認証。/health以外は署名/失効/disabled・UID allowlistをAPI検証。Cloud Run IAM tokenと同じBearerに二重指定しない | public ingressの可否、既存allUsers run.invoker binding、組織ポリシー |
| 環境設定 | GOOGLE_CLOUD_PROJECT、ALLOWED_UIDS（最初は専用試験ユーザーのみ）、PORTAL_ORIGINSを設定。Emulator変数禁止 | 現在env、専用UID、Portal origin。UIDやtokenは公開証跡へ書かない |
| Firestore Rules | repoのfirestore.rulesを独立反映。commerceは直接read/write禁止、wishlist/recipes/booksのdata文書は本人のみ許可 | 現行Rules全文/ruleset/release ID、既存Portal使用collection、本番rollback用Rules |
| Secret・費用 | 今回のAPI反映だけではGemini/Gmailを接続しない。Aのsecret/費用停止受入を別途確認 | #32の検証・既存Budget、必要なAPI有効化/Secret権限と追加課金 |

runtime SAのAdmin SDKはRulesを迂回し、同じprojectの他collectionにもIAM権限が及ぶ。UID分離とoperation制限はApplication側を併せて検証する。
デプロイ用権限・source build用権限はruntime権限と分け、役割を一括で過剰付与しない。API有効化・source build・Artifact Registryも費用と差分を確認する。

## 現行情報の取得（読取り、秘密出力を公開しない）

認証済みgcloud環境でprojectを明示し、service describe、revision list、project IAM、service IAM、SA存在、API enabled list、Billing/Budget現状を取得する。DescribeにはUIDやSecret参照が含まれ得るため出力は手元で確認し、公開Issueへ貼らない。
Firestore RulesはFirebase Console/APIから現行releaseとrulesetを取得し、repoソースとのdiffを手元で作る。gcloud run describeだけではRulesを確認できない。
この時点では設定のcreate/update/deployを実行しない。

## 検証

1. `cd server && npm ci && npm test`、`npm run test:emulator`。本番資格情報を使わずdemo-portalと匿名fixtureだけで実行する。
2. 追加の読取りsmoke runner契約試験: `node --test test/production-smoke.test.mjs`。これは偽fetch試験で実Firebase署名/IAMを証明しない。
3. 承認後、専用ユーザー・匿名データで実APIのread-only smokeを実行。
4. 実署名・失効/expired/別project・別UIDを検証。別UIDtokenは任意入力を省略したら「未検証」と報告。
5. 匿名観測1件でAPI→Firestore書込/監査/再送のruntime IAMを検証。Runnerはこの変更を行わないので、別の明示試験が必要。
6. Browser SDK専用ユーザーでcommerce直接操作の拒否、既存Portal3collectionの本人read/write、異UID拒否を実Rulesで検証。Emulator成功を代替にしない。

### 読取りsmoke runner

`node server/production-smoke.mjs`。必要な環境変数はCOMMERCE_API_URL（HTTPS origin）、SMOKE_ID_TOKEN、SMOKE_EXPECTED_UID、SMOKE_PORTAL_ORIGIN。別UIDのSMOKE_OTHER_USER_TOKENは指定時のみ検証。
Token/UIDは端末の安全なローカル環境から渡し、shell引数・公開Issue・PR・CIへ含めない。RunnerはGET/OPTIONSだけを使い、HTTPS/redirect禁止/timeoutを検証、結果にはcheck名だけを出す。返された履歴/token/UIDを出力しない。
health、未認証401、不正token401、本人UID一致、履歴、Origin拒否、CORS preflight、別UID403を確認する。失効/Rules/書込はremainingとして残る。Runnerの成功だけで#16を完了しない。
本番変更承認前は本番Runnerを実行しない。

## 実行・rollback（承認後のみ）

確定commit/image digest・SA・専用UID・origin・現行Rules diff・費用見積・検証結果を承認資料に揃える。
Cloud Runは初回ならサービスURL/新revision、更新なら現在revisionを記録し、問題時は以前のrevisionへtrafficを戻す。初回には旧revisionがないためサービス停止/削除も新たな操作として承認範囲に含める。
Rulesは取得した直前rulesetへ戻せる手順と既存Portal回帰の結果を揃える。古い広いallowがあればrollbackによる権限拡大を資料に明記する。
IAMは今回追加したbindingだけを戻し既存bindingを削除しない。
完了証跡はAPI URL、revision/digest、公開してよいIAM/Rules差分概要、匿名試験結果、CIリンク、承認記録。秘密や本人履歴は含めない。

## 再開情報

次の一手: このPR/CIをレビュー→認証済みGCP環境で現行情報を読取り取得→actual diff/rollback/費用を確定→本番承認依頼。
障害: gcloud/実環境認証、現在Rules/revision/IAM、専用試験UIDが未確認。本人Gmail取込・送信・定期開始は本作業の対象外。

## 公式根拠

- [Firebase ID token検証](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
- [Firebase IAM roles](https://cloud.google.com/iam/docs/roles-permissions/firebaseauth)
- [Firestore server SDKとRules](https://firebase.google.com/docs/firestore/security/rules-conditions)
- [Cloud Run最大instance](https://cloud.google.com/run/docs/configuring/max-instances)
