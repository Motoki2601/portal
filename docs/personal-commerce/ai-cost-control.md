# AI・検索費用の停止契約（#32）

## 範囲と残作業

非本番の台帳・設定検証と共通provider呼出境界を提供する。Gemini text送信adapterと既定OFFのruntime構成を追加（末尾参照）。実Secret/IAM/有料API受入、会話route/Tool接続、検索、取込保留/価格なし通知の本体は未完了。本番のSecret/IAM/課金設定を変更しない。#17のBilling/Budgetは再実装しない。2026-10-05に#17記録を確認。ロードマップ#9にはその後の実Billing/Budget確認・紐付け完了記録がある。Budget Alertは通知であり支出上限ではない。

## 共有interface

`createAiBudgetGate(db, {scope, clock, limitMicros})`。既定scopeは全AI/検索を共有するpersonal-commerce、700,000,000 micro-JPY（700円）。uid別に分割しない。JST月はホストclockから決める。

1. `reserve({operationId,kind,model,upperBoundJpyMicro,pricingVersion,hardBoundVerified})`。kindはai/search、modelは固定gemini-3.5-flash-lite。整数micro-JPY。operationIdはサーバーで導出し同じ論理処理の再開で維持。全費用（thinking・tool round・検索を含む）にadapterが保証する最大額を予約。見積りやprompt指示を最大額保証にしない。保証不能・料金/為替未設定では外部callを拒否する。
2. `claimDispatch(reservationId)`がtrueを返した担当だけ一度外部callを発行。reserveのallowed/replayだけでは発行しない。claim後にプロセス終了した場合も発行権を復活しない。
3. `settle(id, actualJpyMicro)`で実額確定。成功・失敗で課金額が確定した場合に利用。結果/課金不明は`markUnknown(id)`、予約を維持し自動再送しない。送信前の予約のみ`cancel(id)`で解放。unknown後に課金が確定したらsettle可。
4. 予約超過の確定も隠さず記録し、全月の新規予約を停止。原因・料金上限を再検証した後の運用者による解除は別途レビュー/承認。既存実費は取り消せない。

同じoperationIdの変更入力はconflict。月を跨いだdispatched/unknownの再開も元の月へ確定し再発行しない。旧月の未発行reservedはclaimを拒否する。旧予約をcancelし、新IDで新月へ予約してから発行する。未確定予約をTTLで消さない。設定上限は700円超を拒否する。外部callの課金月はprovider側の記録と照合が必要であり、月境界をまたぐ既発行callの実請求日を本台帳だけで保証しない。

拒否は`{allowed:false,code,fallback:{deferImports:true,history:true,replenishment:true,notificationPrice:false}}`。後続担当はこの決定情報を受けて取込保留、履歴・周期継続、価格なし通知を実装・検証する。現在この機能の統合は未実装。

## 共通provider呼出境界（2026-10-06）

`createBudgetedProvider({gate,prepare,dispatch})` → `call(input,{operationId,signal})`。#32の共通境界であり、実Gemini/検索adapter・HTTP route・runtimeには未接続。偽providerで既存会話loopへの接続を検証する。

