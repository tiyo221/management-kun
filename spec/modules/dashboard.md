# dashboard — プロジェクト・ダッシュボード（横断集約ビュー）（モジュール個別仕様）

統合上の位置づけ・共通マスタとの関係・固有データの所在を定める。共通の取り決め（アーキテクチャ・データ規格・名寄せ・デザイン）は [`spec.md`](../../spec.md)（共通仕様）を正とする。spec.md §9.2 / §14 で Phase 2 に置いていた「プロジェクト・ダッシュボード」を実装したもの（Issue #78）。

- localStorage: **なし**（自前の永続データを持たない。表示するデータはすべて共有マスタと他モジュールの対象別データを読むだけ）
- ゾーン: **デリバリー**（wbs と同居。主語＝Project）
- scope: **project**（`{ dim: "project" }`。§3.7.3）。シェルのスコープスイッチャで選んだ Project を主語にする

## 役割
1つの Project を主語に、**マスタ共有している各領域の情報を1画面で一望**する読み取り専用の集約ビュー。「選んだプロジェクトはいま健全か」をマネージャが素早く把握するための玄関。**編集は各モジュール側で行う**（重複実装しない）。各カードには該当モジュールへの遷移導線（`ctx.route`）を置く。

画面は Project 単位のカードで構成する:

1. **プロジェクト基本情報** — マスタ（`MK.projects`）の名前・ステータス・表示色・備考。
2. **WBS の進捗** — 対象 PJ の WBS を集約（進捗率・タスク数・完了・進行中・期限超過）。「WBS を開く →」で `wbs` へ遷移する（project-scoped 同士のため現在の PJ 文脈を引き継ぐ）。
3. **アサイン状況** — 共有アロケーション（`MK.allocations`）から対象 PJ への割当（誰が何%・期間・稼働中フラグ）。「リソースを開く →」で `resource`（横断ビュー）へ遷移する。
4. **関連プロダクト** — Product⇄Project の緩い紐付け（`projectIds`・Issue #55）で対象 PJ に紐づく Product。

- データが無い領域は空状態の案内を出す（壊れない・無言にしない）。
- 単一 PJ でもスイッチャが畳まれるだけで自明な1件として成立する（縮退。§3.7.2）。

## モジュール独立との関係（横断集約の位置づけ）
- resource（要員計画）が「各モジュール内部を覗かない」制約（§3.7.5）を持つのは、People 主語の cross ビューを共有アロケーションだけで完結させ、WBS 内部（担当 `assigneeId`）に依存させないため。
- dashboard は spec §9.2 / §14 が Phase 2 として明示していた**プロジェクト・ダッシュボードそのもの**であり、WBS の進捗を集約することが目的に含まれる（Issue #78 の受け入れ条件）。ただし依存は**一方向・読み取り専用**に限定する: dashboard が wbs の対象別データ（`MK.logic.wbs.exportData(projectId)`）を読むだけで、wbs は dashboard を一切知らない。wbs 側の独立性は保たれる。
- 編集導線はすべて他モジュールへの遷移（`ctx.route`）で、dashboard 自身はどのマスタ・モジュールデータも書き換えない。
- **人詳細の集約ビュー（#83）との役割分担**: プロジェクトを主語にした集約は本 dashboard に一本化し、マスタ側（`master-projects`）にプロジェクト詳細は作らない。人（People は参照マスタでスコープ次元にしない・§3.7.1）を主語にした集約は、マスタ側の**人詳細ビュー**（シェルの `master-people` 詳細）が担う。両者は同じ任意契約 `summaryFor(entityType,id)`＋リーダ `MK.readEntitySummary`（§3.6.1）を土台に共存する（判断記録は spec.md §9.6）。

## 共通マスタ関係
- **Project マスタ**を参照（現在の対象＝`ctx.scope.entity`。基本情報の表示元）。
- **People マスタ**を参照（アロケーションのメンバー名解決。横断参照・scope で縛らない）。
- **Allocation 共有マスタ**を参照（`MK.allocations.forTarget(projectId)`）。
- **Product 共有マスタ**を参照（`projectIds` による紐付け）。
- いずれも**読み取りのみ**でマスタは変更しない。

## 固有データ
なし。集約はすべて既存の共有マスタ・他モジュールの対象別データから都度算出する。

## 集計（logic 側の純関数・テスト可能）
`MK.logic.dashboard`（`test/dashboard.test.js`）。DOM 非依存。

- `projectStatusLabel(key)` … Project ステータスキー → 表示ラベル（`active` → 進行中 / `archived` → アーカイブ。未知値はそのまま）。
- `wbsSummary(projectId, today)` … 対象 PJ の WBS 進捗（`empty` / `leaves` / `done` / `inprogress` / `overall`(%) / `overdue`）。葉タスクを母数にし（wbs.stats と同じ定義）、期限超過は「未完 かつ 終了日 < 基準日 かつ 終了日設定あり」。「今日」は引数注入で決定的テストにする（§3.6 / TESTING §1）。
- `allocationsFor(projectId, today)` … 対象 PJ へのアロケーション（`allocation` / `member` / `memberName` / `active`＝基準日が期間内か）。
- `productsFor(projectId)` … `projectIds` に対象 PJ を含む Product 一覧。

## CSV
なし（自前データを持たないため）。

## 旧データ移行
なし（自前の永続データを持たない。表示元の各マスタ・モジュールデータがそれぞれの移行で保全される）。
