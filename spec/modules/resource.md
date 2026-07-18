# resource — リソース（人単位×3つの意思決定：不足人数・外注要否・メンバー負担）（モジュール個別仕様）

統合上の位置づけ・共通マスタとの関係・固有データの所在を定める。共通の取り決め（アーキテクチャ・データ規格・名寄せ・デザイン）は [`spec.md`](../../spec.md)（共通仕様）を正とする。旧 `staffing`（要員計画）を発展させ、`workload`（タスク負荷）を降格した統合モジュール（Issue #52）。データを機能別に並べる構成から「人単位×3つの意思決定」へ作り直した（Issue #71）。

- localStorage: **なし**（自前の永続データを持たない。供給計画は共有マスタ `mk:allocations`、需要は共有マスタ `mk:demands` に置く）
- ゾーン: **ピープル**（主語＝人。Project 次元を横断集約する）
- scope: **global**（横断・常時。§3.7.3）

## 役割
マネージャの3つの問いに月次で答える **PJ 横断の cross ビュー**（[`spec.md`](../../spec.md) §3.7.5）。**People を主語に Project 次元を横断集約**し、アロケーション（画面表示は「アサイン」・planning）を編集する。時間軸は **月次×長ホライズン**（週次は「見えても確保が間に合わない」ため見せない）。**主単位は人（FTE、1人＝100%）**とし、`必要 2.0人 / 確保 1.1人 / あと 0.9人不足` のように表す（% は補助表記）。

画面は3つの問いに 1:1 で対応するカード＋入力カードで構成する:

1. **① あと何人足りない？** — PJ（×ロール）別×月別の不足人数（`gap = 需要 − その器への割当合計`、人単位。ロール計画時は「器 × ロール」で算出＝下記）。月ごとの不足合計は **不足している行の gap のみを合算**する（他 PJ の余剰で相殺しない）。
2. **② 外注が要る？** — 不足（①の合計）を**チームの空き要員で吸収できるか**を月次で判定する。チームの空きはメンバーごとの空き（キャパ − 割当）を **0 で下限クランプ**して合算（過負担の負の空きは原資にならない）。吸収しきれない分＝**外注候補**として人数で提示する（「足りない」と「外注」を繋ぐ意思決定）。
3. **③ メンバーの負担は大丈夫？** — メンバー別×月別の負荷（全器合計割当）を人単位で示し、**1人分（100%）を超える月を強調**する（降格した workload「負担」の問いを task ではなく allocation ベースで戻したもの）。
4. **計画の入力** — アロケーション（供給・画面表示は「アサイン」）と需要（画面表示は「必要人数」）のレコードを追加・編集・削除する（判断のもとになるデータ）。

- 単一 PJ でも自明な1件として成立する（縮退。§3.7.2）。
- demand を手入力する限り不足は入力値の引き算に過ぎない。WBS 見積り等から demand を自動生成する件は後続（生成器が `mk:demands` に書き込む独立設計は #68 で用意済み。#71 スコープ外）。

## ロール（役割）計画（Issue #134）
計画段階では「〇〇エンジニアが2名必要」のように**ロールで計画**を立て、後からその役割に適したメンバーを充当する方が実態に合う。needs（`mk:demands`）に **`role`（任意・自由文字列）** を持たせて実現する。