- `prepare`は信頼するサーバー側adapter。送信前の個人情報除去、request全体の料金上限検証を行い、`{request,cost:{kind,model,upperBoundJpyMicro,pricingVersion,hardBoundVerified}}`を返す。値をユーザー/モデルからコピーしない。未確認上限はgateが拒否する。実料金/最大token/検索query数保証はまだ実装されていない。
- JSON requestを複製・正規化しSHA-256 fingerprintで予約に束縛する。同一operationIdに異なるrequestを使うと拒否。同じJSONのキー順変更は同一とする。任意のSDK object/credentialをrequestへ含めない。直接gateを使う既存呼出しは互換性のためfingerprint省略可能だが、新規外部callは本wrapperを使う。
- `dispatch(request,{signal})`は信頼するadapter。SDK/transportの自動retryと隠れた追加callを無効にする。単一の予約で複数の有料callを発行しない。provider使用量と検証済み換算根拠から`{value,actualJpyMicro}`を返し、生成文章を費用に使わない。無料扱いは確定使用量が0円のときのみ。
- 上限未検証、台帳不可、claim不可では送信なし。送信前abortは未発行予約をcancelできる。claim後のabort/timeout/不正費用/精算障害は保守的にunknownとして保持し自動再送なし。unknown書込も失敗した場合はdispatched状態のholdが残る。
- 成功は`{allowed:true,value}`、停止/不明は`{allowed:false,code,fallback}`。codeのみ返しprovider例外やrequest本文をログ・レスポンスへ出さない。既存予約拒否はreservationId/state/replayも保持する。予約入力競合を含む台帳例外は現段階でBUDGET_LEDGER_UNAVAILABLEへ集約する。非AI機能の継続情報は返すが、その機能自体の統合は未完了。
- 超過実額を精算したらCOST_OVERRUNを返し将来callを停止する。取消が送信中に起きても実額判明時は記録してからCALL_CANCELLEDを返す。claim後のプロセス終了はwrapperが回復できず、dispatched holdを運用確認する。

単体は既存会話2往復、予算停止、request変更、台帳障害、timeout、usage欠落、精算/unknown保存障害、abort、超過を検証。Firestore Emulatorでは送信中の別operation/同一operationを拒否しunknown holdを維持する。実サービス/実課金/実IAMの証跡ではない。

## Secret・料金運用

`validateAiRuntimeConfig`は承認モデル、数値version固定Secret参照、料金/為替とその根拠versionを検証。料金/為替を実装に固定しない。入力料金、output料金（thinking込み）、検索単価、保守的為替を公式資料と日付付きで運用設定へ与える。無料枠を上限保証へ使わない。検証は型/存在確認であり公式料金の真正性や最大呼出量を証明しない。

Secret Manager API取得の共通readerを実装（下記）。実Gemini/OAuth/runtimeへの接続は未完了。設定/ログにsecret値・token・生メールを置かない。runtime SAには必要なSecret/versionだけsecretAccessor。OAuth accountKey→Secret参照はサーバー管理、ブラウザから指定させない。参照一覧・最小IAM差分・料金根拠・匿名検証・rollbackを揃えて本番承認を求める。現状の台帳collectionはブラウザRulesで許可されずAdmin SDKのみ。

### 固定Secret reader（2026-10-06）

`createPinnedSecretReader({allowedReferences,credential?,fetchImpl?,timeoutMs?})`は固定数値versionのserver allowlistを受け取り、`read(reference,{signal?})`でBufferを返す。生成時にはnetwork accessなし。runtime接続後はFirebase AdminのADC credentialを利用。固定Google HTTPS endpointのGETだけを実行しredirect/retryを禁止。認証取得から応答取得まで既定10秒。SDKの認証取得自体を取り消せない場合でも期限後にSecret fetchへ進まない。

レスポンスのresource name完全一致、base64、非空/64KiB上限、CRC32Cを検証。不明・403・破損・timeoutはSECRET_UNAVAILABLEのみ返し、token/payload/provider例外のcauseを出さない。参照はproject IDまたはproject numberを利用可。Googleがproject IDをnumberに正規化すると完全一致検証で拒否するため、運用時に正規resource名を確認してallowlistへ固定する。自動的なproject対応付けをしない。取得したBufferは呼出adapter内だけで利用し返答/ログに含めない。

