# CONVENTIONS.md — UI・レイアウト規約 ＋ モジュール・アーキテクチャ規約 ＋ 完成チェックリスト

「**同じ指摘を繰り返さない**」ための共通の型を定める運用リファレンス（契約）。個々のモジュールで場当たり修正するのではなく、**共有層（`shared/*`）で1回直して全モジュールへ伝播させる**ことを原則とする。

- 位置づけ: [`spec.md`](spec.md)（何を作るか）／[`CLAUDE.md`](CLAUDE.md)（どう作るか）を補完し、**UI と構造の一貫性**を担保する。
- 使い方: モジュールを追加・修正するときは、着手前に §1〜§4 を読み、完了前に §6 のチェックリストで自己点検する。共通の不具合・要望は、まず §4 の共有資産で直せないかを検討する。

---

## 1. モジュール・アーキテクチャ規約（描画とロジックの分離）

### 1.1 原則
各モジュールは **ロジック（logic）** と **描画（view）** を**別ファイル**に分ける。狙い:
1. 触るファイルのスコープを狭め、保守性を上げる。
2. 将来サーバー運用へ移す際、**logic＝サーバー寄り / view＝クライアント**として即分離できる。

> 共有層も同じ分離になっている（`store.js`/`io.js`/`people.js`/`projects.js` = ロジック、`ui.js`/`design.css` = 描画）。

### 1.2 ディレクトリ構成
```
modules/
  <id>/
    logic.js   … MK.logic["<id>"] を定義（データ・計算・CRUD）
    view.js    … MK.registerModule("<id>", {...}) を定義（描画・イベント）
```
読み込みは [`shared/manifest.js`](shared/manifest.js) が **`logic.js → view.js` の順**に classic `<script>`（`async=false`）で動的注入する（ES Modules / `fetch` は使わない・Issue #137）。エントリ HTML へ個別に `<script src>` を足さない。

### 1.3 責務の分担（厳守）
**logic.js（DOM に触れない）**
- データ入出力は `MK.store.scope("module:<id>")` 経由のみ（`localStorage` 直叩き禁止）。
- 計算・集計・バリデーション・CRUD・名寄せ呼び出し（`MK.people` / `MK.projects`）・CSV 行の整形/取込。
- `document` / `window` / DOM API / `MK.ui` を**参照しない**（サーバーへ持って行ける純粋さを保つ）。
- 公開はオブジェクトで: `MK.logic = MK.logic || {}; MK.logic["<id>"] = { load, save, …計算/CRUD, exportData, importData, loadSample };`
- **副作用は save まで。描画（`render`）は呼ばない**（描画は view の責務）。
- **公開関数には JSDoc を付ける**（`@param`/`@returns`・副作用・`@typedef`。詳細は [`CODING.md`](CODING.md)）。

**view.js（業務計算を持たない）**
- DOM 生成・イベント・描画のみ。計算・保存は `MK.logic["<id>"]` に委譲し、更新後に自分で `render()` する。
- UI は **`shared/ui.js` のヘルパ**（§4）を使い、部品を自作しない。
- `MK.registerModule("<id>", { title, icon, description, mount, unmount, exportData, importData, loadSample })` を定義。`exportData`/`importData`/`loadSample` は logic に委譲する。`description` は「何ができるか」の1行説明で、HOME が見取り図として描画する（spec §3.6 / Issue #40）。

### 1.4 データ境界（サーバー移行の布石）
- logic のデータアクセスは `store` 抽象の背後に閉じる。将来 `store` を API クライアントへ差し替えれば、view を変えずにサーバー化できる状態を保つ。

---

## 2. UI・レイアウト規約

