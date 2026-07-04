# workload — タスク負荷可視化（旧 task-mieru-kun）（モジュール個別仕様）

統合上の位置づけ・共通マスタとの関係・固有データの所在を定める。共通の取り決め（アーキテクチャ・データ規格・名寄せ・デザイン）は [`spec.md`](../../spec.md)（共通仕様）を正とする。機能の詳細挙動は旧ツールの仕様を正とする。

> **降格（Issue #52）**: 実運用では要員計画（allocation）が主軸となるため、task ベースの負荷可視化は**ナビ（ZONES）から外して降格**した。ただし**モジュール登録・データ（`mk:module:workload:v1`）は保全**する（UI から外すがデータは失わない。全体 JSON エクスポートで round-trip）。主軸機能は [`resource.md`](resource.md)（リソース）へ移行済み。workload を完全削除するかは次サイクルで判断する。

- 参照（機能詳細の正）: [task-mieru-kun/spec.md](../../../task-mieru-kun/spec.md)
- localStorage: `mk:module:workload:v1`
- ゾーン: **ピープル**（Issue #52 で ZONES から除外・登録は維持）

## 役割
メンバーの負荷×期間の中長期俯瞰、過負荷/低負荷シグナル、計画ベースライン。**負荷（タスク）の可視化に専念**する。かつて保持していた共有アロケーション（`人 × 器 × 期間 × 割当%`）は、第2の消費者（要員計画）の出現に伴い**中立な共有マスタ `mk:allocations` へ昇格**した（Issue #45 / [`spec.md`](../../spec.md) §3.7.5・§4.4）。workload はアロケーションを持たず、参照もしない。

## 共通マスタ関係
**Member を People マスタから参照。** 警告閾値（`capacityWarnHigh` / `capacityWarnLow`）・表示色はマスタに持たせず、モジュール側 `memberSettings[memberId]` に保持する（マスタを汚さず拡張するため。[`spec.md`](../../spec.md) §4.4）。Project 参照は任意。

## 固有データ
- `tasks[]`（load / period / status）、`baseline`（スナップショット）、`memberSettings`。`mk:module:workload:v1`。
- モジュール内部 ID は既存採番を踏襲（[`spec.md`](../../spec.md) §4.7）。タスク ID は `wt` プレフィックス。
- **アロケーションは持たない**（`mk:allocations` 共有マスタへ移設・Issue #45）。要員計画は workload に依存せず共有マスタから読む。

### scope（本モジュールは global のまま）
workload の登録 scope は **global**（ゾーン: ピープル）を維持する。負荷は人を主語に器を横断して俯瞰するため、対象別 namespace 分割（scoped）は使わない。

## CSV
共通契約は [`import-migration.md`](../import-migration.md) §4.6.2（Issue #77）。

- 列: `メンバー, タスク, 稼働率, 開始日, 終了予定日, ステータス, 完了日, 備考`。
- `タスク`（タスク名）は必須（空の行はスキップし件数に数える）。
- `メンバー` は**名前**参照（§8 名寄せ。未登録は新規作成、空は未割当 `null`）。出力時はメンバー名へ展開。
- `稼働率` は稼働率(%)。0 以上の整数へ寄せる（不正値は 0）。
- `開始日` / `終了予定日` / `完了日` は `YYYY-MM-DD`（空可）。`完了日` は `ステータス=完了` のとき実効終了日として使う。
- `ステータス` は key（`todo` / `in_progress` / `done`）または日本語ラベル（未着手 / 進行中 / 完了）を受け付け、不明・空は `todo` に寄せる。
- 取込は**全置換**。`baseline`（計画スナップショット）は取込で破棄し、`memberSettings`（警告閾値）は保持する。

## 旧データ移行
| 旧キー / 形状 | 移行先 |
|---|---|
| （旧キー）`{members, tasks, baseline}` | `members` → `mk:people`（名寄せ。閾値/色は `memberSettings`）、他 → `mk:module:workload:v1` |
| `mk:module:workload:v1` 内の `allocations[]` | 起動時に **共有マスタ `mk:allocations` へ移設**（`MK.allocations.migrateFromWorkload()`）。id を保持したまま加算的に移し（既存 id は上書きしない）、workload 側からは `allocations` を除去（**冪等**）。Issue #45 |

**アロケーションの昇格移行**: 旧 workload データにアロケーションがあれば起動時に一度だけ共有マスタへ移設する（加算的・非破壊。失われるデータはない）。移設後は workload に `allocations` が無くなるため再実行は無害（冪等）。JSON エンベロープではアロケーションはトップレベルの `allocations` として入出力する（workload モジュールデータには含めない・[`spec.md`](../../spec.md) §4.2）。

移行フロー全体は [`import-migration.md`](../import-migration.md) §7、名寄せは §8 を参照。
