# 共通マスタ 仕様（masters.md）— 共通データ規格・共通契約

[`spec.md`](../spec.md) の §4.4 を切り出した**共通マスタの共通データ規格**。People / Project / Allocation / Product といったマスタの**共通契約（すべてのマスタが従う基本設計）**と、各マスタの個別定義をまとめる。マスタを追加・修正するときに参照する。核（アーキテクチャ・エンベロープ・スコープ次元）は [`spec.md`](../spec.md) を正とする。

- ここに含むセクション: **§4.4 共通マスタ**（§4.4.1 マスタ共通設計＝共通契約 ＋ 各マスタ定義）。
- 節番号は spec.md の体系をそのまま引き継ぐ（`§4.4`）。他節（§1〜§4.3・§4.5〜§14）への `§` 参照は [`spec.md`](../spec.md) を指す。取込・移行・名寄せ（§4.6 / §7 / §8）は [`import-migration.md`](import-migration.md) を参照。
- マスタは今後も**増える前提**。新マスタは §4.4.1 の共通契約を満たす形で追加し、シェル・IO・名寄せの共通実装を再利用する（モジュールごとの重ね実装をしない）。

---

## 4.4 共通マスタ（People / Project / Allocation / Product）

人とプロジェクトは性質も関係するモジュールも異なるため、**独立した2つの管理ドメイン**として分離する（別ストア `mk:people` / `mk:projects`、別管理画面）。両者を1つの「マスタ」に混ぜない。アロケーション（計画）・プロダクト（成果物）も同格の独立ドメインとして持つ。すべては §4.4.1 の共通契約に従う。

モジュールごとの利用関係（軸が直交している＝分離が妥当な根拠）:

| モジュール | People を使う | Project を使う |
|---|---|---|
| goals | – | 任意（Goal↔Project） |
| questions | – | – |
| skills | ✓ | – |
| workload | ✓ | 任意 |
| oneonone | ✓ | – |
| todo | – | ✓ |
| wbs | ✓ | 任意 |

### 4.4.1 マスタ共通設計（共通契約）

**すべてのマスタが従う共通契約**。People / Project / Allocation / Product は本契約の具体化であり、新しいマスタも本節を満たす形で追加する。

#### A. データ規約
- **ストア**: `mk:<domain>:v1`（`<domain>` は複数形の小文字。例 `people` / `projects` / `products` / `allocations`）。ルート形状は `{ version: 1, <collection>: [...] }`。
- **id**: `<prefix>_<base36 epoch>_<rand>`（§4.7）。グローバル一意・**再利用しない**。
- **必須フィールド `name`**（表示名・名寄せキー）。任意フィールドはマスタ固有。モジュール固有の属性はマスタに持たせず、モジュール側に `<domain>Id` をキーに格納する（マスタを汚さず拡張可能にするため）。
- status 等の**列挙は `STATUSES`**（`{ key, label }` の配列・表示順もこの順）と **`normalize<Enum>()`** を持ち、未知値・未指定は既定へ正規化する。
- 変更（`create` / `update` / `remove` / `replaceAll` / `applyCSV`）のたびに **`bus.emit("masters:changed", { domain })`** を発火する。localStorage は直接触らず必ず `MK.store` 経由。

#### B. API 契約
DOM 非依存の純ロジックとして `MK.<domain>` に実装し、`ctx.<domain>` で公開する（§3.5）。

| メソッド | 返り値 | 役割 |
|---|---|---|
| `all()` | `T[]` | 全件の複製配列 |
| `get(id)` | `T \| null` | id 一致 |
| `create(attrs)` | `T` | 1件作成（id 採番・既定値・正規化・保存・emit） |
| `update(id, patch)` | `T \| null` | 部分更新（正規化・保存・emit） |
| `remove(id)` | `void` | 削除（保存・emit） |
| `resolve(name)` | `T \| null` | 名寄せ（正規化キー完全一致・§8.3） |
| `resolveOrCreate(name)` | `id \| null` | 一致なければ新規作成し id を返す（空名は `null`・§8.4） |
| `replaceAll(list)` | `void` | 全置換（JSON バックアップ復元用） |
| `buildCSVRows()` | `string[][]` | CSV 出力（1 行目ヘッダ） |
| `applyCSV(rows)` | `number` | CSV 取込（下記 C の名寄せ upsert）・取込件数を返す |

