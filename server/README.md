# Personal Commerce API（#16 初期実装）

既存Portalと別のNode.js API。Firebase ID tokenからuidを検証し、許可済みユーザーの購入履歴取込・取得、商品照合、補充候補算出、明示状態・訂正、AI会話Toolと推薦保存を提供する。フレームワークやMCPは追加しない。

## operation

| HTTP | 認証 | 動作 |
|---|---|---|
| GET /health | 不要 | プロセス起動確認（外部サービスの正常性保証ではない） |
| GET /me | 必須 | token由来uid |
| GET /purchase-history | 必須 | get_purchase_history。productId/fromOn/toOn/limit/cursor |
| POST /user-observations | 必須 | record_user_observationのkind=stateのみ |
| POST /imports/amazon-csv | 必須 | 変換済みCSV提案を1注文ずつtransactionで保存 |
| POST /purchase-history/match-products | 必須 | body={}。強い商品SKUでProductを照合 |
| GET /replenishment-candidates | 必須 | 当日の補充候補だけを返す |
| GET /replenishment-estimates | 必須 | 対象外理由を含む全商品の算出結果 |
| POST /tools/call | 必須 | 許可済みread/推薦Tool。ユーザー補正grantは受け付けない |
| POST /corrections | 必須 | 許可fieldのoverride設定・解除。revision確認と監査 |
| POST /product-usage | 必須 | 現在利用の登録・同カテゴリの原子的切替 |
| POST /recommendations | 必須 | 文脈fingerprint一致を確認して推薦snapshot保存 |

保護operationはFirebase Admin verifyIdToken(token,true)で署名/発行元/期限/失効・無効ユーザーを確認し、ALLOWED_UIDSで利用者を限定する。request bodyやqueryのuidは受け付けない。Originがある場合はPORTAL_ORIGINSの完全一致のみ許可（GitHub Pagesのoriginはパスを含まない）。CORSは認証の代わりではない。

共通エラーは `{code,message,retryable,requestId}`。401はtoken不正、403はユーザー/Origin対象外、400は入力不正、409はmutation ID再利用、503は認証基盤障害。本文・token・氏名等をログへ出さない。

履歴はユーザー配下の注文/明細/商品を読み、userOverridesを適用してから購入日降順・注文ID降順・明細ID降順で返す。個人規模のためcollectionごと最大5,000件までのbounded scan。過大入力は413で拒否し、結果を黙って切り捨てない。新規/訂正がページ間に起きる場合のsnapshot固定は未提供。

状態記録は次の型に限定する:

```json
{
  "clientMutationId": "unique-operation-id",
  "productId": "product-a",
  "kind": "state",
  "value": "spare_available"
}
```

valueはunknown/likely_available/running_low/spare_available/out_of_stock。observedAtは任意の過去または現在のRFC3339日時、noteは任意で500文字まで。DBパス・任意field・訂正・使用商品切替は受け付けない。

Observation＋ProductState＋AuditLogを1 transactionで保存。同clientMutationId/同内容は元のresultを返し、異なる内容は409。productが同uidに存在しなければ404。履歴上の古い申告はログへ残すが新しい明示状態を上書きしない。stateRecordedAt、inputFingerprint、resultは最小実装の追加メタデータ。状態は7日後にも解除せず、likely_available/spare_availableの通知抑制期限のみ7日で保存する。

状態記録レスポンスはestimateを含めない。記録後は候補/算出結果GETで最新の状態を含めて算出できる。usage/対象指定/release、購入訂正は末尾のAI会話契約に対応。Gmail取込の書込みoperationは後続。estimateの保存projectionはまだ使用しない。

## ローカル検証（本番資格情報不要）

Node.js 24、Java 21以上、Python 3.11以上を用意する。

```bash
cd server
npm ci
npm test
npm run test:emulator
```

Auth/Firestore Emulatorのみをdemo-portalで起動する。HTTP入力/認証の単体検証、Firebase SDKによるtoken検証、実Firestore transactionの同時再送、異uid参照、ルールによる直接アクセス拒否を検証する。Emulatorは本番署名検証/本番IAMを再現しない。単体試験のexpired/revoked/wrong-projectは検証器からのエラーを模擬する。本番SDKに認証を委譲し、認証を回避するfixtureモードは実装しない。

手元でAPIを動かす場合、ターミナルA:

```bash
cd server
npx firebase emulators:start --config ../firebase.json --project demo-portal --only auth,firestore
```

ターミナルB:

```bash
cd server
export GOOGLE_CLOUD_PROJECT=demo-portal
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
export ALLOWED_UIDS=fixture-owner
export PORTAL_ORIGINS=http://localhost:5173
export PORT=8081
node seed-emulator.mjs
npm start
```

seed helperはlocalhost emulator＋demo-portal以外へ書き込めない。匿名fixtureを格納し、ローカルtokenをgitignore対象の.emulator-id-tokenへ保存する。テストログ/fixtureは実個人データを含まない。

ターミナルC（serverディレクトリから）:

```bash
curl http://localhost:8081/health
curl -H "Authorization: Bearer $(cat .emulator-id-token)" http://localhost:8081/purchase-history
curl -X POST -H "Authorization: Bearer $(cat .emulator-id-token)" \
  -H 'Content-Type: application/json' \
  -d '{"clientMutationId":"sample-1","productId":"product-a","kind":"state","value":"spare_available"}' \
  http://localhost:8081/user-observations
```

## 本番準備・デプロイ手順

本PRはデプロイしない。既存Firebase projectはPortalのsrc/firebase.tsで確認できる。実行時にGOOGLE_CLOUD_PROJECT、本人Firebase uid、Portal originを設定する。uidはPortalのFirebase Auth登録ユーザーを確認しALLOWED_UIDSへ指定する。資格情報をAPIリクエストやGitHubへ保存しない。

Cloud Run runtime Service AccountにはFirestoreのread/write（roles/datastore.user）と失効/無効ユーザー確認のFirebase Auth read（roles/firebaseauth.viewer）を付与し、owner/editorは使用しない。FirestoreサーバーSDKのIAMはdocument別のuid分離を提供しないため、Application側のユーザー配下固定とoperation制限が必要。共有projectの本/料理/wishlistにもSA権限が及ぶ点を理解して設定する。

ADCはCloud RunのService Accountを利用する。ローカル本番接続ではgcloud auth application-default login等の適切なADCが必要だが、通常の検証はEmulatorを使う。Cloud Run上のエミュレーター環境変数は起動時に拒否する。

```bash
# repo root。project/uid/SAは実際の値に置換する。
gcloud run deploy portal-commerce-api --source server --region asia-northeast1 \
  --project FIREBASE_PROJECT_ID --service-account RUNTIME_SA_EMAIL \
  --allow-unauthenticated --min-instances 0 --max-instances 1 \
  --set-env-vars GOOGLE_CLOUD_PROJECT=FIREBASE_PROJECT_ID,ALLOWED_UIDS=FIREBASE_UID,PORTAL_ORIGINS=https://motoki2601.github.io

# ブラウザがcommerceを直接操作しないことを確認してrulesを反映。
server/node_modules/.bin/firebase deploy --project FIREBASE_PROJECT_ID --only firestore:rules
```

Cloud Runの入口を公開するのはFirebase Bearer tokenをAPIで検証するため。/health以外は認証必須。Cloud Run IAMトークンとFirebase tokenを同じAuthorizationヘッダーへ同時指定しない。

ルールは既存 `wishlist/data`、`recipes/data`、`books/data` の本人アクセスだけ許可し、commerceはread/writeともAPI経由。このallowlist外の既存機能がある場合は反映前に確認する。Portalの既存コードは上記3documentのみ使用していた。

デプロイ後は実Firebase tokenで/me、購入履歴、状態記録を確認し、未認証401・別uid403を確認する。Firestore RulesはAPI/Portalの配置を更新するだけでは反映されないので上記deployを別途行う。

