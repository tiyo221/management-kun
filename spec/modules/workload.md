# workload — タスク負荷可視化（旧 task-mieru-kun）（モジュール個別仕様）

統合上の位置づけ・共通マスタとの関係・固有データの所在を定める。共通の取り決め（アーキテクチャ・データ規格・名寄せ・デザイン）は [`spec.md`](../../spec.md)（共通仕様）を正とする。機能の詳細挙動は旧ツールの仕様を正とする。

- 参照（機能詳細の正）: [task-mieru-kun/spec.md](../../../task-mieru-kun/spec.md)
- localStorage: `mk:module:workload:v1`
- ゾーン: **ピープル**

## 役割
メンバーの負荷×期間の中長期俯瞰、過負荷/低負荷シグナル、計画ベースライン。加えて、**共有アロケーション**（`人 × 器（Project/将来 Product）× 期間 × 割当%`）を保持する。要員計画（横断ビュー・#27）のデータ源となる（[`spec.md`](../../spec.md) §3.7.5）。

## 共通マスタ関係
**Member を People マスタから参照。** 警告閾値（`capacityWarnHigh` / `capacityWarnLow`）・表示色はマスタに持たせず、モジュール側 `memberSettings[memberId]` に保持する（マスタを汚さず拡張するため。[`spec.md`](../../spec.md) §4.4）。Project 参照は任意。

## 固有データ
- `tasks[]`（load / period / status）、`baseline`（スナップショット）、`memberSettings`。`mk:module:workload:v1`。
- `allocations[]`（共有アロケーション。§3.7.5）。1件＝`{ id, memberId, targetId, dim, startDate, endDate, percent, note }`。
  - `targetId` は器（現状 Project マスタの id）、`dim` は次元キー（既定 `"project"`・将来 `"product"`）。次元は `MK_CONFIG.dimensions`（§3.7.6）由来で、コードは `"project"` を決め打ちしない。
  - **タスク（実行）とは独立レコード**: 負荷計算（`series`/`stats`）には混ぜない。WBS の担当（`assigneeId`）から導出せず、片方の変更が他方に影響しない（§3.7.5）。
  - 横断ビュー（要員計画・#27）は logic 側 API（`allocations()` / `allocationsOf()` / `allocationsForTarget()` / 集計純関数 `allocationPercentOn()`）で読む。
- モジュール内部 ID は既存採番を踏襲（[`spec.md`](../../spec.md) §4.7）。アロケーション ID は `wa` プレフィックス。

### 次元対応（本モジュールは global のまま）
workload の登録 scope は **global**（ゾーン: ピープル）を維持する。アロケーションは器（Project）を **`targetId` フィールドとして内部に持つ**方式で次元対応する（scoped の対象別 namespace 分割は使わない）。理由: 負荷/計画は人を主語に器を横断して俯瞰する必要があり、対象別にデータを割ると横断集計ができないため（§3.7.5 の cross ビュー思想）。

## CSV
なし（JSON のみ）。必要になれば [`import-migration.md`](../import-migration.md) §4.6 の共通規約に沿って追加する。

## 旧データ移行
| 旧キー / 形状 | 移行先 |
|---|---|
| （旧キー）`{members, tasks, baseline}` | `members` → `mk:people`（名寄せ。閾値/色は `memberSettings`）、他 → `mk:module:workload:v1` |
| `allocations` 欠落の既存 `mk:module:workload:v1` | `load()` が読み込み時に `allocations: []` を補完（**加算的・非破壊**。version 据え置き）。既存 `tasks`/`baseline`/`memberSettings` は保持 |

**アロケーションの移行方針**: 既存 workload データにアロケーションは存在しないため、追加は純粋に加算的で失われるデータはない。`load()` が `memberSettings` と同様に欠落フィールドをその場で補完するため専用マイグレーションステップ（§4.5）は不要。JSON 取込は `merge` で id 一致上書き、`replace` で全置換（`allocations` も同様）。

移行フロー全体は [`import-migration.md`](../import-migration.md) §7、名寄せは §8 を参照。