- status を持つマスタは加えて **`STATUSES` / `normalize<Enum>()` / `counts()`**（`all` ＋各 key の件数マップ）を提供する。

#### C. CSV 取込は「名寄せ upsert」を標準とする
- `applyCSV(rows)` は行ごとに `name` を正規化キーで既存と照合し、**一致すれば id を保ったまま更新／なければ新規作成**する（§8.3 / §8.4）。`name` が空の行はスキップ。
- **id を振り直す全置換は禁止**（`memberId` / `projectId` 等のモジュール参照を孤立させるため）。参照を持たない台帳（現行 Product は全置換）も本契約に合わせ、順次 upsert へ寄せる。
- 列は各マスタの [`import-migration.md`](import-migration.md) §4.6 の列仕様に従う。列挙値は key またはラベルを寛容に解釈して正規化する。
- **CSV 出力 → 編集 → 取込で往復（round-trip）が保たれる**こと（名寄せ upsert により id が継続する）。

#### D. シェル統合
- `master-<domain>`（👤 / 📁 / 📦 …）を「マスタ」ナビグループの**特別ビュー**として持つ（§3.6・config の `masters` に載る分だけ表示。§1.5）。
- 各ビューは共通に **一覧＋インライン追加＋編集モーダル＋削除確認＋CSV出力/CSV取込** を備える。`masters:changed` を購読し、表示中なら再描画する。
- CSV は `MK.io.csv.stringify` / `MK.io.csv.parse`・`MK.io.downloadText`・ファイル選択の**共通ヘルパ**を用いる（モジュール個別実装をしない）。

#### E. IO・整合
- 全体 JSON エンベロープ（§4.2）に `<collection>` 配列として往復（置換・マージ）。**マージは id 一致で上書き、なければ追加**。名前参照は取込時に名寄せ（§8）で解決する。
- スコープ次元（§3.7）になるマスタは `dimensions[].master === "<domain>"` の供給元を兼ねる（Project／Product・#54）。参照マスタ（People）は次元にしない（§3.7.1）。

### People マスタ — Member（人） … `mk:people:v1`
人の管理ドメイン。全モジュール横断の最小マスタ。モジュール固有の属性はマスタに持たせず、各モジュール側に `memberId` をキーに格納する（マスタを汚さず拡張可能にするため）。

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | string | 一意ID（`m_<epoch>_<rand>`） |
| `name` | string | 氏名（必須・表示名） |
| `role` | string | 役割・職種（任意） |
| `color` | string | 表示色（任意） |
| `note` | string | 備考（任意） |
| `active` | boolean | 在籍/有効フラグ（任意・既定 true） |

- モジュール固有のメンバー属性の例:
  - workload の `capacityWarnHigh` / `capacityWarnLow` → `mk:module:workload` 側に `memberSettings[memberId]` として保持。
  - skills の評価（ratings）は従来どおり skills 側に `memberId` キーで保持。
- 旧 wbs-tool の `assignee`（文字列）は、マスタ Member への参照（`assigneeId`）へ移行。未解決の文字列は「未割当の表示名」として暫定保持し、マスタ登録を促す（§7）。
- CSV 入出力に対応（§4.6）。列: `氏名, 役割, 表示色, 備考, 有効`。`有効` は空/未指定は true、`false`/`0`/`no`/`無効` を false と解釈。氏名が空の行はスキップ。**現行は全置換**（共通契約 §4.4.1 C に合わせ名寄せ upsert へ寄せる）。

### Project マスタ — プロジェクト管理ドメイン … `mk:projects:v1`
横断的な束ね概念。todo-kun の `project` 文字列、wbs の大項目、workload のタスク群を緩く束ねる。
本バージョンの Project は**軽量マスタ（参照・色分け・束ね）に留める**。複数モジュールを1つのプロジェクト視点で集約する「プロジェクト・ダッシュボード（ハブ）」は、全モジュールが Project に結合し「モジュール独立」と相反するため**将来拡張**とする（§14）。

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | string | 一意ID（`p_<epoch>_<rand>`） |
| `name` | string | プロジェクト名（必須） |
| `color` | string | 表示色（任意） |
| `status` | enum | `active` / `archived`（任意・既定 active） |
| `note` | string | 備考（任意） |

