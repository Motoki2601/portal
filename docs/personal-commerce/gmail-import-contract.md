# Gmail注文メール取込契約（Issue #13）

状態: ヨドバシ1系統の調査完了 / contract yodobashi-order-v1
検証日: 2026-10-05
要件正本: [requirements.md](requirements.md)
設計正本: [basic-design.md §4](basic-design.md)
匿名入力: [fixtures/yodobashi-order-v1.json](fixtures/yodobashi-order-v1.json)

## 1. 結論と検証範囲

接続済みGmailの実メールを読み、ヨドバシの注文確認5通＋同注文の出荷通知1通を検証した。注文番号、本文の注文日、商品名、数量、明細合計、通貨を取得できた。数量2の商品と複数行に折り返された商品名を含む。6通すべてISO-2022-JPを正しく復号し、注文日・商品ブロック・数量の対応を機械的に確認した。

同一注文の確認/出荷メールで注文番号が一致することを確認。Gmail上は別message IDであり、thread IDで注文を一意にすることはできない。取得結果をFirestoreへ登録する実装・同時実行の検証は#16以降。

Amazon注文確認1通のtext/plainには注文番号・商品・数量・金額があるが、本文の購入日の明記がなかった。受信日時で補完すると設計の「推測で事実を埋めない」方針に反するため、Amazonは今回の確定経路から外す。HTML/別メール/別入力から購入日を取得できるかは追加調査であり、Amazon全メールに日付がないという結論ではない。

実際の複数商品注文・分割発送・キャンセル・返品は未検証。キャンセル等の件名検索では0件だったが、対象事象がないと断定しない。合成fixtureにより複数行・欠損の契約を用意する。MVPの未対応形式はneeds_reviewで保持し、黙って商品を追加/削除しない。

## 2. 検索・取得

実行して対象メールを確認できた検索:

```text
from:thanks_gochuumon@yodobashi.com subject:"ご注文ありがとうございます" newer_than:180d
```

出荷通知候補:

```text
from:otodoke@yodobashi.com subject:"ご注文商品出荷のお知らせ"
```

運用は週次。初回は上記180日をdefaultにし、さらに古い履歴は別途backfill。継続は前回成功取得時刻から14日重ねて検索し、message IDで冪等化する。期間条件は内部受信時刻のepoch秒after/beforeで固定し、全pageTokenを追う。失敗sourceは期間外になっても再試行する。成功watermarkは全ページの取得成功後に更新し、未処理sourceはpending/failedで残す。mailbox設定への接続アカウント・watermarkの保存は#16で具体化する。

1. messages.list(q)でmessage ID取得。
2. messages.get(format=raw)。rawのbase64urlをbytesへ戻す。
3. RFC MIMEを解析しContent-Transfer-Encodingを解除、各partのcharsetに従いUnicode化。
4. text/plainがある場合はそれだけを採用。HTMLを重ねて明細を2回数えない。plainが無い場合はHTMLの注文セクションをテキスト化し、形式未検証ならneeds_review。
5. U+FFFDや復号エラーが残る場合はAIへ渡さずDECODE_ERROR。誤復号後の文字列をAIに補修させない。
6. 注文番号・注文日・注文商品ブロックだけを選択してAI構造化へ渡す。宛先氏名/住所/支払情報/個別注文URLを除外する。

今回full形式のコネクタ取得では、ヨドバシ本文がU+FFFDへ化けた。一方rawを標準MIME decoderで復号すると正しく読めた。これは観測した取得経路の挙動で、Gmail full API一般の不具合を示すものではない。

取得用OAuthはgmail.readonlyを想定。既存Firebase ID tokenだけでGmail API権限は得られず、アプリ用OAuth設定・同意・refresh tokenの保管が実装時に別途必要。今回の接続済みコネクタで読めたことをCloud Run側の認証構築済みと扱わない。送信権限は本調査では取得しない。

## 3. フィールド対応

| 入力根拠 | 出力 | 判定 |
|---|---|---|
| Gmail message ID | Source.messageId | 必須。RFC Message-IDやthread IDを代用しない |
| Gmail internalDate | Source.receivedAt | 必須。本文購入日とは別 |
| 接続設定内部UUID | accountKey / merchantAccountKey | メールアドレスを公開IDにしない |
| 送信元＋件名＋本文見出し | messageKind | orderとdispatchを区別。件名だけで確定しない |
| 【ご注文番号】 | externalOrderId | string。先頭0や記号を勝手に削除しない |
| ・ご注文日 YYYY年MM月DD日 | orderedOn | ISO date、dateTimezone=Asia/Tokyo |
| 【ご注文商品】内の・「…」 | rawProductName | 閉じ括弧まで複数行を連結。原文とsourceLineRefで根拠追跡 |
| 商品に続く「合計 N 点 金額 円」 | quantity / amountMinor / currency | 数量N、金額は明細合計、JPY。quantity=2でも金額を再度2倍しない |
| 【ご注文金額】今回のお買い物合計金額 | totalMinor / currency | 任意。ポイント支払分を商品価格から引かない |
| 商品名中の容量/包装/型番 | Product属性候補 | AIが根拠ありの値だけ抽出。JANやSKUがない場合は未取得 |

