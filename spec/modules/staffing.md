# staffing — 要員計画（PJ横断のアサイン俯瞰・空き要員算出・アロケーション編集）（モジュール個別仕様）

統合上の位置づけ・共通マスタとの関係・固有データの所在を定める。共通の取り決め（アーキテクチャ・データ規格・名寄せ・デザイン）は [`spec.md`](../../spec.md)（共通仕様）を正とする。

- localStorage: **なし**（自前の永続データを持たない。計画は共有マスタ `mk:allocations` に置く）
- ゾーン: **ピープル**（主語＝人。Project 次元を横断集約する）
- scope: **global**（横断・常時。§3.7.3）

## 役割
「各 PJ で誰がアサインされ、空き要員はどれだけか」を俯瞰し、アロケーション（planning）を編集する **PJ 横断の cross ビュー**（[`spec.md`](../../spec.md) §3.7.5）。**People を主語に Project 次元を横断集約**する。

- **アロケーションの編集（planning）**を担う。メンバー×プロジェクトを期間×割当%で追加・編集・削除する（Issue #45 で workload「計画」タブから移設）。
- **PJ×メンバーのアサイン表**を基準日時点で描画する。
- **空き要員 ＝ 総キャパ − 全器へのアロケーション合計**を、メンバー別・期間軸（週）で算出・表示する。過剰アサイン（割当 > キャパ）は負の空きとして可視化する（クランプしない）。
- 単一 PJ でも自明な1件として成立する（縮退。§3.7.2）。

## データ源とモジュール独立
- **データ源は中立な共有マスタ `mk:allocations`（`人 × 器 × 期間 × 割当%`）のみ**。参照は logic の `MK.allocations.all()`、編集は view の `ctx.allocations`（`create/update/remove`）経由（[`spec.md`](../../spec.md) §3.7.5・§4.4）。**workload の logic API には依存しない**（workload を外しても要員計画は成立する。Issue #45）。
- **各モジュールの内部データ（WBS の担当 `assigneeId` 等）は覗かない**＝モジュール独立を維持する。担当合計 vs アロケーションの照合クロスは将来枠（§14）。
- 器（Project 等）は `MK.scope.dims()`（`MK_CONFIG.dimensions` 由来）を回して集める。コードで `"project"` を決め打ちしない（§3.7.6 / CONVENTIONS §3）。将来 Product を config に足せば器の次元が増える。

## 共通マスタ関係
- **Member を People マスタから参照**（横断参照。scope で縛らない。§3.7.3）。
- **器を Project マスタ（将来 Product）から参照**。いずれも読み取りのみで、マスタは変更しない。

## 固有データ
なし。総キャパシティは既定値の定数（`DEFAULT_CAPACITY = 100`%）で持ち、メンバー個別キャパのマスタは作らない（YAGNI）。将来個別化する場合は `capacityOf(memberId)` を拡張点とする。

## 集計（logic 側の純関数・テスト可能）
`MK.logic.staffing`。いずれもアロケーション配列を引数に取り副作用を持たない（`test/staffing.test.js`）。

- `cellPercent(allocations, mid, targetId, date)` … アサイン表1セルの割当%（member×target×期間で合算）。
- `totalPercent(allocations, mid, date)` … 全器合計割当%（共有マスタの集計純関数 `MK.allocations.percentOn` へ委譲）。
- `freeOn(allocations, mid, date, capacity?)` … 空き% ＝ キャパ − 全器合計割当（過剰は負値）。
- `freeSeries(allocations, mid, weeks, capacity?)` … 週サンプルごとの空き系列（期間軸）。
- `overviewOn(allocations, members, targets, date, capacity?)` … 器別割当行＋メンバー別割当合計・空きの一括算出。
- `summary()` … HOME カード（本日時点の平均空き / 過剰アサイン人数。§3.6）。

## CSV
なし（自前データを持たないため）。

## 旧データ移行
自前の永続データは持たない。編集するアロケーションは共有マスタ `mk:allocations` に保存され、バックアップ（JSON エンベロープ）ではトップレベルの `allocations` として保全される（[`spec.md`](../../spec.md) §4.2）。workload からの昇格移行は [`workload.md`](workload.md) を参照（起動時に一度だけ移設・冪等・Issue #45）。
