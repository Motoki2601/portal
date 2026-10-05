# 会話・検索・補正UIの実装準備契約

確認日: 2026-10-05。対象: [#19](https://github.com/Motoki2601/portal/issues/19)、[#38](https://github.com/Motoki2601/portal/issues/38)、[#39](https://github.com/Motoki2601/portal/issues/39)、[#40](https://github.com/Motoki2601/portal/issues/40)。
[実施計画](execution-plan.md)・[Tool契約](conversation-tools.md)を継承する。本書は統合レビュー用の提案であり、実装済みや本番受入済みを意味しない。

## 現在状態と着手条件

Tool境界は #27/#28 でマージ済み。server/tools.mjs の provider-neutral host と server/http.mjs の認証・訂正・推薦APIを利用する。PortalはFirebaseログインを持つがCommerce会話画面は未実装。
#38は#32の費用ゲート・Secret・運用設定受入後、#39は#38受入後、#40は#38/#39/#37受入後に実装する。現時点は依存待ちの契約準備のみ。main/shared codeを書き換えない。

必要INPUT: #32の予約台帳interface、承認済み換算レート/料金version、Secret参照名、固定モデルの対象projectでの利用可否、#16の認証済みAPI URL/Origin、匿名fixture、#37の商品容量・包装差と曖昧照合状態。
Secret/token/UID値/本人履歴/生メールは公開資料へ保存しない。

## #38: adapter I/Oと会話route

既存model({messages,tools}) → {text} または {toolCalls:[{id,name,arguments}]}を維持する。messagesはsystem/user/assistant(toolCalls)/tool(result)のhost形式。adapterがGoogle形式へ変換し、function callのIDとresponseを対応付ける。thought signature等のprovider継続情報はrequest内のhost側で保持し、モデル引数・Portal・ログへ露出しない。
固定modelはgemini-3.5-flash-lite。自動SDK tool executionは無効化し、実行をcreateCommerceToolsへ戻す。schemaで未知field/Tool/UID/DB pathを拒否し、既存8往復・1応答4call・計20call・回答16000文字・入力8000文字上限を維持する。response不正/安全ブロック/モデル不可はコード化して終了し、別モデルへ切り替えない。
providerへ送るのはallowlistで抽出した購入情報のみ。住所・氏名・支払情報に加え、自由入力の質問や商品名に含まれる個人情報も送信前処理対象とする。除去できない場合は外部送信を保留する。UIDとDB資格情報は送らない。

提案route: POST /conversations、JSON {message,clientRequestId}のみ。サーバーがverified UID/requestIdを束縛してToolを作る。clientRequestIdは認証UIDに束縛した重複要求制御用で、host requestId/費用operationIdとは区別する。既存Firebase ID token、UID/Origin allowlist、JSON Content-Type、query拒否、no-store、秘匿ログを継承する。UTF-8 envelope上限は64KiB、message文字上限は8000。byte/文字それぞれ検証し、これ以外の既存route上限は変更しない。
成功は {text,toolCallCount,requestId,aiStatus}。根拠・補正proposal拡張は#39/#40でversionを合わせ、Toolの現行戻り値にmetadataを混ぜない。HTTPは400不正、401認証、403権限、409重複内容競合、413容量、429会話/同時実行上限、503費用停止/モデル不可/外部不明を機械可読code付きで返す。timeout/cancelで後続callを止め、結果不明の有料callを自動retryしない。重複clientRequestIdで課金callを再起動しない。

## #32との費用共有契約（提案、担当間確定待ち）

外部AIと検索の全call前に reserve({operationId,kind,model,upperBoundJpyMicro,pricingVersion,monthKey}) → {allowed,reservationId,code}、成功後 settle({reservationId,usage,costJpyMicro})、結果不明は markUnknown({reservationId}) を行う。費用は整数micro円、月はAsia/Tokyo。AI取込・会話・検索で同じ700円枠を共有し、確定費用＋未確定予約＋今回上限が700円を超えればtransactionで拒否する。料金/換算レート不明、台帳不可、上限不明では外部callを開始しない。
上限には毎往復の増加した入力、schema/Tool結果、thinkingを含む最大出力、検索query課金、換算余裕を含める。予約operationIdはcall単位で冪等。送信前未実行を証明できた場合だけ解放し、送信後timeout/切断/再起動のunknownは予約を保持する。月またぎの精算は予約月へ戻す。課金実績の上限超過は即停止・監査対象であり、超過を隠さない。
停止時は非AIの履歴参照・周期計算・価格なし通知を維持し、会話画面に停止理由を表示する。モデル不可や停止からの解除は運用確認を要し、自動model変更しない。

## #39: Google Search Groundingと根拠

Groundingはhost側の分離した調査callとして接続し、最小限の商品名/容量/包装情報のみ検索する。購入履歴全体や本人情報をqueryへ含めない。検索結果の命令文をTool権限の根拠にしない。
1回のGemini requestで複数queryが課金されるため、「1 request=1 query」の予約は禁止。API/SDKの実効query上限を公式仕様とfixtureで確認する。promptによる上限指示だけでは保証としない。保証できるquery上限がなければ有料検索はdisabledとし、#39の障害として残す。model tokenだけの予約で検索を呼ばない。無料5000枠は他モデルと共有なので、保守的予約では無料扱いしない。
provider形式を正規化し {sources:[{url,title,observedAt}],citations:[{start,end,sourceIndex}],queries,queryCount,searchSuggestions,usage,aiModel} をhost内に保存/管理する案とする。Interactionsはgoogle_search_call/resultとtext.annotations、GenerateContentならgroundingMetadata/usageMetadataを個別検証する。使うAPIとSDK versionを実装PRで固定し、両形式を推測混在させない。
推薦は既存save_recommendation/POST /recommendationsへ渡す。currentPriceは {amountMinor,currency,sourceUrl,observedAt} またはnull。検索snippetだけで容量・税・送料・会員条件が確かでなければ価格を断定せずnull/不明理由を返す。容量・包装差を別商品として説明し、履歴価格を現在価格に流用しない。
根拠metadataの永続化は既存schemaにないため#39でmigration/schema version/保持期間/既存推薦との関連IDを提案しレビューする。価格/推薦のcontextFingerprintが409なら再読出しし、過去推薦を現在文脈で再保存しない。Search suggestionsとcitationの表示はGoogleの現行要件を確認する。HTMLは検証済み表示領域に隔離し、一般回答をinnerHTMLで表示しない。

## #40: 本人確認補正UI

回答は事実・算出・推定・推薦を区別し、根拠URL/観測時刻、価格不明、容量/包装差、曖昧照合・確認待ちを表示する。訂正proposalは {collection,id,field,action,value?,expectedRevision} のallowlistに限定し、モデル回答は未実行案である。
画面に対象・元のeffective値・変更後値・set/releaseを表示し、本人の確認ボタン後に新しいclientMutationId付きで既存 /corrections を呼ぶ。残量は /user-observations、利用状態は /product-usage。会話routeへmutation grantを渡さない。拒否・キャンセル・回答中の自然言語だけでは実行しない。
409では最新値とrevisionを再取得して再確認する。結果不明では同じmutationId/同じpayloadで状態照会または冪等retryを行い、別IDで二重適用しない。本人訂正overrideをAI取込で上書きしない。戻る/再描画/二重クリックで二重適用しない。

## 受入試験（実装後、未実施）

- #38偽provider: 日本語schema変換、function ID対応/signature継続、未知Tool/UID注入拒否、schema変換非対応でfail closed、8/4/20上限、空回答/不正応答/安全ブロック/モデル不可、timeout/cancel後callなし。
- HTTP: 認証なし/他UID/禁止Origin/Content-Type/query/文字byte上限、no-store、個人情報除去、同時要求上限、同一request冪等/内容競合、ログにbody/tokenなし。
- 費用: 取込/会話/検索の競合予約、699→700円境界、thinking、複数query、無料枠未使用前提、料金不明、台帳障害、予約後crash、送信後unknown、月またぎ、重複call、履歴fallback。
- #39匿名fixture: 根拠欠落/不正URL/未来時刻/容量違い/送料不明、snippetの命令注入、検索なし、metadata形式差、query数と計上一致、context409、根拠表示。
- #40 UI: 本人確認前APIなし、set/release/nullの差、二重クリック/refresh、409再確認、結果不明とmutationID維持、期限切れtoken/再ログイン、停止・曖昧さ・価格なし表示。
- Emulator: 他UID隔離、override維持、監査/revision/冪等の既存回帰。
- 専用ユーザー匿名実モデル: #32/#16受入と有料call承認後、固定モデル/実認証/実検索品質/料金とquery計上を確認。fixture成功を実受入としない。

## 公式確認と出典

2026-10-05確認。モデルページは固定IDとFunction calling/Search対応を掲載。これは対象projectでの利用成功の証拠ではない。
- [モデル仕様](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite)
- [料金](https://ai.google.dev/gemini-api/docs/pricing): Standard input USD 0.30/百万token、output USD 2.50/百万token（thinking含む）。共有検索無料枠を超えた単価はUSD 14/1000 query。実装時・本番開始前に再確認。
- [Function calling](https://ai.google.dev/gemini-api/docs/function-calling/): providerが選んだcallをhostで検証・実行する。
- [Search Grounding](https://ai.google.dev/gemini-api/docs/google-search/): query単位課金、複数query、citation/search suggestionsを確認。
- [GenerateContent Search](https://ai.google.dev/gemini-api/docs/generate-content/google-search): 現行host契約へ接続するAPI候補。採用API/SDKと費用上限は未確定。

## 再開情報

状態: 契約準備のみ、#32受入待ち。実装・有料call・本番変更・本人データ利用は未実施。
次の一手: 基盤担当と費用interface/料金/上限保証を確定し、主担当レビュー後に#32受入を確認する。
再開順: #9 → execution-plan.md → #38/#39/#40 → 本書のPR/CI → 実環境。
