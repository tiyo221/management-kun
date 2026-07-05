# todo — GTD ToDo（旧 todo-kun）（モジュール個別仕様）

統合上の位置づけ・共通マスタとの関係・固有データの所在を定める。共通の取り決め（アーキテクチャ・データ規格・名寄せ・デザイン）は [`spec.md`](../../spec.md)（共通仕様）を正とする。機能の詳細挙動は旧ツールの仕様を正とする。

- 参照（機能詳細の正）: [todo-kun/spec.md](../../../todo-kun/spec.md)
- localStorage: `mk:module:todo:v1`
- ゾーン: **自分**

## 役割
GTD ベースの軽量タスク管理。

## 共通マスタ関係
`project`（自由文字列）を **Project マスタへ名寄せ**（`projectId` 参照 + 後方互換の文字列保持。[`import-migration.md`](../import-migration.md) §8）。担当者概念は持たない（個人用途のため People は使わない）。

## 固有データ
- `tasks[]`（`status` = inbox / next / waiting / someday / done、`contexts`、`due` 等）。`mk:module:todo:v1`。
- モジュール内部 ID は既存方式 `t_<epoch>_<rand>` を踏襲（[`spec.md`](../../spec.md) §4.7）。

## CSV
共通契約は [`import-migration.md`](../import-migration.md) §4.6.2（Issue #77）。

- 列: `タイトル, ステータス, プロジェクト, コンテキスト, 期限, メモ`。
- `タイトル` は必須（空の行はスキップし件数に数える）。
- `ステータス` は key（`inbox` / `next` / `waiting` / `someday` / `done`）または表示ラベル（Inbox / Next / Waiting / Someday / Done）を受け付け、不明・空は `inbox` に寄せる。
- `プロジェクト` は**名前**参照（§8 名寄せ。未登録は新規作成、空は未割当 `null`）。出力時はプロジェクト名へ展開。
- `コンテキスト` は空白またはカンマ区切り（出力は空白区切り）。
- `期限` は `YYYY-MM-DD`（空は未設定 `null`）。
- 取込は**全置換**。`createdAt` / `updatedAt` は取込時刻で再生成し、`completedAt` は `ステータス=done` のとき取込時刻を入れる。

## 旧データ移行
| 旧キー / 形状 | 移行先 |
|---|---|
| `todo-kun.data.v1` `{version, exportedAt, tasks}` | `mk:module:todo:v1`、`project` 文字列 → Project 名寄せ |

移行フロー全体は [`import-migration.md`](../import-migration.md) §7、名寄せは §8 を参照。

## サマリー（HOME 表示）
`summary(today?)` は `未完 N` / `全タスク M` を返す純関数（[`spec.md`](../../spec.md) §3.6）。`attention` として期限切れ（error）／今日期限（warn）の件数を申告する（HOME の要対応帯・Issue #102。完了と期限未設定は対象外＝`dueCounts(today?)`）。
