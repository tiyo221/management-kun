# workload — タスク負荷可視化（旧 task-mieru-kun）（モジュール個別仕様）

統合上の位置づけ・共通マスタとの関係・固有データの所在を定める。共通の取り決め（アーキテクチャ・データ規格・名寄せ・デザイン）は [`spec.md`](../../spec.md)（共通仕様）を正とする。機能の詳細挙動は旧ツールの仕様を正とする。

- 参照（機能詳細の正）: [task-mieru-kun/spec.md](../../../task-mieru-kun/spec.md)
- localStorage: `mk:module:workload:v1`
- ゾーン: **ピープル**

## 役割
メンバーの負荷×期間の中長期俯瞰、過負荷/低負荷シグナル、計画ベースライン。

## 共通マスタ関係
**Member を People マスタから参照。** 警告閾値（`capacityWarnHigh` / `capacityWarnLow`）・表示色はマスタに持たせず、モジュール側 `memberSettings[memberId]` に保持する（マスタを汚さず拡張するため。[`spec.md`](../../spec.md) §4.4）。Project 参照は任意。

## 固有データ
- `tasks[]`（load / period / status）、`baseline`（スナップショット）、`memberSettings`。`mk:module:workload:v1`。
- モジュール内部 ID は既存採番を踏襲（[`spec.md`](../../spec.md) §4.7）。

## CSV
なし（JSON のみ）。必要になれば [`import-migration.md`](../import-migration.md) §4.6 の共通規約に沿って追加する。

## 旧データ移行
| 旧キー / 形状 | 移行先 |
|---|---|
| （旧キー）`{members, tasks, baseline}` | `members` → `mk:people`（名寄せ。閾値/色は `memberSettings`）、他 → `mk:module:workload:v1` |

移行フロー全体は [`import-migration.md`](../import-migration.md) §7、名寄せは §8 を参照。