- **ロール = 自由文字列**（`People.role` と同じ職種名の語彙を流用。**新マスタは作らない**）。`role` 空なら従来通り＝役割を問わない需要（**後方互換**）。
- **不足①を「器 × ロール」で算出**: `gap = 必要人数(器, ロール) − その器へ割り当てられた そのロールのメンバー合計`。ロール未使用時は器単位に縮退（互換）。
- **供給（アサイン）はメンバー基準のまま**。供給のロールは割当メンバーの `member.role` から導出する（**allocation にロールは保存しない**＝マスタを汚さない）。マッチングは**正規化後（trim + 小文字化）の完全一致**。`People.role`「エンジニア」と需要「バックエンドエンジニア」は別物扱い（運用でロール名を揃える前提。サンプルデータも整合させる）。
- **ロール入力は共有語彙から選択**（`datalist`）: 候補＝`People.role` の既出値 ∪ 既存需要で使われた `role`。**自由入力も残す**（外注前提の未登録ロールに対応）。外注ロールは供給が集まらず不足として残り、②で外注候補に出る。
- **アサイン編集にロール絞り込み**を付け、選んだロールに属するメンバーだけを候補にする（編集中の器に必要人数のあるロールを優先表示）。
- **②の外注判定もロール別**: そのロールの不足は同じロールのメンバーの空きでしか吸収できない（役割ミスマッチは吸収されない）。吸収は**単一の空きプールから消費**する（同じメンバーの空きを複数ロールで二重計上しない）＝制約の強いロール指定の不足を先に自ロールの空きから消費し、役割を問わない（ロール空）不足は「総空き − ロール指定で消費済み」の**残余（誰でも良い枠）**から吸収する。これにより外注前提のロール（内部に該当者なし）の不足は吸収されず外注候補として残る。
- **同一器でのロール空／ロール指定の混在は非対応**: 1つの器はロール別 or 役割を問わない、の**どちらか**で計画する。混在させると器×ロール集計で供給が二重計上され不足を過小評価するため、入力段階で防止する（`editDemand` の保存時にトーストで拒否）。厳密な充当（スロット割当）は YAGNI として持たない。

### 昇格トリガー（YAGNI・[`masters.md`](../masters.md) §4.4.1 の共通契約フルセットを背負うため今は Role マスタを作らない）
次のいずれかが具体化したら Role マスタへ切り出す（`datalist` → select-from-master への差し替えで移行）:
1. ロールに固有属性が要る（**外注単価による外注費見積り**＝予算計画・既定 FTE・表示色・並び順 など）
2. 語彙を中央で統治したい（一括リネーム・廃止管理 など）

## workload（タスク負荷）との関係（Issue #52 → 退役 #167）
task ベースの負荷可視化（旧 `workload`）は、実運用で要員計画（allocation）が主軸となるため**対等統合しなかった**。workload はナビ（ZONES）から降格（#52）した後、機能的に死んでいたため **Issue #167 で退役・撤去**した（実装・登録・CSS・テストを削除）。resource は workload の task データに依存しないため、撤去してもアロケーションと要員計画は成立する。旧 workload 内部のアロケーションは起動時の store レベル終端移行が共有マスタへ吸い上げて保全する（[`workload.md`](workload.md) 退役記録・`MK.allocations.migrateFromWorkload()`）。

## データ源とモジュール独立
- **供給の源は中立な共有マスタ `mk:allocations`（`人 × 器 × 期間 × 割当%`）**。参照は logic の `MK.allocations.all()`、編集は view の `ctx.allocations`（`create/update/remove`）経由（[`spec.md`](../../spec.md) §3.7.5・§4.4）。
- **需要の源は中立な共有マスタ `mk:demands`（`器 × 期間 × 必要%`）**（[`masters.md`](../masters.md)）。参照は `MK.demands.all()`、編集は `ctx.demands` 経由。
- **各モジュールの内部データ（WBS の担当 `assigneeId` 等）は覗かない**＝モジュール独立を維持する。将来 wbs 見積り等から需要を自動生成する場合も、生成器が `mk:demands` に**書き込む**方式にし、resource が他モジュールを読むことはない。
- 器（Project 等）は `MK.scope.dims()`（`MK_CONFIG.dimensions` 由来）を回して集める。コードで `"project"` を決め打ちしない（§3.7.6 / CONVENTIONS §3）。

## 共通マスタ関係
- **Member を People マスタから参照**（横断参照。scope で縛らない。§3.7.3）。
- **器を Project マスタ（将来 Product）から参照**。いずれも読み取りのみで、マスタは変更しない。
- **Allocation / Demand マスタ**を編集・俯瞰する（[`masters.md`](../masters.md)）。

## 任意契約の採否（searchItems / summaryFor）
グローバル検索（[`spec.md`](../../spec.md) §3.5）と人／PJ 詳細の集約（§3.6.1）は任意契約。採否を固着させる（#220）。
- **searchItems**: 見送り。月次のアロケーション（人×PJ×%）は自由記述の本文を持たず、Ctrl+K で「開いて読む一次レコード」にならない集約ビュー。人・PJ 自体はマスタ側で引ける。
- **summaryFor**: 実装。人詳細の集約ビュー（#83）向けに `summaryFor("person", memberId)` を実装する。その人の**本日時点のアサイン状況**＝現在の割当（FTE）・稼働中PJ 件数を返し、割当が**1人分（100%）を超える**場合は `attention`（`warn`）で申告する。割当が1件も無ければ `empty:true`。`person` 以外の種別（`project` 等）は該当なし（`empty:true`）で応え、プロジェクト集約は dashboard（#78）に委ねる。集計は `MK.logic.resource.summaryFor`（純関数・`test/summary-for.test.js`）。