### 2.1 余白・リズム（インラインで余白を置かない）
- **`style="margin:…"` をモジュールに直書きしない。** ブロック間隔は共通のレイアウト土台に委ねる。
- モジュール本文は `ui.stack([...])`（`.mk-stack`）に入れる。直下ブロック間に既定間隔（`--space-xl`＝24px）が自動で付く（情報の塊を呼吸させるため一段広め・Issue #173）。
- カード内の小見出し（`h3`）は先頭以外に上余白が自動で付く（`.card > h3` 規則）。ボタンの直後に見出しが続いても密着しない。
- **`.card` の直下は自動間隔が「限定的」（気を付ける点）**: `.card` 直下に縦リズムが自動で付くのは `h3` と `.sub`（`.card > h3:not(:first-child)` / `.card > .sub + *` 規則）**だけ**。それ以外の任意ブロック（`ui.statsRow`・リスト・ボタン等）を `.card` 直下に並べると**間隔が付かず密着する**。カード内に複数ブロックを積むときは**中身を `ui.stack([...])` で包む**（`h3` は `design.css` で `margin:0` にリセット済みなので stack 化しても崩れない）。
- **末尾アクション（「開く →」等）に `ui.toolbar` を使わない（気を付ける点）**: `.mk-toolbar` は `margin-bottom` だけを持つ**先頭ツールバー**用。これをカード末尾のアクション行に使うと、上は margin-top が無く**前のブロックと密着**し、下は `margin-bottom` ＋ カード padding で**死に余白**が出る（top/bottom マージン不整合。dashboard で実際に発生）。末尾のボタンは **`mk-stack` の一員として直接置く**（上に `--space-xl`、下は margin なし＝カード padding のみ）。
- **一覧は `ul.mk-list > li.mk-row` で組む（罫線に頼らない・Issue #173）**: カード内リスト（`.mk-list .mk-row`）は**全行下線を持たず**、極薄ゼブラ（even 行が `--color-surface-soft`）＋ hover 面で区切る。行に自前の `border-bottom` を足さない。カード外で単独の `.mk-row` を置く場合のみ、既定で薄い下線（`--color-hairline-soft`）が付く。
- 色・余白・角丸・タイポは [`DESIGN.md`](DESIGN.md) トークン（CSS変数）経由。値の直書き禁止。

### 2.2 レスポンシブ（崩さない）
- 検証幅の基準: **375 / 768 / 1280 px**。この3点でヘッダー・テーブル・カード・グラフが破綻しないこと。
- **ナビ（サイドバー）**: 左サイドバーにゾーン見出し＋配下モジュールを縦積みする（`.mk-sidebar` / `.mk-nav`。Issue #34）。ゾーン見出し（`.mk-nav-group`）は折りたたみトグルで、状態は `mk:settings.nav` に保持。768px 以下ではサイドバーをオフキャンバスのドロワー化し、`.mk-topbar` のハンバーガー（`#btn-menu`）で開閉、`.mk-sidebar-overlay` クリック／項目選択で閉じる（`design.css` の `@media`）。
- **テーブル**: 潰さない。`min-width` を持ち狭ければ横スクロール、広ければ `width:100%` で追従し右に空白を作らない（WBS の教訓）。
- **多ペイン**（goals の一覧＋詳細等）: 狭幅で縦積みにフォールバック（`flex-wrap`）。
- ブレークポイントは `shared/design.css` の `@media` に集約（各モジュールに散らさない）。

### 2.3 一貫した状態表現
- 一覧が空のときは必ず空状態メッセージ（`ui.emptyState`）を出す。
- 破壊的操作（削除等）は確認（`MK.ui.confirm`）または取り消し導線を用意。
- **ネイティブダイアログ禁止**: `confirm()` / `alert()` / `prompt()` を使わない。確認は `MK.ui.confirm(message)→Promise<bool>`、通知は `MK.ui.toast(message, type)`、入力・複雑な確認は `MK.ui.modal(...)` を使う（DESIGN トークン描画・ダークモード追従・Esc で閉じる操作性を共通化するため。[`spec.md`](spec.md) §6）。
- テーマは `[data-theme="dark"]` に自動追従。グラフは **SVG で `var(--token)` 参照**すれば自動追従。Canvas を使う場合は描画時にトークンを読み、`MK.bus` の `theme:changed` で再描画する。

### 2.4 安全
- ユーザー入力・取込データを DOM に出すときは `textContent` かエスケープ（`MK.util.escapeHtml`）。`innerHTML` に未エスケープ文字列を渡さない。

---

## 3. コード規約（要点。詳細は [`CODING.md`](CODING.md)）
- Vanilla JS（ES2020+）。ビルド・外部依存・ES Modules・`fetch` を使わない。公開シンボルは `window.MK`。
- `var` 禁止（`const`/`let`）、比較は `===`/`!==`、イベントは `addEventListener`。
- 共有化は2か所以上で必要になってから（先回りの抽象化を避ける）。YAGNI。
- **スコープ次元を決め打ち分岐しない**（[`spec.md`](spec.md) §3.7）。`scope`／次元を扱うコードで `"project"` を直接 if 分岐せず、config／配列を回して汎用に扱う。Product を紙上で当てて「config に次元を1つ足す＋モジュールを足す」だけで成立する状態を保つ（逆に Project が要らない汎用機構まで先に作るのも過剰設計として避ける）。

