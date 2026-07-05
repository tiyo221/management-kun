# techstack — 技術スタック台帳（Tech Radar 的な採用状況の可視化）（モジュール個別仕様）

統合上の位置づけ・共通マスタとの関係・固有データの所在を定める。共通の取り決め（アーキテクチャ・データ規格・名寄せ・デザイン）は [`spec.md`](../../spec.md)（共通仕様）を正とする。

- localStorage: `mk:module:techstack:v1`
- ゾーン: **テクノロジー**（本モジュール追加で新設。§1.4 / §1.5）
- 新規モジュール（旧ツールなし。「モジュールを増やして育てる」思想の実践。Issue #36）

## 役割
チームで使っている技術・バージョン・採用状況を1件1カードで一覧化する台帳。Tech Radar 的に **Adopt / Trial / Assess / Hold** の4リングで各技術の立ち位置を可視化し、EM が基盤の現状（何を標準採用し、何を撤去中か）を把握できるようにする。テクノロジー領域（主語＝技術・基盤）の最初のモジュール。

## 共通マスタ関係
People / Project マスタは**使わない**（global scope。技術は特定の人・PJ に属さない基盤情報）。`tags` は自由文字列で、将来 questions（#32）のタグ等と接続する布石とする（現状は名寄せしない・YAGNI）。

## 固有データ
- `items[]`: `{ id, name, category, version, ring, note, reviewDate, tags[], createdAt, updatedAt }`。`mk:module:techstack:v1`。
  - `name` = 技術名（必須。例: React, PostgreSQL）。
  - `category` = カテゴリ（任意・自由文字列。例: 言語 / フレームワーク / DB / 基盤）。
  - `version` = 使用バージョン（任意）。
  - `ring` = 採用状況 = `adopt`（採用）/ `trial`（試行）/ `assess`（評価）/ `hold`（保留）。未知・未指定は `assess` に正規化する。
  - `note` = 用途・所感・移行方針（任意）。
  - `reviewDate` = EOL（サポート終了）／見直し期限（任意。`"YYYY-MM-DD"` または `""`）。形式が異なる値・空は `""` に正規化する。後方互換で追加した任意フィールド（[`spec.md`](../../spec.md) §4.5）。未設定の既存データはそのまま扱える。
  - クイック追加・CSV 取込時の既定 `ring` は `assess`、`reviewDate` は `""`。
  - 期限判定: 本日を基準に残日数 < 0 なら **超過（overdue）**、`0〜90` 日なら **接近（soon）**、それ以外 `ok`、未設定は `none`（閾値 `DEADLINE_SOON_DAYS = 90`）。一覧では接近＝橙・超過＝赤の chip でハイライトする。
- モジュール内部 ID は `ts_<epoch>_<rand>`（[`spec.md`](../../spec.md) §4.7）。

## CSV
- 列: `技術名, カテゴリ, バージョン, リング, メモ, 見直し期限, タグ`。
- `リング` は key（`adopt` / `trial` / `assess` / `hold`）または日本語ラベル先頭語（採用 / 試行 / 評価 / 保留）を受け付け、不明なら `assess` に寄せる。
- `見直し期限` は `"YYYY-MM-DD"` のみ受け付け、形式が異なる・空なら `""`。
- `タグ` は空白またはカンマ区切り。
- 取込は**全置換**（`技術名` が空の行はスキップ）。

## 旧データ移行
なし（新規モジュール）。

## サマリー（HOME 表示）
`summary(today?)` は `技術 N件` / `保留（Hold）M件` / `期限 接近/超過 S/O件` を返す純関数（[`spec.md`](../../spec.md) §3.6）。`attention` として見直し期限の超過（error）／90日以内（warn）を申告する（HOME の要対応帯・Issue #102）。
