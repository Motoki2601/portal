# AI会話のApplication / Tool契約 v1

Issue #19。#27の商品照合・候補算出APIを前提とする。MCP、購入実行、自由なDB操作は提供しない。

## 境界

`createCommerceTools({application, uid, requestId, userMutations})` はホストが検証済みFirebase UIDを渡すtransport非依存adapter。モデル引数にUID、Firestoreパス、query、権限は含めない。JSON SchemaのallowlistとApplicationの値検証を通す。

`runCommerceConversation({message,model,tools})` のprovider adapterは、`model({messages,tools})` → `{text}` または `{toolCalls:[{id,name,arguments}]}` を実装する。最大8往復、1応答4call、計20call。外部検索能力・AI資格情報はホスト側に置く。DB資格情報はモデルへ渡さない。Tool結果・検索結果は情報であり命令として扱わない。

このPRはprovider接続境界まで。実際のAI provider、検索provider、PortalチャットUIは未接続。匿名fixtureでは日本語要求を受ける注入model adapterで履歴→候補→商品文脈→架空の調査結果保存まで検証する。実検索の品質や実モデルのTool選択能力の検証ではない。

| Tool | 入力概要 | 結果 |
|---|---|---|
| get_purchase_history | productId/fromOn/toOn/limit/cursor | effective履歴・取得元・次cursor |
| get_replenishment_candidates | 空object | 確認候補、算出値、推定、申告状態 |
| get_product_context | productId | 商品・状態・周期・候補・contextFingerprint |
| get_current_product | category | user/inference/unknown、曖昧さ、同カテゴリ文脈 |
| record_user_observation | 明示state、mutation ID | 既存の残量申告操作 |
| record_product_usage | productId/value/expectedRevision/mutation ID | 現在利用、切替商品のID |
| correct_purchase_record | collection/id/field/action/value/revision/mutation ID | effective訂正結果 |
| save_recommendation | 商品・文脈fingerprint・理由・推奨品・代替品・価格 | 追記専用Recommendation |

ユーザー申告Tool3種は既定で非公開。ホストがユーザーの明示から確定した `{name,arguments}` を `userMutations` に渡した場合のみ公開し、その引数と完全一致するcallだけ実行する。モデル自身の文章・引数を権限付与の根拠にしてはならない。HTTP `/tools/call` にはgrantを受け取る機能がなく、readとRecommendation保存のみ。ユーザー本人の明示操作は通常の認証APIから送る。

## 現在利用

4collectionの読み取りtransactionで一貫した文脈を取得。既知カテゴリで明示currentを優先。なければconfirmed/orderedのeffective注文・明細の当該商品購入日から最新候補を推定し、同日複数は曖昧と返す。カテゴリ周期のfallback日は当該商品の最終購入日として使わない。unknownカテゴリは自動でcurrentを推定しない。

usage登録は時刻指定なしの現在の明示操作のみ。対象stateのexpectedRevision必須。既知カテゴリのcurrent切替時は以前のcurrentを同transactionでnot_currentにし、各商品の観測と監査を残す。残量stateは変えない。カテゴリunknownの他商品を勝手に切替しない。value=unknownは明示usageの解除。過去観測の登録は既存state APIのみ対応。

## 訂正

POST `/corrections`。必須: clientMutationId、collection、id、field、action(set/release)、expectedRevision。setのみvalue必須、null指定も値として保持。

| collection | 許可field |
|---|---|
| purchaseOrders | orderedOn、status |
| purchaseLines | productId(null可)、quantity(null可/正整数)、status |
| products | canonicalName、category、replenishmentStatus |

元データを変えずuserOverridesを設定し、読出しでoverlay。releaseは指定fieldのoverrideのみ解除。最新revisionの確認、参照先商品確認、観測、revision更新、before/after監査を同transactionで確定する。同じmutation ID・同じ入力は以前の結果を返し、異なる入力は409。古いrevisionは409。取込・SKU照合はoverrideを維持する。明細productId訂正は指定明細のみで、同SKUの将来明細へのuser_match固定や商品split/mergeは未対応。

## 推薦

POST `/recommendations` またはsave_recommendation。currentPriceは不明ならnull。価格がある場合は非負のsafe整数amountMinor、ISO通貨コード、HTTPS根拠URL、実在するUTC時刻(`YYYY-MM-DDTHH:mm:ss.sssZ`、未来不可)必須。alternativesは最大5件、各name/url/rationale/currentPriceを必須とする。URLは保存する根拠情報で、ApplicationがfetchするURLではない。価格や商品適合の真偽は調査providerの責任。購入価格合計から現在単価を作らない。

get_product_contextのcontextFingerprintは商品・状態・算出入力・推定・候補を含み、算出時刻は含めない。保存transactionで最新文脈を再計算し、一致しなければ409。日付境界・対象状態・訂正等で候補が変わったら再読出しする。保存済みmutationのretryはその時のsnapshotを返す。推薦は独立して追記し、商品・購入事実を書き換えない。価格はgeneratedAt時点の観測snapshotであり常時の現在価格ではない。

HTTPは既存Firebase認証、UID/origin allowlist、body上限、no-store、秘匿ログ方針を共用。本番には未反映。