- 参照は原則 `projectId`。ただし **人間・AI 編集のしやすさ**のため、CSV/JSON では**名前による参照**も許容し、取込時に名前→ID解決する（未登録名は新規 Project として作成 or スキップを選択。既定は警告のうえスキップ）。
- todo-kun の自由文字列 `project` は移行時に Project マスタへ名寄せ（同名は1つに集約）。後方互換として文字列のままも読めるようにする。
- CSV 入出力に対応（§4.6）。列: `プロジェクト名, 表示色, 状態, 備考`。`状態` は `archived`/`アーカイブ` を archived、それ以外は既定 `active`。プロジェクト名が空の行はスキップ。**現行は全置換**（共通契約 §4.4.1 C に合わせ名寄せ upsert へ寄せる）。

### アロケーションマスタ — 計画（人×器×期間×割当%） … `mk:allocations:v1`
マネージャがトップダウンで planning する**共有された計画事実**（§3.7.5）。People / Projects と同格の**中立な共有マスタ**として独立させ、特定モジュールに属させない（Issue #45 で workload 内部から昇格）。参照・編集は `ctx.allocations` 経由（§3.5）で、直接 localStorage を触らない。編集（planning）はリソース（resource・旧 staffing）が担う。

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | string | 一意ID（`a_<epoch>_<rand>`。昇格前の workload 由来は `wa_…` を保持） |
| `memberId` | string \| null | 対象メンバー（People 参照） |
| `targetId` | string \| null | 器のID（現状 Project 参照。次元は `dim` で識別） |
| `dim` | string | 次元キー（器の種類。`project` / `product`。§3.7.6 の config 由来。`"project"` 決め打ち禁止） |
| `startDate` / `endDate` | string | 割当期間（YYYY-MM-DD、未設定は空文字） |
| `percent` | number | 割当率(%)。100 超も許容（過剰アサインの可視化） |
| `note` | string | 備考（任意） |

- WBS の担当（`assigneeId`）・workload のタスク（負荷）とは**別レコード**。片方から導出せず、片方を変えても他方に影響しない（§3.7.5）。
- 集計純関数 `percentOn(list, memberId, date)`（器を跨いだ期間内合算）をマスタが提供し、要員計画の「空き＝キャパ−全器割当」算出が再利用する。
- ※ `memberId` / `targetId` の複合参照を持つため、共通契約の `name` 必須・`resolve`/CSV は素直に当てはまらない（名前ではなく参照で成立するマスタ）。編集は要員計画 UI と JSON 入出力を正とし、CSV 取込対象外。

### 需要（demand）マスタ — 需要（器×期間×必要%） … `mk:demands:v1`
「この器（PJ 等）がこの期間に何%（＝何人分）必要か」の**共有された需要事実**（Issue #68 / #52 Phase 2）。アロケーション（供給）と**対**の中立な共有マスタで、People / Projects / Allocations と同格。特定モジュールに属させず、参照・編集は `ctx.demands` 経由（§3.5）で直接 localStorage を触らない。編集はリソース（resource）が担い、月次の「需要 vs 供給」ギャップ＝いつまでに何人分の確保が必要かを示す。

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | string | 一意ID（`d_<epoch>_<rand>`） |
| `targetId` | string \| null | 器のID（現状 Project 参照。次元は `dim` で識別） |
| `dim` | string | 次元キー（器の種類。`project` / `product`。§3.7.6 の config 由来。`"project"` 決め打ち禁止） |
| `startDate` / `endDate` | string | 需要期間（YYYY-MM-DD、未設定は空文字） |
| `requiredPercent` | number | 必要率(%)。100 超も許容（複数人分の需要） |
| `note` | string | 備考（任意） |

