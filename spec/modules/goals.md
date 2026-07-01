# goals — 目標みえるくん（モジュール個別仕様）

統合上の位置づけ・共通マスタとの関係・固有データの所在を定める。共通の取り決め（アーキテクチャ・データ規格・名寄せ・デザイン）は [`spec.md`](../../spec.md)（共通仕様）を正とする。機能の詳細挙動は旧ツールの仕様を正とする。

- 参照（機能詳細の正）: [mokuhyo-mieru-kun/spec.md](../../../mokuhyo-mieru-kun/spec.md)
- localStorage: `mk:module:goals:v1`
- ゾーン: **個人**（マネージャ自身の目標。[`spec.md`](../../spec.md) §1.4）

## 役割
大目標→ステップのロードマップ可視化 + 統計ダッシュボード。**個人ゾーン**のツール（自分の目標であり、チームの KPI/OKR ではない）。

## 共通マスタ関係
**持たない。** Member も Project も参照しない（チーム目標管理に見せないため。[`spec.md`](../../spec.md) §1.4）。将来「チームの OKR/KPI 管理」が必要になっても goals には載せず、別概念の新モジュールとして検討する。

## 固有データ
- `goals[]`（goal / step）。`mk:module:goals:v1`。
- モジュール内部 ID は既存方式（`g_` / `s_`）を踏襲（[`spec.md`](../../spec.md) §4.7）。

## CSV
なし（JSON のみ）。

## 旧データ移行
| 旧キー / 形状 | 移行先 |
|---|---|
| `mokuhyo-mieru-kun:v1` `{version, goals}` | `mk:module:goals:v1` |

移行フロー全体は [`spec.md`](../../spec.md) §7 を参照。
