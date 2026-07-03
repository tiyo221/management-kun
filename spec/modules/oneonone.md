# oneonone — 1on1メモ（EM 向け対話ログ）（モジュール個別仕様）

統合上の位置づけ・共通マスタとの関係・固有データの所在を定める。共通の取り決め（アーキテクチャ・データ規格・名寄せ・デザイン）は [`spec.md`](../../spec.md)（共通仕様）を正とする。

- localStorage: `mk:module:oneonone:v1`（global scope）
- ゾーン: **ピープル**
- 新規モジュール（旧ツールなし。Issue #33）

## 役割
メンバーごとの 1on1 の記録・ネクストアクションを管理する EM 向けモジュール。skills / workload が「数字で見る人」なのに対し、これは「対話で見る人」でピープルゾーンの穴を埋める。メンバーを選ぶと、その人の 1on1 タイムライン（新しい順）と未完アクション一覧を俯瞰できる。

## 機微情報（重要）
1on1 の内容は個人の機微情報を含むため、**メンバー配布プロファイルには自動的に搭載しない**。ピープルゾーンは `member.html`（自分ゾーンのみ）に載らない構成のため、oneonone は `index.html`（マネージャ用シェル）にのみ登録し、`member.html` には**登録しない**。この分離を運用ルールとして固定する。

## 共通マスタ関係
- **People マスタを参照**する（`memberId`）。参照のみで、マスタ本体は書き換えない（`MK.people` 経由で読み取る）。
- **Project マスタは使わない**。
- メンバー選択のプルダウンにはアクティブなメンバー（`active !== false`）を並べる。退職メンバー（`active:false`）や、マスタから削除された参照切れメンバーでも、記録が残っていれば過去ログ閲覧のため選択肢に残す（退職者は「（退職）」表示）。
- `memberId` の参照が壊れていても（該当メンバーがマスタに存在しなくても）モジュールは起動し、「(不明なメンバー)」として表示する。

## 固有データ
- `entries[]`: `{ id, memberId, date, body, actions[], mood, createdAt, updatedAt }`。`mk:module:oneonone:v1`。
  - `memberId`: People マスタ参照（必須）。
  - `date`: 実施日（`YYYY-MM-DD`）。
  - `body`: 話したこと（自由記述）。
  - `actions[]`: `{ id, text, done, due }`。`due` は `YYYY-MM-DD` または `null`。
  - `mood`: `good` / `normal` / `bad` / `null`（任意の温度感）。
- モジュール内部 ID はエントリ `o_<epoch>_<rand>`、アクション `a_<epoch>_<rand>`（[`spec.md`](../../spec.md) §4.7）。

## CSV
なし（JSON のみ）。

## 旧データ移行
なし（新規モジュール）。

## サマリー（HOME 表示）
`summary()` は `未完アクション N件` / `記録数 M件` を返す純関数（[`spec.md`](../../spec.md) §3.6）。
