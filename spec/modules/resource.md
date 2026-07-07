# resource — リソース（人単位×3つの意思決定：不足人数・外注要否・メンバー負担）（モジュール個別仕様）

統合上の位置づけ・共通マスタとの関係・固有データの所在を定める。共通の取り決め（アーキテクチャ・データ規格・名寄せ・デザイン）は [`spec.md`](../../spec.md)（共通仕様）を正とする。旧 `staffing`（要員計画）を発展させ、`workload`（タスク負荷）を降格した統合モジュール（Issue #52）。データを機能別に並べる構成から「人単位×3つの意思決定」へ作り直した（Issue #71）。

- localStorage: **なし**（自前の永続データを持たない。供給計画は共有マスタ `mk:allocations`、需要は共有マスタ `mk:demands` に置く）
- ゾーン: **ピープル**（主語＝人。Project 次元を横断集約する）
- scope: **global**（横断・常時。§3.7.3）

## 役割
マネージャの3つの問いに月次で答える **PJ 横断の cross ビュー**（[`spec.md`](../../spec.md) §3.7.5）。**People を主語に Project 次元を横断集約**し、アロケーション（画面表示は「アサイン」・planning）を編集する。時間軸は **月次×長ホライズン**（週次は「見えても確保が間に合わない」ため見せない）。**主単位は人（FTE、1人＝100%）**とし、`必要 2.0人 / 確保 1.1人 / あと 0.9人不足` のように表す（% は補助表記）。

画面は3つの問いに 1:1 で対応するカード＋入力カードで構成する:

1. **① あと何人足りない？** — PJ別×月別の不足人数（`gap = 需要 − その器への割当合計`、人単位）。月ごとの不足合計は **不足している器の gap のみを合算**する（他 PJ の余剰で相殺しない）。
2. **② 外注が要る？** — 不足（①の合計）を**チームの空き要員で吸収できるか**を月次で判定する。チームの空きはメンバーごとの空き（キャパ − 割当）を **0 で下限クランプ**して合算（過負担の負の空きは原資にならない）。吸収しきれない分＝**外注候補**として人数で提示する（「足りない」と「外注」を繋ぐ意思決定）。
3. **③ メンバーの負担は大丈夫？** — メンバー別×月別の負荷（全器合計割当）を人単位で示し、**1人分（100%）を超える月を強調**する（降格した workload「負担」の問いを task ではなく allocation ベースで戻したもの）。
4. **計画の入力** — アロケーション（供給・画面表示は「アサイン」）と需要（画面表示は「必要人数」）のレコードを追加・編集・削除する（判断のもとになるデータ）。

- 単一 PJ でも自明な1件として成立する（縮退。§3.7.2）。
- demand を手入力する限り不足は入力値の引き算に過ぎない。WBS 見積り等から demand を自動生成する件は後続（生成器が `mk:demands` に書き込む独立設計は #68 で用意済み。#71 スコープ外）。

## workload（タスク負荷）との関係（Issue #52）
task ベースの負荷可視化（旧 `workload`）は、実運用で要員計画（allocation）が主軸となるため**対等統合しない**。workload はナビ（ZONES）から外して降格したが、**モジュール登録・データ（`mk:module:workload:v1`）は保全**する（UI から外すがデータは失わない・全体 JSON エクスポートで round-trip）。resource は workload の task データには依存しない。

## データ源とモジュール独立
- **供給の源は中立な共有マスタ `mk:allocations`（`人 × 器 × 期間 × 割当%`）**。参照は logic の `MK.allocations.all()`、編集は view の `ctx.allocations`（`create/update/remove`）経由（[`spec.md`](../../spec.md) §3.7.5・§4.4）。
- **需要の源は中立な共有マスタ `mk:demands`（`器 × 期間 × 必要%`）**（[`masters.md`](../masters.md)）。参照は `MK.demands.all()`、編集は `ctx.demands` 経由。
- **各モジュールの内部データ（WBS の担当 `assigneeId`、workload のタスク等）は覗かない**＝モジュール独立を維持する。将来 wbs 見積り等から需要を自動生成する場合も、生成器が `mk:demands` に**書き込む**方式にし、resource が他モジュールを読むことはない。
- 器（Project 等）は `MK.scope.dims()`（`MK_CONFIG.dimensions` 由来）を回して集める。コードで `"project"` を決め打ちしない（§3.7.6 / CONVENTIONS §3）。