---

## 4. 共有資産リファレンス（実装済み・view/logic はこれを使う）

### `MK.ui`（描画部品 / `shared/ui.js`）
- レイアウト: `sectionTitle(text)` / `stack(children)` / `toolbar(children)` / `card(children, {flush})` / `emptyState(text)` / `statsRow([{num,label}])`
- フォーム: `button(label, {variant,onClick,title})` / `field(label,control)` / `input({type,value,placeholder,onChange,onEnter})` / `textarea(value)` / `checkbox(checked)` / `select(options=[{value,label}], value, onChange)` / `pillTabs(tabs=[{key,label}], activeKey, onChange)`
- オーバーレイ: `modal({title, body, actions:[{label,variant,onClick(close)}]})` / `toast(message, type)` / `confirm(message)→Promise<bool>`
- 方針: **view は部品を自作しない**（`btn/fld/inp` 等をモジュール内に再定義しない）。**ネイティブ `confirm/alert/prompt` は使わず**、上記オーバーレイ部品で代替する。

### `MK.util`（純粋ヘルパ / `shared/core.js`）
- `el(tag, attrs, children)`（`text`=textContent、`html`=エスケープ済み前提、`onX`=イベント）
- `uid(prefix)` / `nowISO()` / `todayISO()` / `fmtDate(d)` / `addDays(iso,n)` / `daysBetween(a,b)` / `mondayOf(iso)`
- `normalizeKey(name)`（名寄せ照合キー）/ `escapeHtml(s)`
- `mergeById(current, incoming)`（id 一致でアップサートした配列を返す純関数。importData の merge 分岐で使う。Issue #186）

### データ層（logic から使う）
- `MK.store.scope("module:<id>")` → `{ get(), set(v) }`。破損時も個別 try/parse で他へ波及させない。
- `MK.store.collection("module:<id>", { key, version, stamp })` → `{ load(), save(d) }`（Issue #139）。**配列キー1本を持つモジュール**の load（store 読取→`key` 配列検証→既定 `{ version, [key]: [] }` 返却）と save（`stamp:true` なら `exportedAt` 付与→`set`）の定型を集約する。複数キーや読込時の fixup が要るモジュール（skills / wbs 等）は `scope()` 直叩きで各自 load/save を書く。
- **マスタ**（共通契約は [`spec/masters.md`](spec/masters.md) §4.4.1 B）:
  - `MK.people` / `MK.projects` / `MK.products`: `all() / get(id) / create(attrs) / update(id,patch) / remove(id) / resolve(name) / resolveOrCreate(name) / replaceAll(list) / buildCSVRows() / applyCSV(rows)`。status を持つマスタ（projects / products）は加えて `STATUSES / normalize<Enum>() / counts()`。
  - `MK.allocations`（アロケーション共有マスタ・人×器×期間×%）: `all() / get(id) / of(memberId) / forTarget(targetId) / create / update / remove / replaceAll / percentOn(list, memberId, date)`。
  - `MK.demands`（需要共有マスタ・器×期間×必要%）: `all() / get(id) / forTarget(targetId) / create / update / remove / replaceAll / demandOn(list, targetId, date) / totalDemandOn(list, date)`。
  - ※ allocations / demands は `memberId` / `targetId` の複合参照で成立するため CSV 取込対象外（JSON 入出力と要員計画 UI を正とする）。
- **スコープ次元** `MK.scope`（[`spec.md`](spec.md) §3.7・`"project"` 決め打ち禁止）: `dims() / dimOf(scopeAttr) / master(dim) / entities(dim) / mode(count) / resolveTarget(dim, storedId) / storeNsFor(moduleId, scopeAttr, targetId) / ensureDefaultTarget(dim)`。scoped モジュールは `ctx.scope` の対象内に閉じる。
- `MK.io`: `buildEnvelope(scope) / download(name,obj) / downloadText(name,text,mime) / importEnvelope(env,mode) / csv.parse(text) / csv.stringify(rows) / pickCsvFile(onRows)`。`pickCsvFile` はファイル選択→読込→パースを共通化し、失敗時はエラートーストを出す（view の「CSV取込」から使う。§4.6.2）。
- `MK.bus`: `on(event,fn) / emit(event,payload)`。イベント: `masters:changed`（人/プロジェクト/プロダクト等のマスタ変更）・`theme:changed`（テーマ切替）。

---

## 5. 新規モジュールの追加手順

