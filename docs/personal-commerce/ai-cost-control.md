# AI・検索費用の停止契約（#32）

## 範囲と残作業

非本番の台帳・設定検証と共通provider呼出境界を提供する。実Gemini/検索adapter接続、Secret取得、取込保留、価格なし通知の本体は未完了。本番のSecret/IAM/課金設定を変更しない。#17のBilling/Budgetは再実装しない。2026-10-05に#17記録を確認。ロードマップ#9にはその後の実Billing/Budget確認・紐付け完了記録がある。Budget Alertは通知であり支出上限ではない。

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

Secret Manager APIの取得は後続adapter。設定/ログにsecret値・token・生メールを置かない。runtime SAには必要なSecret/versionだけsecretAccessor。OAuth accountKey→Secret参照はサーバー管理、ブラウザから指定させない。参照一覧・最小IAM差分・料金根拠・匿名検証・rollbackを揃えて本番承認を求める。現状の台帳collectionはブラウザRulesで許可されずAdmin SDKのみ。

## 検証と再開

単体: `node --test test/ai-budget.test.mjs`。Emulator: `firebase emulators:exec --config ../firebase.json --project demo-portal --only firestore "node --test test/ai-budget-emulator.test.mjs"`。匿名fixtureのみ。並行予約、重複dispatch、unknown、月跨ぎ、解放、超過の停止を検証。provider実課金/実IAMの証跡ではない。

再開順: #9→実施計画書→#32→PR/CI→実環境。未完了はprovider全call箇所のgate統合、料金/検索上限保証、Secret/IAM実検証、縮退統合、本番承認。#32をcloseしない。
