# AI・検索費用の停止契約（#32）

## 範囲と残作業

非本番の台帳・設定検証を提供する。provider接続、Secret取得、取込保留、価格なし通知の本体は後続Issue。本番のSecret/IAM/課金設定を変更しない。#17のBilling/Budgetは再実装しない。2026-10-05に#17記録を確認、実環境確認は資格情報待ち。Budget Alertは通知であり支出上限ではない。

## 共有interface

`createAiBudgetGate(db, {scope, clock, limitMicros})`。既定scopeは全AI/検索を共有するpersonal-commerce、700,000,000 micro-JPY（700円）。uid別に分割しない。JST月はホストclockから決める。

1. `reserve({operationId,kind,model,upperBoundJpyMicro,pricingVersion,hardBoundVerified})`。kindはai/search、modelは固定gemini-3.5-flash-lite。整数micro-JPY。operationIdはサーバーで導出し同じ論理処理の再開で維持。全費用（thinking・tool round・検索を含む）にadapterが保証する最大額を予約。見積りやprompt指示を最大額保証にしない。保証不能・料金/為替未設定では外部callを拒否する。
2. `claimDispatch(reservationId)`がtrueを返した担当だけ一度外部callを発行。reserveのallowed/replayだけでは発行しない。claim後にプロセス終了した場合も発行権を復活しない。
3. `settle(id, actualJpyMicro)`で実額確定。成功・失敗で課金額が確定した場合に利用。結果/課金不明は`markUnknown(id)`、予約を維持し自動再送しない。送信前の予約のみ`cancel(id)`で解放。unknown後に課金が確定したらsettle可。
4. 予約超過の確定も隠さず記録し、全月の新規予約を停止。原因・料金上限を再検証した後の運用者による解除は別途レビュー/承認。既存実費は取り消せない。

同じoperationIdの変更入力はconflict。月を跨いだdispatched/unknownの再開も元の月へ確定し再発行しない。旧月の未発行reservedはclaimを拒否する。旧予約をcancelし、新IDで新月へ予約してから発行する。未確定予約をTTLで消さない。設定上限は700円超を拒否する。外部callの課金月はprovider側の記録と照合が必要であり、月境界をまたぐ既発行callの実請求日を本台帳だけで保証しない。

拒否は`{allowed:false,code,fallback:{deferImports:true,history:true,replenishment:true,notificationPrice:false}}`。後続担当はこの決定情報を受けて取込保留、履歴・周期継続、価格なし通知を実装・検証する。現在この機能の統合は未実装。

## Secret・料金運用

`validateAiRuntimeConfig`は承認モデル、数値version固定Secret参照、料金/為替とその根拠versionを検証。料金/為替を実装に固定しない。入力料金、output料金（thinking込み）、検索単価、保守的為替を公式資料と日付付きで運用設定へ与える。無料枠を上限保証へ使わない。検証は型/存在確認であり公式料金の真正性や最大呼出量を証明しない。

Secret Manager APIの取得は後続adapter。設定/ログにsecret値・token・生メールを置かない。runtime SAには必要なSecret/versionだけsecretAccessor。OAuth accountKey→Secret参照はサーバー管理、ブラウザから指定させない。参照一覧・最小IAM差分・料金根拠・匿名検証・rollbackを揃えて本番承認を求める。現状の台帳collectionはブラウザRulesで許可されずAdmin SDKのみ。

## 検証と再開

単体: `node --test test/ai-budget.test.mjs`。Emulator: `firebase emulators:exec --config ../firebase.json --project demo-portal --only firestore "node --test test/ai-budget-emulator.test.mjs"`。匿名fixtureのみ。並行予約、重複dispatch、unknown、月跨ぎ、解放、超過の停止を検証。provider実課金/実IAMの証跡ではない。

再開順: #9→実施計画書→#32→PR/CI→実環境。未完了はprovider全call箇所のgate統合、料金/検索上限保証、Secret/IAM実検証、縮退統合、本番承認。#32をcloseしない。
