# skills — スキル可視化（モジュール個別仕様）

統合上の位置づけ・共通マスタとの関係・固有データの所在を定める。共通の取り決め（アーキテクチャ・データ規格・名寄せ・デザイン）は [`spec.md`](../../spec.md)（共通仕様）を正とする。機能の詳細挙動は旧ツールの仕様を正とする。

- 参照（機能詳細の正）: [skill-mieru-kun/spec.md](../../../skill-mieru-kun/spec.md)
- localStorage: `mk:module:skills:v1`
- ゾーン: **ピープル**

## 役割
メンバー×スキルのマトリクス・ギャップ・レーダー可視化。

## 共通マスタ関係
**Member を People マスタから参照**（従来の自前 `members[]` を廃し `people.members` を使用）。Project は使わない。

## 任意契約の採否（searchItems / summaryFor）
グローバル検索（[`spec.md`](../../spec.md) §3.5）と人／PJ 詳細の集約（§3.6.1）は任意契約。採否を固着させる（#220）。
- **searchItems**: 見送り。スキルは台帳の分類語彙（スキル名）で自由記述の本文を持たず、Ctrl+K で「開いて読む一次レコード」にならない。人×スキルの評価は人詳細（`summaryFor`）で引ける。
- **summaryFor**: 実装。人詳細の集約ビュー（#83）向けに `summaryFor("person", memberId)` を実装する。その人の**評価済みスキル数・平均レベル・コア充足（目標レベル以上のコアスキル数／コア総数）**を返す。評価が1件も無ければ `empty:true`。`person` 以外の種別は該当なし（`empty:true`）で応える（"project" 決め打ち分岐をしない）。集計は `MK.logic.skills.summaryFor`（純関数・`test/summary-for.test.js`）。

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

## サマリー（HOME 表示）
`summary()` は行動指標を返す純関数（[`spec.md`](../../spec.md) §3.6・方針①③・#203）。「今日」に依存しないため基準日は取らない。

- stats: `カバー率 <P>%`（目標設定済みスキル＝目標レベル・必要人数の両方ありのうち、必要人数を充足しているものの割合＝状態。目標設定済みが無ければ `—`）／`未評価 N`（目標設定済みスキル×メンバーで評価が空欄＝未入力のセル数）。母数の `メンバー` / `スキル項目` は撤去。
- attention: `不足スキル N件`（`gapOf` が `short`＝必要人数に達していないスキル数・`warn`）。不足は attention に集約し stats へ二重表示しない。
