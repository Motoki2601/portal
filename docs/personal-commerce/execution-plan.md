# Personal Commerce MVP 実施計画

確定日: 2026-10-05。期日は未指定。全体入口: [#9](https://github.com/Motoki2601/portal/issues/9)。

## 正本と管理責任

- 要件・契約: [要件定義](requirements.md)、[基本設計](basic-design.md)、[Gmail取込契約](gmail-import-contract.md)、[Amazon CSV契約](amazon-csv-import-contract.md)、[会話Tool契約](conversation-tools.md)。本計画は既存契約を置換しない。
- 実施順序と確定方針: 本書。
- 進捗・検証結果・残作業: 各Issue。表の状態は確定時の記録で、最新状態は各Issueを読む。
- 全体入口: #9。親Issueなので単一マイルストーンへ所属させない。

## 管理反映と実装開始の順序

既存マイルストーン確認→Issue整理→本書保存→全リンク・所属・IPO・受入条件・再開情報の読み戻し検証→#16本番準備から開始。
既存マイルストーンは2026-10-05に全stateを確認し0件だったためM1〜M5を新規作成。期日なし。履歴削除なし。
Issueは「目的、INPUT、Process、Output、受入条件、検証、依存関係／対象外、承認事項、再開情報」を揃える。

## マイルストーン

| マイルストーン | 所属Issue | 完了条件 |
|---|---|---|
| [M1：本番API・実行基盤](https://github.com/Motoki2601/portal/milestone/1) | [#16](https://github.com/Motoki2601/portal/issues/16)、[#32](https://github.com/Motoki2601/portal/issues/32) | 実Firebase認証でAPIが使え、Rules・IAM・予算制御を検証済み |
| [M2：Amazon・ヨドバシ注文取込](https://github.com/Motoki2601/portal/milestone/2) | [#33](https://github.com/Motoki2601/portal/issues/33)、[#34](https://github.com/Motoki2601/portal/issues/34)、[#35](https://github.com/Motoki2601/portal/issues/35)、[#36](https://github.com/Motoki2601/portal/issues/36)、[#37](https://github.com/Motoki2601/portal/issues/37) | 両ECを同じ購入履歴へ重複なく取り込み、補充計算につながる |
| [M3：AI会話・価格・補正](https://github.com/Motoki2601/portal/milestone/3) | [#19](https://github.com/Motoki2601/portal/issues/19)、[#38](https://github.com/Motoki2601/portal/issues/38)、[#39](https://github.com/Motoki2601/portal/issues/39)、[#40](https://github.com/Motoki2601/portal/issues/40) | 履歴問い合わせ、価格・代替提案、本人補正が成立 |
| [M4：週次取込・Gmailレポート](https://github.com/Motoki2601/portal/milestone/4) | [#41](https://github.com/Motoki2601/portal/issues/41)、[#42](https://github.com/Motoki2601/portal/issues/42) | 日曜9時に実行し、候補がある場合だけ通知できる |
| [M5：本人運用・MVP受入](https://github.com/Motoki2601/portal/milestone/5) | [#43](https://github.com/Motoki2601/portal/issues/43) | 本人履歴から会話・通知・補正まで動き、2週の精度と費用を確認済み |

## Issue対応表と依存関係

| キー | 作業Issue | 親 | 依存先 | 現在状態 |
|---|---|---|---|---|
| A | [#32](https://github.com/Motoki2601/portal/issues/32) 本番運用設定・Secret・AI費用停止を整備する | [#9](https://github.com/Motoki2601/portal/issues/9) | #16と並行、#17現状確認 | 未着手 |
| B | [#33](https://github.com/Motoki2601/portal/issues/33) アプリ用Gmail OAuth接続・解除・再認証を実装する | [#9](https://github.com/Motoki2601/portal/issues/9) | [#32](https://github.com/Motoki2601/portal/issues/32) | 未着手 |
| C | [#34](https://github.com/Motoki2601/portal/issues/34) raw MIME復号・個人情報除去・Gmail増分取得を実装する | [#9](https://github.com/Motoki2601/portal/issues/9) | [#33](https://github.com/Motoki2601/portal/issues/33) | 未着手 |
| D | [#35](https://github.com/Motoki2601/portal/issues/35) ヨドバシ注文／出荷メールのAI構造化・保存を実装する | [#9](https://github.com/Motoki2601/portal/issues/9) | [#34](https://github.com/Motoki2601/portal/issues/34)、[#16](https://github.com/Motoki2601/portal/issues/16) | 未着手 |
| E | [#36](https://github.com/Motoki2601/portal/issues/36) Amazon注文メールのAI構造化・保存を実装する | [#9](https://github.com/Motoki2601/portal/issues/9) | [#34](https://github.com/Motoki2601/portal/issues/34)、[#16](https://github.com/Motoki2601/portal/issues/16) | 未着手 |
| F | [#37](https://github.com/Motoki2601/portal/issues/37) 商品属性・カテゴリ整理と安全な照合を実装する | [#9](https://github.com/Motoki2601/portal/issues/9) | [#35](https://github.com/Motoki2601/portal/issues/35)、[#36](https://github.com/Motoki2601/portal/issues/36) | 未着手 |
| G | [#38](https://github.com/Motoki2601/portal/issues/38) Gemini会話adapterと認証付き会話APIを実装する | [#19](https://github.com/Motoki2601/portal/issues/19) | [#32](https://github.com/Motoki2601/portal/issues/32) | 未着手 |
| H | [#39](https://github.com/Motoki2601/portal/issues/39) 現在価格・代替商品の検索と根拠保存を実装する | [#19](https://github.com/Motoki2601/portal/issues/19) | [#38](https://github.com/Motoki2601/portal/issues/38) | 未着手 |
| I | [#40](https://github.com/Motoki2601/portal/issues/40) Portal会話・補正確認UIを実装する | [#19](https://github.com/Motoki2601/portal/issues/19) | [#38](https://github.com/Motoki2601/portal/issues/38)、[#39](https://github.com/Motoki2601/portal/issues/39)、[#37](https://github.com/Motoki2601/portal/issues/37) | 未着手 |
| J | [#41](https://github.com/Motoki2601/portal/issues/41) 週次取込・候補計算Jobを実装する | [#9](https://github.com/Motoki2601/portal/issues/9) | [#35](https://github.com/Motoki2601/portal/issues/35)、[#36](https://github.com/Motoki2601/portal/issues/36)、[#37](https://github.com/Motoki2601/portal/issues/37) | 未着手 |
| K | [#42](https://github.com/Motoki2601/portal/issues/42) 候補がある場合のGmailレポート送信を実装する | [#9](https://github.com/Motoki2601/portal/issues/9) | [#39](https://github.com/Motoki2601/portal/issues/39)、[#41](https://github.com/Motoki2601/portal/issues/41) | 未着手 |
| L | [#43](https://github.com/Motoki2601/portal/issues/43) 総合受入・本人運用開始・2週の価値検証を行う | [#9](https://github.com/Motoki2601/portal/issues/9) | [#16](https://github.com/Motoki2601/portal/issues/16)、[#32](https://github.com/Motoki2601/portal/issues/32)、[#33](https://github.com/Motoki2601/portal/issues/33)、[#34](https://github.com/Motoki2601/portal/issues/34)、[#35](https://github.com/Motoki2601/portal/issues/35)、[#36](https://github.com/Motoki2601/portal/issues/36)、[#37](https://github.com/Motoki2601/portal/issues/37)、[#38](https://github.com/Motoki2601/portal/issues/38)、[#39](https://github.com/Motoki2601/portal/issues/39)、[#40](https://github.com/Motoki2601/portal/issues/40)、[#41](https://github.com/Motoki2601/portal/issues/41)、[#42](https://github.com/Motoki2601/portal/issues/42) | 未着手 |

- [#16](https://github.com/Motoki2601/portal/issues/16): API実装とRulesソースはマージ済み。本番Cloud Run/Rules反映・実認証/IAM疎通は未完了。M1。
- [#19](https://github.com/Motoki2601/portal/issues/19): Tool境界は#27/#28でマージ済み。実Gemini・検索接続・Portal UIは未完了。G/H/Iを子としてM3で管理。
- [#18](https://github.com/Motoki2601/portal/issues/18)・[#20](https://github.com/Motoki2601/portal/issues/20): 将来Backlogを維持、今回MVP対象外。
- [#2](https://github.com/Motoki2601/portal/issues/2): 独立Portal機能を維持。
- [#6](https://github.com/Motoki2601/portal/issues/6)、[#13](https://github.com/Motoki2601/portal/issues/13)、[#15](https://github.com/Motoki2601/portal/issues/15)、[#17](https://github.com/Motoki2601/portal/issues/17)、[#21](https://github.com/Motoki2601/portal/issues/21)、[#22](https://github.com/Motoki2601/portal/issues/22)、[#23](https://github.com/Motoki2601/portal/issues/23): 完了を維持。#17の課金/Budgetは現状確認して利用し再実装しない。
- [#43](https://github.com/Motoki2601/portal/issues/43)はM1〜M4の全作業受入完了に依存。#19もG/H/I受入が揃うまでopen。
- 依存先が完了しINPUTが揃ったIssueのみ実装着手。未充足の担当は契約・調査・レビュー準備までとする。

## 段階別IPO

| 段階 | INPUT | Process | Output | 対応Issue |
|---|---|---|---|---|
| 本番基盤 | 最新main、既存GCP設定、許可UID | IAM・Cloud Run・Rules設定、実認証試験 | API URL、revision、疎通証跡 | [#16](https://github.com/Motoki2601/portal/issues/16)、[#32](https://github.com/Motoki2601/portal/issues/32) |
| メール取込 | OAuth、両ECメール、取込契約 | 取得→復号→除去→構造化→検証→保存 | Source・注文・明細・確認待ち理由 | [#33](https://github.com/Motoki2601/portal/issues/33)、[#34](https://github.com/Motoki2601/portal/issues/34)、[#35](https://github.com/Motoki2601/portal/issues/35)、[#36](https://github.com/Motoki2601/portal/issues/36) |
| 商品・補充 | 保存履歴、商品情報、本人補正 | 照合→属性整理→既存周期計算 | 商品文脈、周期、根拠付き補充候補 | [#37](https://github.com/Motoki2601/portal/issues/37) |
| 会話・検索 | 購入文脈、質問、Gemini | 許可Tool参照→必要時検索→推薦 | 根拠付き回答、推薦、補正確認 | [#19](https://github.com/Motoki2601/portal/issues/19)、[#38](https://github.com/Motoki2601/portal/issues/38)、[#39](https://github.com/Motoki2601/portal/issues/39)、[#40](https://github.com/Motoki2601/portal/issues/40) |
| 週次通知 | 更新履歴、候補、送信先 | 日曜9時に取込→計算→調査→送信 | 候補がある週のメール、実行記録 | [#39](https://github.com/Motoki2601/portal/issues/39)、[#41](https://github.com/Motoki2601/portal/issues/41)、[#42](https://github.com/Motoki2601/portal/issues/42) |
| 本人運用 | 総合試験結果、承認、本人OAuth | 初回取込→定期稼働→2週観察 | MVP受入・精度・費用報告 | [#43](https://github.com/Motoki2601/portal/issues/43) |

## 確定方針

- Gemini有料API、初期モデル `gemini-3.5-flash-lite`、Google Search Grounding。モデルを自動変更しない。利用可否と価格は実装時に公式情報で確認し、不可なら障害として記録する。
- Geminiへ送る本人情報は住所・氏名・支払情報を除いた必要最小限の購入情報。
- Amazon・ヨドバシ両方の受入完了後に自動取込を本番開始。
- Gmail初回180日、継続14日重複窓、全ページ取得、失敗分再試行。既存の重複・訂正維持・監査契約を継承。
- 容量・包装差を保持し、曖昧な照合は確認待ち。本人訂正をAIが上書きしない。
- 会話は認証付きAPIと既存Tool境界。補正はPortalで本人確認後に実行。
- 週次は日曜9時・Asia/Tokyo。候補ゼロは送信しない。送信結果不明時は自動再送しない。
- AI・検索は月700円相当で停止。未処理メールは保留、履歴参照・周期計算・価格なし通知は継続。クラウド等は月300円目安。#17の既存Billing/Budgetを再実装しない。
- 本番検証は専用ユーザーと匿名データ。secret、token、生メール、本人購入データを公開Issueへ記載しない。
- OAuth継続運用、予算到達、再認証、重複起動、途中失敗からの再開を受入試験に含める。
- 自動購入、決済、MCP、商品split/merge高度化はMVP外。

## 分担と共有インターフェース

主担当は契約・進捗・統合レビューと承認資料を管理する。担当は基盤、取込・商品整理、会話・UIに分担し、各担当は別branch/PRを使う。

- 基盤: #16、A。verified UID・既存Application/HTTP境界とruntime SA最小権限を維持。費用ゲートは外部AI/検索の前に月次予約・実績確定を行い、停止時の機械可読状態を返す。
- 取込・商品整理: B〜F。Gmail raw→匿名入力→ingest_order_source契約。message ID/merchant account scopeの冪等性、userOverrides、revision/監査transactionを継承。
- 会話・UI: G/H/I、#19。model({messages,tools})→{text}または{toolCalls}。verified UIDはホストで束縛。補正はPortal本人確認後に既存認証APIで行う。
- J/Kは取込/候補/検索の受入後に統合。送信台帳のunknownは自動再送しない。

並行実装前に共有契約とownershipを対象Issue/PRへ記録し、既存契約との差分を主担当がレビューする。依存待ちの実装を先行しない。

## 承認の境界

今回のIssue・マイルストーン整理と実装開始は承認済み。再承認不要。
本番IAM/Rules/デプロイ、追加課金設定、本人Gmail接続・取込、本人宛送信、定期実行開始は、具体的差分・検証結果・残リスク・rollbackを揃えてから承認を求める。承認前に実行しない。
実サービス検証は専用ユーザー/匿名データで行うが、必要な本番変更・追加課金の承認を省略しない。資格情報を公開Issue/PRへ保存しない。

## 再開手順

1. #9 → 本書 → 対象Issueの再開情報 → 最新PR/CI → 実環境の順に確認。
2. git status、remote、branch、最新mainを確認。利用者の変更を上書きしない。
3. GitHub CLI通信はsandbox内で拒否される場合がある。制限外の読取り確認で認証成功を確認済み。config.tomlは変更していない。
4. 対象Issueの依存先受入とINPUTを確認。#16本番準備とAが初手。前回GCP認証なし、今回実環境アクセスは未確認。
5. 別branch/PRへ実装・検証し、Issueへ現在状態、次の一手、障害、branch/PR/CI、最終確認日を記録。
6. 承認対象は具体的差分と検証を提示。承認後に反映し、実環境証跡を追記する。
7. 本人運用開始後2週の価値検証が必要。準備/fixture成功のみでMVP受入完了にしない。

## 読み戻し検証の完了条件

- M1〜M5の名称/完了条件/期日なし/全所属が一致。
- 全作業IssueのIPO・受入条件・承認事項・再開情報が揃う。
- 本文リンクとGitHub親子/blocked-by関係がIssue対応表に一致。
- #9から本書/全マイルストーン/全作業Issueへ、本書と各Issueから#9へ辿れる。
- #16/#19は実装済みと未完了を分離。既存完了Issue・Backlog・#2の状態を維持。
- 日本語文字列をUTF-8で保存し、GitHubから読み戻して一致を確認。
