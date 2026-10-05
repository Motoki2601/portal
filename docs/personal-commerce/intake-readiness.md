# メール取込・商品整理の着手準備

確認日: 2026-10-05。対象: [#33](https://github.com/Motoki2601/portal/issues/33)〜[#37](https://github.com/Motoki2601/portal/issues/37)。
入口: [#9](https://github.com/Motoki2601/portal/issues/9) / [実施計画](execution-plan.md)。
本書は既存契約に基づく実装前の共有案。要件・契約の追加や変更を確定しない。#32未受入のため#33以降の実装は未開始。

## 正本と既存実装との差分

- [Gmail契約](gmail-import-contract.md)と[基本設計 §4.7](basic-design.md)の ingest_order_source を継承。現serverにはGmail OAuth、raw MIME decoder、匿名化、Gmail注文保存の実装がない。
- [amazon-csv.mjs](../../server/amazon-csv.mjs)は注文予約、試行fingerprint、Source、注文・明細・監査のtransactionを実装済み。Gmail保存にそのままCSV proposalを流用しない。Gmail/CSVで同じmerchantAccountKeyと注文予約を使い、CSV既存明細との対応が曖昧なら確認待ちにする。
- [replenishment.mjs](../../server/replenishment.mjs)にはmerchantSkuによる強い照合と周期計算がある。商品属性・カテゴリ抽出、容量/包装を使う安全な照合、AI照合は未実装。SKUを持たないメールの名称だけで既存商品へ統合しない。
- [application.mjs](../../server/application.mjs)のeffective overlay、本人訂正、revision・監査を維持。既存訂正を取込で削除しない。

## 着手に必要なINPUT

| Issue | INPUT・着手条件 | 担当成果物 |
|---|---|---|
| #33 OAuth | #32受入、アプリOAuth client、redirect URI、verified UID、tokenのSecret保管/最小アクセス契約 | 接続・解除・再認証API、接続状態、偽provider/匿名専用ユーザー検証 |
| #34 取得・匿名化 | #33受入、内部accountKey、取得adapter、保存先/水位/再試行契約 | 全ページ取得、raw復号、最小注文ブロック、pending/failed再開 |
| #35 ヨドバシ | #34/#16受入、匿名入力、費用gate、型/根拠validator、Firestore transaction | order保存、dispatch関連付け、review/監査 |
| #36 Amazon | #34/#16受入、物品注文確認validator、受信日ルール、CSVとの同account対応 | 同じ履歴への冪等保存、訂正維持、日付根拠 |
| #37 商品整理 | #35/#36受入、既存SKU/override/周期契約 | 属性・カテゴリ・安全照合、曖昧review、周期接続 |

OAuth取得scopeは既存契約のgmail.readonly。送信scopeは#42で別同意。Firebase ID tokenとGmail tokenは分離する。state/PKCEとUIDの束縛は#33の受入条件。Secret名・保存方式・runtime SA権限は#32と主担当が確定し、資格情報はIssue/PR/ログに記載しない。

## 共有インターフェース案（主担当・#32レビュー待ち）

1. ホストがverified UIDを束縛し、接続内部UUID accountKeyからGmail資格情報を解決する。公開レスポンスは接続状態のみ、refresh tokenはSecret経路のみ。AIやブラウザへ渡さない。
2. 取得adapterは固定したepoch秒のafter/before窓とpageTokenで全ページを取得し、message ID/internalDate/raw bytesを復号境界へ渡す。初回180日、継続は前回成功水位から14日重複。全ページ取得完了まで水位を更新しない。Source保存失敗を取りこぼさない再開境界は#34でtransaction/再取得により検証する。
3. MIMEはbase64url→transfer encoding→part charset→Unicode。plain優先、HTML重複計上なし。復号エラー/U+FFFDはDECODE_ERRORでAIを呼ばない。注文区切り/明細根拠refはAI前に生成。氏名/住所/支払情報/個別URLを除き、注文番号・注文日・商品ブロックだけを抽出する。
4. AI呼出し前に#32の費用gateで月次費用を予約し、実績を確定する。停止時は未処理Sourceを保留。取得水位とAI処理成功を分離し、期間外のpending/failedも再試行対象にする。基盤担当との接続案: reserve({operationId,kind,model,upperBoundJpyMicro,pricingVersion,hardBoundVerified})→allowed/reservationId/code/fallback。claimDispatch(id)の原子的な発行権獲得後だけ外部呼出しを行い、settle/markUnknownで結果を確定。cancelは未dispatchのみ。停止fallbackは{deferImports:true,history:true,replenishment:true,notificationPrice:false}。このinterfaceは#32の受入と主担当レビュー待ち。Secret参照は数値version固定とし、参照検証と実token管理のownershipを分離する。
5. 匿名入力→AI proposal→型/根拠検証→ingest_order_source。入力/出力は基本設計 §4.7の既存形。dispatchはorders=[]とrelatedExternalOrderIds、未対応cancel/return・日付欠損はSourceだけneeds_review。Amazon本文日付なしはinternalDateをJST日付へ変換しrule originを記録する。
6. Source IDはSHA-256(["v1","gmail",accountKey,messageId])、注文予約はSHA-256(["v1","order",merchant,merchantAccountKey,externalOrderId])。Source/注文予約/注文・明細/監査を同transactionで更新。再処理はsourceLineRef、一意なidentifier/容量/包装の既存行のみ照合し、曖昧な場合に追加行を作らない。外部AIはtransaction内で呼ばない。
7. 商品整理は本人固定→強いidentifier→完全な属性一致→根拠付きAI。未知容量/包装を一致扱いせず、曖昧ならproductId=null。訂正/属性/category変更の影響商品は既存周期計算へ接続する。

## 匿名fixtureと受入検証計画

既存[yodobashi-order-v1.json](fixtures/yodobashi-order-v1.json)を使い、実ID・実値由来hash・生メールを追加しない。追加fixtureは合成値だけで作る。

| 境界 | 確認する失敗・再開と期待結果 |
|---|---|
| OAuth | state/UID不一致拒否、refresh失効→再認証、解除後取得拒否、継続運用。token非露出 |
| 取得 | 2ページ以上、14日重複、取得途中失敗、同時起動、水位前の保存失敗、期間外failed再試行。未取得を取りこぼさない |
| MIME・除去 | ISO-2022-JP、transfer encoding、plain+HTML、HTML fallback、壊れたcharset。復号不能/PII残存入力をAIへ送らない |
| 保存 | 数量2・明細合計900、order+dispatch/逆順、同message再試行、並列同注文、欠損日/未知形式。重複行なし、review保持 |
| Amazon/CSV | JST日付境界、本文日付優先、受信日rule origin、同account予約、同ASIN複数行/日付・数量競合。曖昧対応はreview |
| 商品・費用 | 容量/包装違い、属性不足、identifier競合、productId=nullの本人訂正、予算停止・途中失敗。訂正維持、保留、既存履歴/周期継続 |

単体・偽provider→Firestore Emulator→専用ユーザー/匿名実サービスの順に検証する。fixture成功を実OAuth/IAM/抽出精度の受入として扱わない。Amazon・ヨドバシ双方の受入と本番承認後に自動取込を開始する。

## 再開情報

現在状態: 契約・INPUT準備のみ。#32/#33/#34/#16等は未受入。実装・本人Gmail接続・取込・送信・本番変更なし。
次の一手: 主担当/#32担当がSecret・費用gateと共有案をレビューし、#32受入後に#33のINPUTを確認する。
branch: codex/mvp-intake-readiness。PR・CIの最新状況は#33で確認。本書の静的契約照合とUTF-8読み戻しを行う。実サービス検証は未実施。