1. `modules/<id>/logic.js` を作成。配列キー1本なら `const { load, save } = MK.store.collection("module:<id>", { key, stamp });`（複数キー・fixup が要るなら `const store = MK.store.scope("module:<id>");` で始め load/save を自前で書く）。計算・CRUD・`exportData/importData/loadSample` を定義し、`MK.logic["<id>"] = {...}` で公開（DOM に触れない）。
2. `modules/<id>/view.js` を作成。`const L = () => MK.logic["<id>"];`、`render()` を `MK.ui` ヘルパで組み、`MK.registerModule("<id>", { title, icon, description, mount, unmount, exportData:()=>L().exportData(), importData:(d,m)=>L().importData(d,m), loadSample:()=>L().loadSample() })`。`description` は「何ができるか」の1行説明（HOME が見取り図として描画・spec §3.6 / Issue #40）。
3. [`shared/manifest.js`](shared/manifest.js): **モジュールの登録は原則ここ1か所**（Issue #137）。カタログ `CATALOG` に `<id>: {}`（空オブジェクト）を追加し（**カタログに無いモジュールはナビ・HOME に出ず、スクリプトも読み込まれない**）、既定（マネージャ全部入り）の `ZONES` の該当グループ（自分／ピープル／デリバリー…＝§1.4 の領域）に `<id>` を登録する。ゾーンが未定義なら新しいゾーンを追加する。ゾーンに出さないが実体だけ常に読み込みたい場合は `LOAD` に追加する（現状は該当なし。かつて旧データ移行専用に workload をここへ載せていたが、#167 の退役で撤去した）。これだけで index.html・member.html の `<script>` 追記もゾーンの二重定義も不要（manifest が `logic→view→shell` を順序どおり動的読込し、shell.js の `META`／`DEFAULT_ZONES` も manifest を参照する）。表示メタ `title`／`icon`／`description` は **カタログに足さず def 側に持たせる**（シェルの `META` が def を単一ソースとして読む。重複ハードコード禁止・§3.6 / Issue #142・#40）。まだ def を書かない「準備中」モジュールを名前だけ先に出したいときのみ、カタログ値に `{ title, icon }` をフォールバックとして書く（def 実装時に空へ戻す）。
   - 配布プロファイル（[`member.html`](member.html) 等）に載せたい場合のみ、そのエントリの `MK_CONFIG.zones` にも `<id>` を足す（載せなければ配布物にコードもデータも含まれない・spec §1.5）。マネージャ（[`index.html`](index.html)）は `zones` を宣言せず manifest 既定を使うため追記不要。
4. 旧ツール移行が必要なら [`shared/shell-settings.js`](shared/shell-settings.js) の `migrateLegacy()` に分岐を、[`shared/shell-core.js`](shared/shell-core.js) の `LEGACY_KEYS` にキーを追加（シェルは責務別に分割済み・Issue #140）。
5. `spec/modules/<id>.md` を既存モジュールと同じ体裁で作成し（位置づけ・共通マスタ関係・固有データ・CSV 列・旧データ移行・参照）、**[`spec.md`](spec.md) §5 のモジュール一覧表に行を追加する（モジュール id の列挙・CSV 対応の ✓ はここだけ・単一ソース）**。CSV に対応させたら §5 表の CSV 列を ✓ にする（`build…CSVRows` を実装したのに ✓ を付け忘れる／逆に外し忘れると [`test/spec-consistency.test.js`](test/spec-consistency.test.js) が失敗する。id 一覧は manifest カタログと突き合わせる）。マスタ利用の有無に増減があれば [`spec/masters.md`](spec/masters.md) §4.4 の利用関係表も同期する。§3.2 / §4.1 / §4.2 / §4.6 / §6.4・README・CLAUDE.md は規則＋参照になっているため個別列挙の追記は不要（もし id や「CSV 対応＝○○」の列挙を見つけたら §5 への参照へ直す）。
6. `test/<id>.test.js` を追加する（[`TESTING.md`](TESTING.md) §5）。ロード対象（[`test/harness.js`](test/harness.js) の `SHARED_SCRIPTS`／`MODULE_LOGIC`）は manifest から自動導出されるため、**モジュールのハーネス登録は不要**（カタログに足せば載る）。`test/` の一覧は [`TESTING.md`](TESTING.md) §7 を正とする。
7. §6 のチェックリストで点検。

