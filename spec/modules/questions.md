# questions — わからないこと（個人学習バックログ）（モジュール個別仕様）

統合上の位置づけ・共通マスタとの関係・固有データの所在を定める。共通の取り決め（アーキテクチャ・データ規格・名寄せ・デザイン）は [`spec.md`](../../spec.md)（共通仕様）を正とする。

- localStorage: `mk:module:questions:v1`
- ゾーン: **自分**
- 新規モジュール（旧ツールなし。「モジュールを増やして育てる」思想の実践第1弾。Issue #32）

## 役割
自分の「わからないこと」を可視化し、`未解決 → 調査中 → わかった` のループで潰していく個人向けの学習バックログ。skills（ピープル＝他人の能力の可視化）とは役割が異なり、自分ゾーンに置く。

## 共通マスタ関係
People / Project マスタは**使わない**（todo と同じく個人用途）。`tags` は自由文字列で、将来 Tech Radar 等と接続する布石とする（現状は名寄せしない）。

## 固有データ
- `items[]`: `{ id, title, detail, status, tags[], resolvedNote, createdAt, updatedAt, resolvedAt }`。`mk:module:questions:v1`。
  - `status` = `open`（未解決）/ `investigating`（調査中）/ `resolved`（わかった）。
  - `resolvedAt` は `resolved` 化時に設定、`resolved` から戻すと `null`。
- モジュール内部 ID は `q_<epoch>_<rand>`（[`spec.md`](../../spec.md) §4.7）。

## CSV
なし（JSON のみ）。

## 旧データ移行
なし（新規モジュール）。

## サマリー（HOME 表示）
`summary()` は `未解決 N件` / `今週わかった M件`（月曜起点）を返す純関数（[`spec.md`](../../spec.md) §3.6）。