実Secretの作成/取得、API有効化、IAM変更は未実施。偽credential/transportと匿名payloadで正常/禁止参照/CRC/403/timeoutを検証。公式: [Access REST](https://docs.cloud.google.com/secret-manager/docs/reference/rest/v1/projects.secrets.versions/access)、[Data integrity](https://docs.cloud.google.com/secret-manager/docs/data-integrity)。

### 料金計算と予約生成（2026-10-06）

`calculateAiCostMicros(config,{inputTokens,outputTokens,searchQueries})`はBigIntで合計計算してmicro-JPY単位へ切り上げる。outputTokensはthinking等を含む全課金出力。料金/為替は設定入力であり生成文章や無料共有枠を利用しない。算式は `(inputTokens × inputUsdMicrosPerMillion + outputTokens × outputUsdMicrosPerMillion + searchQueries × searchUsdMicrosPerQuery × 1,000,000) × jpyMicrosPerUsd / 10^12` を切り上げ。負数/小数/欠落/安全整数超過は拒否する。

`createAiCostReservation(config,{maxInputTokens,maxOutputTokens,maxSearchQueries,tokenBoundEvidence,searchBoundEvidence?})`は検証済み上限の予約を生成。モデル仕様以上のtoken上限、token根拠欠落、検索ありでquery上限根拠欠落は拒否。料金/為替/上限/根拠を予約のpricingVersion hashへ含め、同じ表示versionでも値が変われば入力競合になる。

根拠文字列の存在は料金/最大呼出量の真正性を自動証明しない。信頼するadapterが入力全体（schema/Tool結果を含む）、thinkingを含む出力、candidate数、検索回数の実効上限を確認し、実requestへ強制する必要がある。そのadapterはまだ未実装。query上限が確認できない実Google Search callは無効のままにする。テスト上のsearchBoundEvidenceは匿名fixtureでありGoogle API保証の証拠ではない。

公式料金の2026-10-06読取り: Standard入力USD0.30/百万token、出力USD2.50/百万token（thinking含む）。Google Searchは共有無料枠後USD14/1000、各queryを課金。料金はコードへ固定せず本番設定時に再確認。テスト換算150円/USDはfixtureであり承認済み為替ではない。固定モデルの仕様上限は入力1,048,576/出力65,536token。出典: [料金](https://ai.google.dev/gemini-api/docs/pricing)、[検索の課金単位](https://ai.google.dev/gemini-api/docs/google-search)、[モデル仕様](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite)。

共通reader/料金計算/費用gateの結合は偽providerで検証済み。停止時はSecretを取得せず、実キー/有料callを使わない。

## 検証と再開

単体: `node --test test/ai-budget.test.mjs`。Emulator: `firebase emulators:exec --config ../firebase.json --project demo-portal --only firestore "node --test test/ai-budget-emulator.test.mjs"`。匿名fixtureのみ。並行予約、重複dispatch、unknown、月跨ぎ、解放、超過の停止を検証。provider実課金/実IAMの証跡ではない。

再開順: #9→実施計画書→#32→PR/CI→実環境。未完了はprovider全call箇所のgate統合、料金/検索上限保証、Secret/IAM実検証、縮退統合、本番承認。#32をcloseしない。

## Gemini送信とruntime構成の接続（2026-10-10）

`createBudgetedGeminiProvider({gate,config,readSecret,fetchImpl?,timeoutMs?})` を追加。固定Gemini Interactions endpointへ、費用予約/単一送信権の取得後にSecretを読み、POSTを1回だけ発行する。新規SDKなし、redirect/自動retryなし、stream/storeともfalse。

初期adapterは信頼するサーバーの `{input,systemInstruction?}` という文字列入力だけを扱う。model/料金/Secret/検索設定等の入力overrideを拒否。rawメールの個人情報除去、会話Toolのオーケストレーション、検索はこのadapterに含めない。ホスト側で必要最小限の購入情報へ投影し、住所/氏名/支払情報を送らない処理は#34/#38で接続する。

### 費用上限と使用量

- モデルの入力上限1,048,576token全量を保守的に予約する。文字数からtoken数を見積もらず、追加countTokens callもしない。requestのUTF-8 JSONは64KiBまで。
- Interactionsの `max_output_tokens=4096` を固定。これはthinkingも含む実効出力上限。thinking_levelはminimal。input/outputともtext限定、built-in tool/Agent/background/previous interactionは送信しない。
- 使用量のinput/output/thought/totalの整数・合計整合を検証し、output+thoughtを課金出力として精算。暗黙cacheは割引を仮定せず入力全量へ通常単価を適用するため、記録額は保守的換算でありprovider請求額の厳密な照合ではない。料金/為替は運用設定で渡し固定しない。
- input全量予約のため一時保留額は通常の質問実費より大きい。テスト料金/為替では約48.72円/呼出しを保留するが、正常な使用量で未使用分を解放する。この換算はfixtureであり本番為替の承認ではない。
- 使用量欠落、非text/工具/検索使用量、送信失敗、応答不明時はunknownとして予約維持。既知の不完全生成は費用を精算して `{status:'incomplete',text:null}` を返す。
- 信頼できる使用量からproviderのinput/output上限違反が観測された場合は `gate.blockForBoundViolation()` で以後のreserve/claimを停止し、実換算額をそのまま精算する。架空の超過課金を作らない。解除は運用確認/承認が必要。
- Secret取得から応答読取りまで既定20秒、最大30秒。応答は1MiBまで。Secret Bufferは使用後ゼロ化し、キーはheaderだけに使う。例外/本文/キーは返答・ログへ出さない。停止中はSecret取得なし。

### 起動構成

`createOptionalAiRuntime({db,env,credential?,fetchImpl?,clock?})` をindex.mjsで構成し、application.aiRuntimeへ保持する。既定はOFF（AI_DISABLED）。`AI_RUNTIME_ENABLED=true` と `AI_RUNTIME_CONFIG_JSON` をserver設定へ与えた場合のみ準備する。JSONはvalidateAiRuntimeConfigのmodel/数値version固定Secret/料金/為替/根拠設定。Secret値はJSONに入れない。
設定エラーはAI_CONFIGURATION_INVALIDと既存fallbackを返す。履歴/周期等の非AI API起動を妨げず、構成時にSecret/有料APIへアクセスしない。HTTP会話routeと既存会話loopのTool変換は#38で接続予定。現在の公開APIからこのadapterを呼び出す入口はまだない。

### 検証と実接続のINPUT

匿名Secret/偽HTTPの10試験を追加。固定transport、Secretなしの予算停止、入力override拒否、thinking/implicit cache換算、不完全生成精算、使用量不明hold/replay拒否、上限違反停止、deadline、APIエラー秘匿、runtime off/不正設定/Secret+gate結合を検証。実Firestoreの予約競合・停止試験も追加。

GCP読取りでSecret Manager APIは未有効（SERVICE_DISABLED）と確認した。Secret値は未取得。次の本番差分はAPI有効化、Gemini有料projectに紐づくキーの固定version Secret保管、専用runtimeへの対象SecretのみsecretAccessor、料金/為替設定、匿名有料疎通と会話route接続。各具体的差分/料金/rollbackを準備してから反映する。今回実キー・有料call・本番設定変更なし。#32はopen維持。

公式確認日2026-10-10:
- [Interactions API](https://ai.google.dev/gemini-api/docs/interactions-overview)
- [Thinkingのhard cutoff](https://ai.google.dev/gemini-api/docs/thinking)
- [固定モデルの入力上限](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite)
- [Interactions request/usage](https://ai.google.dev/api/interactions-api)

## 実環境の更新（2026-10-10）

上の未有効という記録の後、ユーザーのコマンド承認を受けてSecret Manager APIだけを有効化し、enabled状態を読み戻し確認した。Secret一覧は0件。キー登録、IAM変更、Gemini有料call、Cloud Run再デプロイは未実施。次のINPUTはGemini有料APIキーの準備と固定version Secretへの保管。最新commitの[CI](https://github.com/Motoki2601/portal/actions/runs/38043989796)はsuccess。