- アロケーション（供給）・WBS のタスクとは**別レコード**。片方から導出せず、片方を変えても他方に影響しない。**メンバー非依存**（誰が、ではなく、どれだけ要るか）。
- 集計純関数 `demandOn(list, targetId, date)`（器×期間内合算）・`totalDemandOn(list, date)`（全器合計）をマスタが提供し、resource の `gapByMonth`（需要−供給）が再利用する。
- 将来 wbs 見積り等から自動生成する場合も、**生成器が本マスタへ書き込む**方式にしモジュール独立を維持する（resource が他モジュールの namespace を読まない）。
- ※ `targetId` 参照で成立するため、共通契約の `name` 必須・`resolve`/CSV は当てはまらない。編集は resource UI と JSON 入出力を正とし、CSV 取込対象外。

### Product マスタ — プロダクト（成果物）… `mk:products:v1`
プロダクト領域（§1.4・主語＝作るもの／成果物）の横断マスタ。People / Project とは別ドメインの独立ストア（`mk:products`）で、シェルレベルの「マスタ」グループに `master-products`（📦 プロダクト）として置く（§3.6 / §6.4）。扱うプロダクト自体の台帳であると同時に、§3.7 の **Product スコープ次元のマスタ**（`dimensions[].master === "products"`）を兼ねる。マスタ自体は Issue #37 で先行追加し、次元としての配線（`MK_CONFIG.dimensions` への追加）は Issue #54 で完了した（§3.7.6・§9.3 ガードレール準拠。product-scoped モジュールはまだ無い）。

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | string | 一意ID（`prod_<epoch>_<rand>`）。将来 `mk:module:<id>:<productId>:v1` の targetId になりうる |
| `name` | string | プロダクト名（必須） |
| `status` | enum | `planned` / `active` / `maintenance` / `sunset`（既定 planned・未知は planned に正規化） |
| `owner` | string | 旧・責任者メモ（自由文字列。互換のため残置。`ownerId` へ移行済みなら参照しない） |
| `ownerId` | string \| null | 責任者（People 参照・任意・既定 `null`。Issue #56） |
| `summary` | string | 概要・提供価値（任意） |
| `repo` | string | リポジトリ / リンク（任意） |
| `tags` | string[] | 自由タグ（任意） |
| `projectIds` | string[] | 関連プロジェクト（Project 参照・任意・既定 `[]`。Issue #55） |
| `createdAt` / `updatedAt` | string | 作成 / 更新日時（ISO 8601） |

- People とは `ownerId` による**責任者参照**を持つ（Issue #56）。Project とは `projectIds` による**一方向の緩い紐付け**を持つ（プロダクト⇄デリバリー・Issue #55）。いずれも Project / People 側からプロダクトを必須参照にはしない（モジュール独立を崩さない）。参照先が削除された場合、存在しない id は `relatedProjects(product)` / `ownerPerson(product)`（表示用ガード）で無視され、UI は破綻しない。
- 旧・自由文字列 `owner` は `migrateOwnerToPeople()` により起動時に一度だけ People へ名寄せ移行する（`ownerId` 未設定のもののみ対象・同名は既存 People に集約・`resolveOrCreate` で新規作成・冪等）。
- 名寄せ（§8）: `resolve(name)` / `resolveOrCreate(name)` を提供（将来の次元対象解決・CSV 取込の名前参照用）。
- CSV 入出力に対応（§4.6）。列: `プロダクト名, ステータス, 責任者, 概要, リポジトリ, タグ, 関連プロジェクト`。`ステータス` は key（`planned` 等）または日本語ラベル先頭語（計画 / 稼働 / 保守 / 終息）を受け付け、不明なら `planned`。`責任者` は People の氏名で、取込時に `MK.people.resolveOrCreate` により `ownerId` を解決する（未登録名は新規 People として作成）。出力も `ownerId` から People 氏名を引いて書き出す。`タグ` は空白 / カンマ区切り。`関連プロジェクト` は空白 / カンマ区切りのプロジェクト名で、取込時に `MK.projects.resolveOrCreate` により id 解決する（未登録名は新規 Project として作成）。**現行は全置換**だが、共通契約（§4.4.1 C）に合わせ名寄せ upsert へ寄せる。
- バックアップは全体 JSON エンベロープの `products` 配列で入出力する（置換・マージ。§4.2）。
