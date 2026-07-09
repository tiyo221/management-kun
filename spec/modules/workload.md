# workload — タスク負荷可視化（旧 task-mieru-kun）【退役・撤去済み】（モジュール個別仕様）

> **退役・撤去（Issue #167 / 2026-07-10）**: 本モジュールは**撤去済み**。実装（`modules/workload/logic.js` / `view.js`）・カタログ登録・専用 CSS（`.wl-*`）・テストは削除した。本書は**退役記録**として残す（新規実装の参照仕様ではない）。役割は要員計画（allocation）を主軸とする [`resource.md`](resource.md)（リソース）へ移譲済みで、resource は workload の task データに依存しない。統廃合の判断記録は [`spec.md`](../../spec.md) §9.6 の表を正とする。

## 退役の経緯
- **降格（Issue #52）**: 実運用では要員計画（allocation）が主軸となるため、task ベースの負荷可視化を**ナビ（ZONES）から外して降格**。当時はモジュール登録・データ（`mk:module:workload:v1`）を保全していた。
- **昇格（Issue #45）**: かつて workload が内部保持していた共有アロケーション（`人 × 器 × 期間 × 割当%`）は、第2の消費者（要員計画）の出現に伴い**中立な共有マスタ `mk:allocations` へ昇格**した（[`spec.md`](../../spec.md) §3.7.5・§4.4）。以降 workload はアロケーションを持たず・参照しない。
- **撤去（Issue #167）**: #52 でナビ降格して以降は UI から到達不能で機能的に死んでいた。基盤を軽く保つため（[`spec.md`](../../spec.md) §1.2）新モジュール追加の前に正式退役。移行チェーンがモジュール本体のロードに依存しないことを spike で確認した上で撤去した。

## 撤去後の旧データの扱い（終端ワンショット移行）
`mk:module:workload:v1` の内部アロケーションは、モジュール本体に依存しない **store レベルの終端移行**が起動時に一度吸い上げる（冪等）。

- `MK.allocations.migrateFromWorkload()`（`shared/allocations.js`）が `shared/shell.js` の起動シーケンスで実行される。
- 内部 `allocations[]` があれば id を保持したまま共有マスタ `mk:allocations` へ**加算的・非破壊**（既存 id は上書きしない）に移設する（Issue #45 の昇格）。
- **吸い上げ後は `mk:module:workload` キーごと破棄**する（負荷タスク等の残骸を localStorage に残さない・Issue #167）。旧データが無ければ何もしない（冪等）。
- 旧・単一HTMLタスクツール（`task-tool-data-v1`）→ workload の取込分岐（設定画面の「旧データを取り込む」）は受け皿（モジュール本体）が消えたため撤去した。同キーの `LEGACY_KEYS` 登録も削除。

> 注意: Issue #45 より前に書き出した**全体 JSON バックアップ**は、アロケーションを `modules.workload` セクション内に持つ。撤去後はそのセクションを取り込む消費者が無いため、当該バックアップからのアロケーションは JSON インポートでは復元されない（localStorage からの起動時吸い上げは上記のとおり保全される）。

## 参考（撤去時点の仕様スナップショット）
撤去前の workload が持っていた機能・データ・CSV は履歴として以下に要約する（現行実装には存在しない）。

- 役割: メンバーの負荷×期間の中長期俯瞰、過負荷/低負荷シグナル、計画ベースライン。
- 固有データ: `tasks[]`（load / period / status）、`baseline`（スナップショット）、`memberSettings`（警告閾値 `capacityWarnHigh` / `capacityWarnLow`・表示色）。`mk:module:workload:v1`。タスク ID は `wt` プレフィックス。scope は global（ゾーン: ピープル）。
- CSV 列: `メンバー, タスク, 稼働率, 開始日, 終了予定日, ステータス, 完了日, 備考`。
- 旧ツール参照: [task-mieru-kun/spec.md](../../../task-mieru-kun/spec.md)。
