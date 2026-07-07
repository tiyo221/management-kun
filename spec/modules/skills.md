# skills — スキル可視化（モジュール個別仕様）

統合上の位置づけ・共通マスタとの関係・固有データの所在を定める。共通の取り決め（アーキテクチャ・データ規格・名寄せ・デザイン）は [`spec.md`](../../spec.md)（共通仕様）を正とする。機能の詳細挙動は旧ツールの仕様を正とする。

- 参照（機能詳細の正）: [skill-mieru-kun/spec.md](../../../skill-mieru-kun/spec.md)
- localStorage: `mk:module:skills:v1`
- ゾーン: **ピープル**

## 役割
メンバー×スキルのマトリクス・ギャップ・レーダー可視化。

## 共通マスタ関係
**Member を People マスタから参照**（従来の自前 `members[]` を廃し `people.members` を使用）。Project は使わない。

## エンティティ集約（`summaryFor`・[`spec.md`](../../spec.md) §3.6.1）
人詳細の集約ビュー（#83）向けに `summaryFor("person", memberId)` を実装する。その人の**評価済みスキル数・平均レベル・コア充足（目標レベル以上のコアスキル数／コア総数）**を返す。評価が1件も無ければ `empty:true`。`person` 以外の種別は該当なし（`empty:true`）で応える（"project" 決め打ち分岐をしない）。集計は `MK.logic.skills.summaryFor`（純関数・`test/summary-for.test.js`）。

## 固有データ
- `skills[]`（スキルマスタ）、`ratings`（キー `"<memberId>:<skillId>"`）。`mk:module:skills:v1`。
- モジュール内部 ID は既存採番を踏襲（[`spec.md`](../../spec.md) §4.7）。

## CSV
ユーザ（マスタ Member へ名寄せ）／スキル／紐づけ の3種を共通 CSV 規約（[`import-migration.md`](../import-migration.md) §4.6）で入出力する。メンバーは**名前**参照で取込時に §8 名寄せへ通す。

| 種別 | 列 |
|---|---|
| ユーザ | `氏名, 役割, 備考` |
| スキル | `大分類, 中分類, 小分類, コア, 目標レベル, 必要人数, 表示` |
| 紐づけ | `メンバー名, 大分類, 中分類, 値`（縦持ち。値は `1〜5` / `-`） |

## 旧データ移行
| 旧キー / 形状 | 移行先 |
|---|---|
| `skill-tool-data-v1` `{members, skills, ratings}` | `members` → `mk:people`（名寄せ）、`skills` / `ratings` → `mk:module:skills:v1` |

移行フロー全体は [`import-migration.md`](../import-migration.md) §7、名寄せは §8 を参照。