## 共通マスタ関係
- **Member を People マスタから参照**（横断参照。scope で縛らない。§3.7.3）。
- **器を Project マスタ（将来 Product）から参照**。いずれも読み取りのみで、マスタは変更しない。
- **Allocation / Demand マスタ**を編集・俯瞰する（[`masters.md`](../masters.md)）。

## エンティティ集約（`summaryFor`・[`spec.md`](../../spec.md) §3.6.1）
人詳細の集約ビュー（#83）向けに `summaryFor("person", memberId)` を実装する。その人の**本日時点のアサイン状況**＝現在の割当（FTE）・稼働中PJ 件数を返し、割当が**1人分（100%）を超える**場合は `attention`（`warn`）で申告する。割当が1件も無ければ `empty:true`。`person` 以外の種別（`project` 等）は該当なし（`empty:true`）で応え、プロジェクト集約は dashboard（#78）に委ねる。集計は `MK.logic.resource.summaryFor`（純関数・`test/summary-for.test.js`）。

## 固有データ
なし。総キャパシティは既定値の定数（`DEFAULT_CAPACITY = 100`% ＝1人分）で持ち、メンバー個別キャパのマスタは作らない（YAGNI）。将来個別化する場合は `capacityOf(memberId)` を拡張点とする。データは % で持ち、**人（FTE）は表示時に換算**する（保存形式は変えない）。

## 集計（logic 側の純関数・テスト可能）
`MK.logic.resource`。いずれも配列を引数に取り副作用を持たない（`test/resource.test.js`）。

- `fteLabel(percent)` … % → 人（FTE）の表示ラベル（小数1桁。例 `90 → "0.9人"`）。
- `totalPercent(allocations, mid, date)` … 全器合計割当%（共有マスタの集計純関数 `MK.allocations.percentOn` へ委譲）。
- `freeOn(allocations, mid, date, capacity?)` … 空き% ＝ キャパ − 全器合計割当（過負担は負値・クランプしない）。
- `monthsInHorizon(period, offset?, baseDate?)` … ホライズン（週数）を月次に丸めた対象月（月初日）配列。`baseDate` はテスト用の注入点（既定 本日）。
- `targetDemandOn(demands, targetId, date)` / `targetSupplyOn(allocations, targetId, date)` … 器単位の需要% / 確保済み供給%。
- `shortageMatrix(allocations, demands, targets, months)` … 問い①。PJ別×月別の `gap = 需要 − 供給` と、月ごとの不足合計（`Σ max(0, gap)`）。
- `teamFreeOn(allocations, members, date, capacity?)` … チームの空き%合計（メンバーごとに 0 で下限クランプ）。
- `outsourcingByMonth(allocations, demands, targets, members, months, capacity?)` … 問い②。月ごとの不足・チームの空き・内部吸収分・外注候補・外注要否。
- `memberLoadByMonth(allocations, members, months, capacity?)` … 問い③。メンバー別×月別の割当・1人分超えフラグ・超過分・ピーク。
- `summary()` … HOME カード（本日時点の空き要員（人）/ 過負担人数。§3.6）。

## CSV
なし（自前データを持たないため）。

## 旧データ移行
自前の永続データは持たない。編集するアロケーションは共有マスタ `mk:allocations` に保存され、バックアップ（JSON エンベロープ）ではトップレベルの `allocations` として保全される（[`spec.md`](../../spec.md) §4.2）。workload からのアロケーション昇格移行は起動時に一度だけ実行される（`MK.allocations.migrateFromWorkload()`・冪等・Issue #45）。
