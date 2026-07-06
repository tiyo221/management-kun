# goals — 目標みえるくん（モジュール個別仕様）

統合上の位置づけ・共通マスタとの関係・固有データの所在を定める。共通の取り決め（アーキテクチャ・データ規格・名寄せ・デザイン）は [`spec.md`](../../spec.md)（共通仕様）を正とする。機能の詳細挙動は旧ツールの仕様を正とする。

- 参照（機能詳細の正）: [mokuhyo-mieru-kun/spec.md](../../../mokuhyo-mieru-kun/spec.md)
- localStorage: `mk:module:goals:v1`
- ゾーン: **自分**（マネージャ自身の目標。[`spec.md`](../../spec.md) §1.4）

## 役割
大目標→ステップのロードマップ可視化 + 統計ダッシュボード。**自分ゾーン**のツール（自分の目標であり、チームの KPI/OKR ではない）。

## 共通マスタ関係
**持たない。** Member も Project も参照しない（チーム目標管理に見せないため。[`spec.md`](../../spec.md) §1.4）。将来「チームの OKR/KPI 管理」が必要になっても goals には載せず、別概念の新モジュールとして検討する。

## 固有データ
- `goals[]`（goal / step）。`mk:module:goals:v1`。
- モジュール内部 ID は既存方式（`g_` / `s_`）を踏襲（[`spec.md`](../../spec.md) §4.7）。

## CSV
共通契約（[`spec/import-migration.md`](../import-migration.md) §4.6.2）に沿う。goal / step の入れ子を **種別列でフラット化**する（1行＝目標 or ステップ。Excel で読める形）。列は `種別, タイトル, 説明, 期限, 状態, 完了日, 振り返り`。

- `種別` = `goal` / `step`（`目標` / `ステップ` も寛容解釈。step 以外は goal に寄せる）。`step` 行は直前の `goal` 行に属する。
- `タイトル` は必須（空の行はスキップ）。親 `goal` のない `step` 行もスキップする（件数警告）。
- `期限`（goal のみ）・`完了日`（step のみ）は `YYYY-MM-DD` 形式のみ採用し、不正・空は未設定扱い。
- `状態`（step のみ）は `done` / `完了` を完了、それ以外を `todo` とみなす。
- 取込は全置換。`createdAt` は取込時刻で再生成し、`achievedAt` は取込後の再計算（全ステップ done で自動設定）に委ねる。`completedAt` は done かつ日付不正なら取込時刻。
- ラウンドトリップ（出力→取込）で goal/step の入れ子・対応が保たれる（UTF-8 BOM）。

## 旧データ移行
| 旧キー / 形状 | 移行先 |
|---|---|
| `mokuhyo-mieru-kun:v1` `{version, goals}` | `mk:module:goals:v1` |

移行フロー全体は [`import-migration.md`](../import-migration.md) §7 を参照。
