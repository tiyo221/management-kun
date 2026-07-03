# resource — リソース（要員計画・アサイン俯瞰・空き要員・月次供給／需要）（モジュール個別仕様）

統合上の位置づけ・共通マスタとの関係・固有データの所在を定める。共通の取り決め（アーキテクチャ・データ規格・名寄せ・デザイン）は [`spec.md`](../../spec.md)（共通仕様）を正とする。旧 `staffing`（要員計画）を発展させ、`workload`（タスク負荷）を降格した統合モジュール（Issue #52）。

- localStorage: **なし**（自前の永続データを持たない。供給計画は共有マスタ `mk:allocations`、需要は共有マスタ `mk:demands` に置く）
- ゾーン: **ピープル**（主語＝人。Project 次元を横断集約する）
- scope: **global**（横断・常時。§3.7.3）

## 役割
「各 PJ で誰がアサインされ、空き要員はどれだけか」を俯瞰し、アロケーション（planning）を編集する **PJ 横断の cross ビュー**（[`spec.md`](../../spec.md) §3.7.5）。**People を主語に Project 次元を横断集約**する。要員確保の意思決定に効くよう、時間軸は **月次×長ホライズン**（週次は「見えても確保が間に合わない」ためカードにしない）。

- **アロケーションの編集（planning）**を担う。メンバー×プロジェクトを期間×割当%で追加・編集・削除する。
- **PJ×メンバーのアサイン表**を基準日時点で描画する。
- **空き要員 ＝ 総キャパ − 全器へのアロケーション合計**を、メンバー別・期間軸（週）で算出・表示する。過剰アサイン（割当 > キャパ）は負の空きとして可視化する（クランプしない）。
- **月ごとの供給とキャパ**を集計し、供給（割当合計）がキャパを超える月＝オーバーコミットと、空きが尽きる月を早期警告する（要員確保のリードタイムを残す）。
- **需要（demand）× 供給**の月次ギャップを表示し、「いつまでに・何人分確保が必要か」を示す。demand は共有マスタ `mk:demands`（`gap = 需要 − 約束済み供給`。gap>0 の月＝確保デッドライン。Issue #68）。
- 単一 PJ でも自明な1件として成立する（縮退。§3.7.2）。

## workload（タスク負荷）との関係（Issue #52）
task ベースの負荷可視化（旧 `workload`）は、実運用で要員計画（allocation）が主軸となるため**対等統合しない**。workload はナビ（ZONES）から外して降格したが、**モジュール登録・データ（`mk:module:workload:v1`）は保全**する（UI から外すがデータは失わない・全体 JSON エクスポートで round-trip）。resource は workload の task データには依存しない。

## データ源とモジュール独立
- **供給の源は中立な共有マスタ `mk:allocations`（`人 × 器 × 期間 × 割当%`）**。参照は logic の `MK.allocations.all()`、編集は view の `ctx.allocations`（`create/update/remove`）経由（[`spec.md`](../../spec.md) §3.7.5・§4.4）。
- **需要の源は中立な共有マスタ `mk:demands`（`器 × 期間 × 必要%`）**（Phase 2。[`masters.md`](../masters.md)）。参照は `MK.demands.all()`、編集は `ctx.demands` 経由。
- **各モジュールの内部データ（WBS の担当 `assigneeId`、workload のタスク等）は覗かない**＝モジュール独立を維持する。将来 wbs 見積り等から需要を自動生成する場合も、生成器が `mk:demands` に**書き込む**方式にし、resource が他モジュールを読むことはない。
- 器（Project 等）は `MK.scope.dims()`（`MK_CONFIG.dimensions` 由来）を回して集める。コードで `"project"` を決め打ちしない（§3.7.6 / CONVENTIONS §3）。

## 共通マスタ関係
- **Member を People マスタから参照**（横断参照。scope で縛らない。§3.7.3）。
- **器を Project マスタ（将来 Product）から参照**。いずれも読み取りのみで、マスタは変更しない。
- **Allocation / Demand マスタ**を編集・俯瞰する（[`masters.md`](../masters.md)）。

## 固有データ
なし。総キャパシティは既定値の定数（`DEFAULT_CAPACITY = 100`%）で持ち、メンバー個別キャパのマスタは作らない（YAGNI）。将来個別化する場合は `capacityOf(memberId)` を拡張点とする。

## 集計（logic 側の純関数・テスト可能）
`MK.logic.resource`。いずれも配列を引数に取り副作用を持たない（`test/resource.test.js`）。

- `cellPercent(allocations, mid, targetId, date)` … アサイン表1セルの割当%（member×target×期間で合算）。
- `totalPercent(allocations, mid, date)` … 全器合計割当%（共有マスタの集計純関数 `MK.allocations.percentOn` へ委譲）。
- `freeOn(allocations, mid, date, capacity?)` … 空き% ＝ キャパ − 全器合計割当（過剰は負値）。
- `freeSeries(allocations, mid, weeks, capacity?)` … 週サンプルごとの空き系列（期間軸）。
- `overviewOn(allocations, members, targets, date, capacity?)` … 器別割当行＋メンバー別割当合計・空きの一括算出。
- `monthsInHorizon(period, offset?, baseDate?)` … ホライズン（週数）を月次に丸めた対象月（月初日）配列。`baseDate` はテスト用の注入点（既定 本日）。
- `supplyByMonth(allocations, members, months, capacity?)` … 月ごとの総割当・総キャパ・空き・過剰人数。
- `demandByMonth(demands, months)` … 月ごとの総需要。
- `gapByMonth(allocations, demands, months)` … 月ごとの需要・供給・ギャップ（`gap = 需要 − 約束済み供給`、正なら不足）・不足フラグ。
- `summary()` … HOME カード（本日時点の平均空き / 過剰アサイン人数。§3.6）。

## CSV
なし（自前データを持たないため）。

## 旧データ移行
自前の永続データは持たない。編集するアロケーションは共有マスタ `mk:allocations` に保存され、バックアップ（JSON エンベロープ）ではトップレベルの `allocations` として保全される（[`spec.md`](../../spec.md) §4.2）。workload からのアロケーション昇格移行は起動時に一度だけ実行される（`MK.allocations.migrateFromWorkload()`・冪等・Issue #45）。
