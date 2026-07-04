# releases — リリース台帳（リリース履歴・予定の管理）（モジュール個別仕様）

統合上の位置づけ・共通マスタとの関係・固有データの所在を定める。共通の取り決め（アーキテクチャ・データ規格・名寄せ・デザイン）は [`spec.md`](../../spec.md)（共通仕様）を正とする。

- localStorage: `mk:module:releases:v1`
- ゾーン: **プロダクト**（本モジュール追加で新設。§1.4 / §1.5）
- 新規モジュール（旧ツールなし。プロダクト領域の最初のゾーンモジュール。Issue #84）

## 役割
Product マスタと紐づくリリースの履歴・予定を1件1レコードで管理する台帳。プロダクトで絞り込んだ時系列一覧（ロードマップの簡易形）で「何をいつ出したか／いつ出すか」を把握できるようにする。まず台帳として成立させ、ロードマップ的な見え方の強化は将来枠。

## 共通マスタ関係
- **Product マスタ（§4.4）を参照する**（各リリースは `productId` 必須）。People / Project マスタは使わない。
- **スコープは global（横断）**。product-scoped（`mk:module:releases:<productId>:v1`）にはしない設計判断（Issue #84 着手時）:
  - 主用途が「プロダクト横断の台帳＋絞り込み時系列一覧」と「HOME での直近予定（全プロダクト横断）」であり、対象別 namespace に分割すると横断一覧の組み立てが複雑になる。
  - §3.7.6 のとおり product-scoped の実体化は「対象の中に入って作業する」モジュールが必要になった時点で行う（YAGNI）。本モジュールは対象を眺める台帳であり、絞り込みは表示都合（§3.7.3「マスタ参照は横断」）。
- プロダクト削除後も `productId` は保持し、表示側で「（削除済みプロダクト）」にフォールバックする（Product マスタの `relatedProjects` / `ownerPerson` と同じガード方針）。

## 固有データ
- `releases[]`: `{ id, productId, version, plannedDate, actualDate, status, note, createdAt, updatedAt }`。`mk:module:releases:v1`。
  - `productId` = 対象プロダクトの id（Product マスタ参照・必須）。
  - `version` = バージョン/名称（必須。例: v1.2.0、夏の大型アップデート）。
  - `plannedDate` = 予定日（`YYYY-MM-DD`。未定は `""`）。
  - `actualDate` = 実施日（`YYYY-MM-DD`。未実施は `""`）。
  - `status` = ステータス = `planned`（予定）/ `done`（完了）/ `cancelled`（中止）。未知・未指定は `planned` に正規化する。
  - `note` = メモ（任意）。
- 時系列一覧のソートキーは **実施日があれば実施日、なければ予定日**（昇順・日付未定は末尾）。
- モジュール内部 ID は `rel_<epoch>_<rand>`（[`spec.md`](../../spec.md) §4.7）。

## CSV（将来）
現状は JSON のみ（CSV 化は必要になった時点で [`spec/import-migration.md`](../import-migration.md) §4.6.2 の共通契約に従い追加する）。想定列:

- `プロダクト名, バージョン/名称, ステータス, 予定日, 実施日, メモ`
- `プロダクト名` は名前参照（§8 名寄せで解決・未登録は `MK.products.resolveOrCreate` で自動作成）。`ステータス` は key（`planned` / `done` / `cancelled`）または日本語ラベル先頭語（予定 / 完了 / 中止）を受け付け、不明なら `planned` に寄せる。

## 旧データ移行
なし（新規モジュール）。

## サマリー（HOME 表示）
`summary()` は `予定 N件` / `直近予定 <予定日>`（予定リリースが無ければ `—`）を返す（[`spec.md`](../../spec.md) §3.6）。「直近予定」は今日以降で最も近い `planned` の予定日。