> **モジュールを 1 つ追加するときの登録は [`shared/manifest.js`](shared/manifest.js) 1か所**（Issue #137）。id の一覧は spec.md §5（ドキュメント正）と manifest カタログ（実装正）に一元化してあるため、他のドキュメント（§3.2 / §4.1 / §4.2 / §6.4 / README）や index.html/member.html へ id を再列挙しない。

---

## 6. モジュール完成チェックリスト（Definition of Done）

**構造**
- [ ] logic と view がファイル分割され、logic は DOM/`document`/`MK.ui` に触れていない。
- [ ] view に業務計算が無い（計算は logic に委譲）。logic は `render` を呼ばない。
- [ ] logic の公開関数に JSDoc（`@param`/`@returns`・副作用）が付いている。
- [ ] ストアは自分の名前空間 `mk:module:<id>` のみ・mount 非依存。マスタは `MK.people`/`MK.projects` 経由。scoped モジュール（[`spec.md`](spec.md) §3.7）は対象別 `mk:module:<id>:<targetId>` に書き、`ctx.scope` の対象内に閉じる。
- [ ] スコープ／次元を扱うなら `"project"` の決め打ち分岐が無い（config／配列を回して汎用。§3 / spec §3.7.6）。
- [ ] 他モジュールを参照する横断表示・集約ビューは、相手をハード参照せず `MK.readSummary` 等の任意契約で問い合わせ、欠損（`MK_CONFIG` から外した／未実装）時は該当枠を黙って省く。相手モジュールを外しても起動・全画面・横断表示が壊れない（spec §9.5 柱1）。

**UI・レイアウト**
- [ ] 余白のインライン直書きが無い（`ui.stack` 等に委譲）。隣接ブロックが密着していない。
- [ ] 375 / 768 / 1280px で崩れない（ヘッダー・テーブル・カード・グラフ）。テーブルは潰さず横スクロール、広幅で右に空白を作らない。
- [ ] 色/余白/角丸/タイポはトークン経由。ダークで確認。
- [ ] 空状態メッセージがある。破壊的操作に確認/取り消し。
- [ ] 部品は `MK.ui` のヘルパを使用（自作していない）。
- [ ] def に1行説明 `description`（何ができるか）を持たせ、HOME の見取り図に出る（[`spec.md`](spec.md) §3.6 / Issue #40）。

**データ・安全**
- [ ] ユーザー入力は `textContent`/エスケープ。
- [ ] `exportData`/`importData`（置換・マージ）・`loadSample` を実装。該当すれば旧データ移行の対応あり。
- [ ] 日時は ISO 8601 UTC / 日付は `YYYY-MM-DD`、未設定は `null`/`[]`/`""`。

**動作・テスト**
- [ ] `node --check` 通過。`file://` で外部通信ゼロ・依存ゼロ。全モジュール切替・サンプル投入・バックアップで確認。
- [ ] ロジックの自動テストが通る（`node test/run.js`）。変更したモジュール＋依存側をテスト（[`TESTING.md`](TESTING.md)）。バグ修正には再発防止テストを追加。
- [ ] 着脱耐性の手動チェック（DOM 層・spec §9.5 柱1）: `MK_CONFIG` からモジュールを1つ外して `file://` で開き、HOME・全画面・検索が壊れないことを確認（logic＋core 層は `test/module-detach.test.js` が担保）。

**ドキュメント**
- [ ] 作業中に参照したドキュメントと実装・現状の食い違いを放置していない（同じ PR で更新した or `[core]`・`documentation` ラベルの Issue 化した。[`CLAUDE.md`](CLAUDE.md) の開発ワークフロー）。
- [ ] モジュール id を新たに列挙していない（一覧は [`spec.md`](spec.md) §5 の 1 か所・§5 手順 6）。

---

## 7. 変更履歴（解決済みの指摘）

| 指摘 | 対応（解決済み） |
|---|---|
| 余白の不足・不揃い（設定の見出し密着 等） | `.mk-stack` と `.card > h3` の間隔規則を `design.css` に追加。インライン margin を撤去（§2.1） |
| 画面を狭めると topnav が崩れる | `@media` とヘッダーの横スクロール／2段化・ピル `nowrap` を追加（§2.2） |
| 部品の重複定義（`btn/fld/inp` 等を5モジュールで再定義） | `shared/ui.js` に集約し view から自作を排除（§4） |
| 描画とロジックの混在 | 全モジュールを `modules/<id>/{logic,view}.js` に分割（§1） |
| 日付計算の重複（wbs 等） | `MK.util` に `addDays/daysBetween/mondayOf/fmtDate` を集約 |