注文日/商品名は必須。注文番号が不明ならprovisional/needs_review、周期対象外。購入日が不明ならPurchaseOrderを作らずSourceのみneeds_review。商品名のない明細もneeds_review。数量/明細金額はnull許容、金額非nullならcurrency必須。注文合計だけを明細価格へ配賦しない。

支払額、ポイント数、配送料を商品金額に混同しない。複数商品で商品と数量行の対応が一意でない場合、保存せずneeds_reviewとする。AIは機械検証を通る構造のみ提出する。

sourceOrderRef="plain:order:0"、sourceLineRef="plain:order:0:item:N"（Nは0始まり）。HTML fallbackではhtml:order:0:item:N。同一raw/抽出版では同じ根拠区切りと順序を維持。sourceOrderRef/sourceLineRefの生成はAI任せにしない。reprocessでpartや行順が変わる場合、既存line照合が曖昧ならneeds_reviewにして二重登録しない。

## 4. 登録・状態更新の契約

正常orderはbasic-design §4.7のingest_order_sourceへ渡す。注文行はstatus=orderedで保存する。ここでorderedは注文を受け付けたという事実であり、決済/出荷/法的契約成立の保証ではない。

- source ID = SHA-256(["v1","gmail",accountKey,messageId])。
- 注文 ID/予約 = SHA-256(["v1","order","yodobashi",merchantAccountKey,externalOrderId])。
- 外部明細IDなしの初回明細はUUID。再処理はsource＋sourceLineRefで照合。
- orderとdispatchの同注文は1件。dispatchはsourceを追加してorderIdsでリンクし、購入行/購入機会は増やさない。
- dispatchが先に到着した場合、Sourceをneeds_reviewにして注文確認を待つ。出荷商品が注文全体とは限らないので、出荷メールだけから注文を新規作成しない。
- キャンセル/返品は新規購入ではなく既存注文/明細への変更。今回の実形式は未検証のため、自動更新を有効にせずSourceをneeds_reviewで残す。定型注意書きの「キャンセル」という単語だけでは判定しない。
- 注文全体の取消が根拠付きで検証できればorder/全lineのstatusを更新し周期を再計算する。部分対象が曖昧なら自動更新しない。
- 商品同一性はユーザー固定→強いidentifier→属性一致→AI。本文に外部SKUがないため、SKUを捏造しない。名称から根拠付きで商品属性を抽出できない場合はproductId=nullで保存可能。
- 重要更新は監査を残す。ユーザー訂正overrideを取込で消さない。予約/書込/監査のtransactionは#16で実装する。

**API補足**: §4.7のorders[]は正常order用。dispatch/cancel/returnではorders=[]とし、別のoptional `relatedExternalOrderIds:string[]`（messageKind!=order時）で関連注文を示す。Applicationがmerchant/account scope内で既存注文を解決する。注文日欠損や未照合sourceの保管用に、orders=[]、warnings/reviewReasonを許容する。イベント通知の欠損orderedOnを必須注文日として偽造しない。MVPはdispatchのリンクのみ自動対応、cancel/returnは確認待ち。

## 5. 匿名fixtureと確認結果

fixtureの注文番号、商品名、金額、日付、message IDはすべて新しい合成値。実メールの氏名/住所/個別リンク/ID/実値由来hashを公開しない。実メールのフォーマット上の特徴だけを再現する。

- case A: 単一商品、quantity=2、amountMinor=900（単価ではない）。
- case B: Aと同注文の出荷通知、別message ID。注文数/明細数不変。
- case C: 複数商品・折返し商品名（複数商品は合成のみ）。
- case D: 本文注文日欠損。Sourceのみneeds_review。
- case E: 繰返しの数量/価格が欠損。nullを維持。

実データについては5注文＋1発送のMIME復号/注文日/商品ブロック/数量を確認した。匿名fixture JSON構文・行対応・quantity=2時の合計値を検証。AI providerによる抽出精度、Firestore保存/競合、週次処理は未実施。

## 6. 残る実装と追加調査

#13の「1系統の変換項目・重複キー・匿名fixture」の完了条件は満たした。最初の実装はヨドバシorder/dispatchに限定する。

#16へ: アプリ側Gmail OAuth、raw MIME復号、AI構造化＋型/根拠検証、Firestore限定書込み。今回ユーザーの追加入力は不要。

追加検証: 実際の複数商品/分割発送/キャンセル/返品、Amazonの本文購入日を取得する経路。これらは未対応形式を自動計上しない運用で切り分ける。実データが必要になった時点で確認する。

公式仕様:
- [Message/raw/internalDate](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages)
- [messages.get / OAuth scope](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get)
- [messages.list / q / pagination](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list)