公式: [ID token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens)、[Admin SDK setup](https://firebase.google.com/docs/admin/setup)、[Server Rules bypass](https://firebase.google.com/docs/firestore/security/get-started)。

## Amazon初期履歴の保存

Python変換出力を保存する認証済みHTTP operation。uidはtoken由来、256KiB/リクエスト、1注文50明細まで。未対応の字段・任意DBパス・金額/商品照合/overrideの入力は拒否する。source/fileHashesと注文IDを検証するが、hashから元CSVの真正性を証明するものではない。本人がオフライン変換した提案を入力として扱う。

```bash
# repo root。tokenファイルは本人が取得したFirebase ID token（公開しない）。
node server/import-amazon-json.mjs /private/orders.json https://API_HOST /private/firebase-id-token
```

全注文を事前に型検証し、HTTPは逐次実行。成功件数だけを表示し、token・商品名・注文IDはログに出さない。DBの原子性は注文単位であり、ファイル全体ではない。途中失敗時は同じ入力を再実行できる。同batch＋orderの同内容再送はno-op、内容違いは409。返品CSVだけが変化したbatchも再評価する。

order identity予約・注文/明細・Source・試行結果・監査をtransactionで保存する。保存Sourceは`scope=order`、IDは全fileHashes由来のbatch＋注文キーで生成し、ファイル集合ごとの根拠を固定する。関連CSVだけの変更も別Sourceになる。Python提案のhistory単位sourceIdはinputSourceIdとして保持し、保存する注文/明細/fieldOrigins/監査は注文単位Sourceへ参照を付け替える。

Source.status/importedAtはこの注文の処理状態であり、ZIP全体の完了を表さない。途中停止でも未処理注文のSourceを取込済みとは記録しない。ファイル全体の進捗はCLIのprocessed/imported/needsReview件数で示し、バッチ全体の完了documentは作らない。CSVが変わっても同SKUの一意な既存明細を利用し、source行番号を最終line IDにしない。userOverrides・既存商品照合・既知の金額は維持する。旧batchの再送は既存の結果を返すため、その後の取消更新を巻き戻さない。

`unknown→ordered`は、前回の確認理由が関連CSV欠損だけで、今回それが解消され数量も一致する場合に限り自動反映する。返品/交換/未確定状態や取消からの復帰は引き続き確認待ち。

Gmail注文は、一意な同SKU＋同名称＋同数量＋同状態の既存明細へ対応できる場合だけ統合する。本文注文日との矛盾・状態/数量矛盾・SKUなし/同SKU複数行・購入日不明はSourceのみneeds_reviewとし、注文/明細は更新しない。受信日fallbackはCSVの実注文日で置換可能。CSV内の返品/未確定明細はunknown、取消はcancelled、無償交換はunknownで保存し、有効購入と数えない。

CSV保存operation自体はProductを作らず、照合済みproductIdだけ維持する。次節の照合operationと候補算出を別途実行する。確認待ちの解決UI、Gmail取得/parser、AI照合は含まない。本番書込みはデプロイ後に上のCLIを明示実行する。この実装検証では個人データを送信しない。

## 商品照合・補充候補の算出

CSV保存後に`POST /purchase-history/match-products`へ空JSONを送る。商品名だけでは統合せず、scope付きmerchantSkuの完全一致で一意性を予約する。同SKUの競合Product・既存照合の矛盾はneedsReview件数へ。ユーザーのproductId overrideはnullも保持する。同SKU100明細を超える場合も自動照合を保留する。処理はSKUごとのtransactionで、途中中断時は再実行可能。

未照合SKUはProductを作成し、category/brand/容量/包装は推測せずunknown/null。confirmed＋orderedの異なる購入日が2日以上あるとcandidateへ分類する。これは再購入品の確認候補であり、消耗品/実在庫/現用の確定ではない。ユーザー指定のexcluded等は自動変更しない。追加取込後にも照合operationを再実行する。

候補/算出結果GETは4collection（注文・明細・商品・状態、各最大5,000件）を読み取りtransactionの同一snapshotで取得し、毎回最新のeffective値を計算する。結果はオンデマンドで返し、replenishmentEstimates collectionへキャッシュ保存しない。state申告・取消・訂正後も古い保存値を返さず再算出する。定期実行、推定projection保存、AI分類/名称/カテゴリ推定、カテゴリ指定/usage/releaseの書込みUIは後続。

同日の購入を1機会へ集約し、平均・中央値、中央値を四捨五入した次回日、7日前の通知開始日を返す。数量で周期を割らない。商品履歴不足は既知カテゴリだけ補助し、カテゴリ不明は推定不可。excluded/not_current・7日抑制を優先し、過去の残あり状態は消さない。同カテゴリの別商品を後から購入している場合は、明示currentがない古い商品を候補から除く。明示out_of_stockの周期不足例外はcurrent指定された対象商品だけ。候補は在庫切れの断定ではない。

## AI会話 / Tool境界 (#19)

`POST /tools/call` は `{name,arguments}` で許可済みread/推薦Toolを実行。Firebase認証済みUIDのみを使用し、モデルからuser補正権限を受け取らない。
本人の明示操作は `POST /corrections`、`POST /product-usage`、推薦保存は `POST /recommendations`。すべてJSON。`/recommendations` と `/tools/call` は256KiB上限（UTF-8 bytes、envelope込み）、補正・使用商品切替・状態記録は8KiB上限。
transport非依存の `createCommerceTools` と注入providerの `runCommerceConversation`、訂正・切替・推薦transactionを提供する。
実AI/検索providerと会話UIの接続は後続。詳細・入力フィールドは [conversation-tools.md](../docs/personal-commerce/conversation-tools.md)。
