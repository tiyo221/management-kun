# daily — デイリー（今日のタイムボクシング）（モジュール個別仕様）

統合上の位置づけ・共通マスタとの関係・固有データの所在を定める。共通の取り決め（アーキテクチャ・データ規格・デザイン）は [`spec.md`](../../spec.md)（共通仕様）を正とする。

- localStorage: `mk:module:daily:v1`
- ゾーン: **自分**
- スコープ: `global`（§3.7.3）
- 起票 Issue: #213

## 役割

「今日1日で何をやるか」をざっくり組み立て、夕方に残りを翌日へ送るための **タイムボクシング** ツール。todo（GTD ToDo）がタスクの「リスト（何が残っているか）」を担うのに対し、本モジュールは「1日の器（今日どう時間を使うか）」を担う**別レイヤー**。両者は統合せず独立させる（[`todo.md`](todo.md) と `todo/questions 独立` の判断と同じ構図）。

GTD の日次サイクルを回す: **今日の候補を洗い出す → 所要時間を付けて時間割に積む → 夜、残りを翌日へ繰り越す**。

## 共通マスタ関係

担当者概念は持たない（個人用途）。People / Project マスタは直接は参照しない。todo から引いた項目は、表示のためだけに `todo.projectNameOf()` でプロジェクト名を解決して見せることがあるが、マスタへは書き込まない。

## todo 連携（cross-module）

- **引ける対象は todo の `next` のみ**。inbox / waiting / someday は「今日やる候補」ではないため引けない（GTD の Next Action ＝今日やる具体行動）。
- **同じ todo は同時に1つの日にしか載らない**。未完了のままいずれかの日に載っている todo は候補から外す（`activeTodoIds()`）。実体（todo）は1つなので複数日に載ると完了同期が片方にしか効かず不整合になるため。日を移すのは繰り越し（`rolloverTo`）が正規の経路。
- **実体は todo が持つ**。デイリー項目は `todoId` で参照し、表示用にタイトルをスナップショットするだけ。
- **完了は双方向で揃う（todo が正）**:
  - デイリー → todo: 由来が todo の項目を完了/解除すると `MK.logic.todo.toggleDone()` で todo 側も `done`/`next` に揃える。
  - todo → デイリー: **表示・集計上の完了は常に todo の状態から解決する**（`resolveDone()` / `resolvedItems()`）。`DailyItem.done` は表示用スナップショットに過ぎない。ToDo 画面側で完了した項目がデイリーで未完のまま「今日の残り」に居座り、毎日繰り越され続ける（todo は done なので再引き込みもできず解消不能）事故を防ぐため。
  - todo モジュール未搭載・todo 実体が消えている場合のみ、スナップショット（`done`）へフォールバックする。
- **手書き項目（`source:"manual"`）は完全にデイリー内で完結**（todo 非連動・完了同期なし）。
- todo モジュール未搭載の配布構成では、`pullableTodos()` は空配列を返し、手書き項目だけで成立する（跨りは防御的に握る）。

## 固有データ

`mk:module:daily:v1` に「日付フィールドを持つフラットな `items[]` 配列」1本で保持する（日ごとの器は `date` で絞って表現し、日別 namespace は作らない）。

```
{ version: 1, startTime: "09:00", items: [ DailyItem, ... ] }
```

- `startTime`: 時間割を積み始める単一の開始起点（"HH:MM"・記憶する。未設定時は 09:00）。
- `DailyItem`: `{ id, date, title, minutes, done, source, todoId, createdAt, updatedAt }`
  - `id` … `d_<epoch>_<rand>`（[`spec.md`](../../spec.md) §4.7）。
  - `date` … 所属する日（"YYYY-MM-DD"）。同日内の**配列順がそのまま時間割の積み上げ順**。
  - `minutes` … 所要時間（分・正の整数。プリセット選択 15/30/45/60/90/120）。
  - `source` … `"todo"`（todo から引いた）/ `"manual"`（デイリー限定の手書き）。
  - `todoId` … `source:"todo"` のときの由来 todo タスクID（完了同期に使う。manual は `null`）。

## 時間割（自動積み上げ・A方式）

`schedule(date, startOverride?)` が純関数で各項目の開始・終了時刻を算出する。開始起点から所要時間ぶんを順に積み、`↑ / ↓`（`moveItem`）で並べ替えると時刻が前後する（ドラッグ&ドロップは使わない）。合計時間・終了時刻・24 時以降のはみ出し（`overflow`）を可視化する。

## 繰り越し

`rolloverTo(fromDate, toDate)` が指定日の**未完了項目だけ**を翌日の末尾へ移す（完了はその日に履歴として残す）。todo 由来項目は `todoId` の紐付けを保ったまま翌日に付く。

## サマリー（HOME 表示）

`summary(today?)` は `{ empty, stats, attention }`（[`spec.md`](../../spec.md) §3.6）。

- `stats`: `今日の残り`（今日の未完了件数＝残作業）／`予定終了`（時間割の終了時刻。項目ゼロなら "—"）。母数は出さない（§3.6 方針①）。
- `attention`: `前日までの未処理 N件`（warn・繰り越し/整理の一手を促す）／`今日の予定が日をまたぎます`（warn・`overflow` 時）。

## グローバル検索

**`searchItems()` は実装しない（意図的な除外）**。todo 由来項目は todo 側の検索で引けるため二重ヒットになり、手書き項目も「その日限りの器の中身」で検索の主対象になりにくい。必要になったら別 Issue で足す（YAGNI）。

## JSON 取り込みの正規化

`importData` は外部 JSON（手書き・AI 生成もありうる）を寛容に受けて寄せる: `id` 欠落は採番、`date` は不正・欠落なら当日、`minutes` は正の整数（プリセット外も許容）、`done` は真偽値、`startTime` は不正なら既定。id を補完するのは、`mergeById` が `byId[undefined]` へ集約して取りこぼすため／id 一致で引く `moveItem` 等が誤ヒットするため。

## CSV

CSV 入出力は持たない（第一弾スコープ外・releases 同様）。バックアップは JSON エクスポート/インポートで行う。

## 旧データ移行

新規モジュールのため移行元なし。