## 固有データ
なし。総キャパシティは既定値の定数（`DEFAULT_CAPACITY = 100`% ＝1人分）で持ち、メンバー個別キャパのマスタは作らない（YAGNI）。将来個別化する場合は `capacityOf(memberId)` を拡張点とする。データは % で持ち、**人（FTE）は表示時に換算**する（保存形式は変えない）。

## 集計（logic 側の純関数・テスト可能）
`MK.logic.resource`。いずれも配列を引数に取り副作用を持たない（`test/resource.test.js`）。

- `fteLabel(percent)` … % → 人（FTE）の表示ラベル（小数1桁。例 `90 → "0.9人"`）。
- `totalPercent(allocations, mid, date)` … 全器合計割当%（共有マスタの集計純関数 `MK.allocations.percentOn` へ委譲）。
- `freeOn(allocations, mid, date, capacity?)` … 空き% ＝ キャパ − 全器合計割当（過負担は負値・クランプしない）。
- `monthsInHorizon(period, offset?, baseDate?)` … ホライズン（週数）を月次に丸めた対象月（月初日）配列。`baseDate` はテスト用の注入点（既定 本日）。
- `targetDemandOn(demands, targetId, date)` / `targetSupplyOn(allocations, targetId, date)` … 器単位の需要% / 確保済み供給%。
- `normRole(s)` … ロール照合用の正規化（trim + 小文字化）。`rolesForTarget(demands, targetId)` … 器の需要で使われたロール一覧（正規化キーで一意化・原文ラベル保持）。
- `targetDemandByRole(demands, targetId, roleNorm, date)` / `targetSupplyByRole(allocations, targetId, roleNorm, date, roleOf)` … 器×ロール単位の需要% / 供給%（供給のロールは `roleOf`＝memberId→ロールのマップから導出。roleNorm 空＝器単位に縮退）。
- `shortageMatrix(allocations, demands, targets, months, members?)` … 問い①。**器×ロール別**×月別の `gap = 需要 − 供給` と、月ごとの不足合計（`Σ max(0, gap)`）。`members` から供給のロールを導出（省略時はロール空の需要のみ機能）。
- `teamFreeOn(allocations, members, date, capacity?)` … チームの空き%合計（メンバーごとに 0 で下限クランプ）。`teamFreeByRole(allocations, members, date, roleNorm, capacity?, roleOf?)` … 指定ロールのメンバーだけの空き%合計（roleNorm 空＝全メンバー）。
- `outsourcingByMonth(allocations, demands, targets, members, months, capacity?)` … 問い②。月ごとの不足・チームの空き・内部吸収分・外注候補・外注要否。**吸収はロール別**（外注前提のロールは吸収されず残る）。
- `roleVocabulary(members, demands)` … ロール入力の候補語彙（`People.role` ∪ 既存需要 role。正規化で重複排除）。datalist 用。
- `memberLoadByMonth(allocations, members, months, capacity?)` … 問い③。メンバー別×月別の割当・1人分超えフラグ・超過分・ピーク。
- `summary(baseDate?)` … HOME カード（本日時点の空き要員（人）/ 過負担人数。§3.6）。過負担がいれば `attention`（`warn`）で「誰が過負荷か」を昇格する（例:「過負荷: 佐藤 (1.3人分)」、複数人は「代表 ほかN人」に畳む。#181）。0 人なら申告しない。

## CSV
なし（自前データを持たないため）。

## 旧データ移行
自前の永続データは持たない。編集するアロケーションは共有マスタ `mk:allocations` に保存され、バックアップ（JSON エンベロープ）ではトップレベルの `allocations` として保全される（[`spec.md`](../../spec.md) §4.2）。退役した workload 名前空間からのアロケーション吸い上げ移行は起動時に一度だけ実行され、吸い上げ後は `mk:module:workload` キーを破棄する（`MK.allocations.migrateFromWorkload()`・冪等・Issue #45 / #167）。
