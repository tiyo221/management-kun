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
`index.html` では **`logic.js → view.js` の順**に classic `<script src>` で読み込む（ES Modules / `fetch` は使わない）。

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
- `MK.registerModule("<id>", { title, icon, mount, unmount, exportData, importData, loadSample })` を定義。`exportData`/`importData`/`loadSample` は logic に委譲する。

### 1.4 データ境界（サーバー移行の布石）
- logic のデータアクセスは `store` 抽象の背後に閉じる。将来 `store` を API クライアントへ差し替えれば、view を変えずにサーバー化できる状態を保つ。

---

## 2. UI・レイアウト規約

### 2.1 余白・リズム（インラインで余白を置かない）
- **`style="margin:…"` をモジュールに直書きしない。** ブロック間隔は共通のレイアウト土台に委ねる。
- モジュール本文は `ui.stack([...])`（`.mk-stack`）に入れる。直下ブロック間に既定間隔（`--space-lg`＝20px）が自動で付く。
- カード内の小見出し（`h3`）は先頭以外に上余白が自動で付く（`.card > h3` 規則）。ボタンの直後に見出しが続いても密着しない。
- 色・余白・角丸・タイポは [`DESIGN.md`](DESIGN.md) トークン（CSS変数）経由。値の直書き禁止。

### 2.2 レスポンシブ（崩さない）
- 検証幅の基準: **375 / 768 / 1280 px**。この3点でヘッダー・テーブル・カード・グラフが破綻しないこと。
- **ヘッダー（topnav）**: ナビは横スクロール（`flex-wrap:nowrap; overflow-x:auto`）。768px 以下はブランド＋アクションを1段目、ナビを全幅の2段目に落とす（`design.css` の `@media`）。ピルは `white-space:nowrap; flex:0 0 auto`。
- **テーブル**: 潰さない。`min-width` を持ち狭ければ横スクロール、広ければ `width:100%` で追従し右に空白を作らない（WBS の教訓）。
- **多ペイン**（goals の一覧＋詳細等）: 狭幅で縦積みにフォールバック（`flex-wrap`）。
- ブレークポイントは `shared/design.css` の `@media` に集約（各モジュールに散らさない）。

### 2.3 一貫した状態表現
- 一覧が空のときは必ず空状態メッセージ（`ui.emptyState`）を出す。
- 破壊的操作（削除等）は確認（`MK.ui.confirm`）または取り消し導線を用意。
- テーマは `[data-theme="dark"]` に自動追従。グラフは **SVG で `var(--token)` 参照**すれば自動追従。Canvas を使う場合は描画時にトークンを読み、`MK.bus` の `theme:changed` で再描画する。

### 2.4 安全
- ユーザー入力・取込データを DOM に出すときは `textContent` かエスケープ（`MK.util.escapeHtml`）。`innerHTML` に未エスケープ文字列を渡さない。

---

## 3. コード規約（要点。詳細は [`CODING.md`](CODING.md)）
- Vanilla JS（ES2020+）。ビルド・外部依存・ES Modules・`fetch` を使わない。公開シンボルは `window.MK`。
- `var` 禁止（`const`/`let`）、比較は `===`/`!==`、イベントは `addEventListener`。
- 共有化は2か所以上で必要になってから（先回りの抽象化を避ける）。YAGNI。

---

## 4. 共有資産リファレンス（実装済み・view/logic はこれを使う）

### `MK.ui`（描画部品 / `shared/ui.js`）
- レイアウト: `sectionTitle(text)` / `stack(children)` / `toolbar(children)` / `card(children, {flush})` / `emptyState(text)` / `statsRow([{num,label}])`
- フォーム: `button(label, {variant,onClick,title})` / `field(label,control)` / `input({type,value,placeholder,onChange,onEnter})` / `textarea(value)` / `checkbox(checked)` / `select(options=[{value,label}], value, onChange)` / `pillTabs(tabs=[{key,label}], activeKey, onChange)`
- オーバーレイ: `modal({title, body, actions:[{label,variant,onClick(close)}]})` / `toast(message, type)` / `confirm(message)→Promise<bool>`
- 方針: **view は部品を自作しない**（`btn/fld/inp` 等をモジュール内に再定義しない）。

### `MK.util`（純粋ヘルパ / `shared/core.js`）
- `el(tag, attrs, children)`（`text`=textContent、`html`=エスケープ済み前提、`onX`=イベント）
- `uid(prefix)` / `nowISO()` / `todayISO()` / `fmtDate(d)` / `addDays(iso,n)` / `daysBetween(a,b)` / `mondayOf(iso)`
- `normalizeKey(name)`（名寄せ照合キー）/ `escapeHtml(s)`

### データ層（logic から使う）
- `MK.store.scope("module:<id>")` → `{ get(), set(v) }`。破損時も個別 try/parse で他へ波及させない。
- `MK.people` / `MK.projects`: `all() / get(id) / create(attrs) / update(id,patch) / remove(id) / resolve(name) / resolveOrCreate(name) / replaceAll(list)`。
- `MK.io`: `buildEnvelope(scope) / download(name,obj) / downloadText(name,text,mime) / importEnvelope(env,mode) / csv.parse(text) / csv.stringify(rows)`。
- `MK.bus`: `on(event,fn) / emit(event,payload)`。イベント: `masters:changed`（人/プロジェクト変更）・`theme:changed`（テーマ切替）。

---

## 5. 新規モジュールの追加手順

1. `modules/<id>/logic.js` を作成。`const store = MK.store.scope("module:<id>");` で始め、`load/save`・計算・CRUD・`exportData/importData/loadSample` を定義し、`MK.logic["<id>"] = {...}` で公開（DOM に触れない）。
2. `modules/<id>/view.js` を作成。`const L = () => MK.logic["<id>"];`、`render()` を `MK.ui` ヘルパで組み、`MK.registerModule("<id>", { title, icon, mount, unmount, exportData:()=>L().exportData(), importData:(d,m)=>L().importData(d,m), loadSample:()=>L().loadSample() })`。
3. [`index.html`](index.html): `<script src="modules/<id>/logic.js">` → `<script src="modules/<id>/view.js">` の順で追加。ナビの `META` にタイトル/アイコン、`ZONES`（個人／チーム管理）の該当グループに `<id>` を登録。
4. 旧ツール移行が必要なら `index.html` の `migrateLegacy()` に分岐と `LEGACY_KEYS` を追加。
5. `spec/modules/<id>.md` を既存モジュールと同じ体裁で作成し（位置づけ・共通マスタ関係・固有データ・CSV 列・旧データ移行・参照）、[`spec.md`](spec.md) §5 のモジュール一覧に行を追加する。
6. §6 のチェックリストで点検。

---

## 6. モジュール完成チェックリスト（Definition of Done）

**構造**
- [ ] logic と view がファイル分割され、logic は DOM/`document`/`MK.ui` に触れていない。
- [ ] view に業務計算が無い（計算は logic に委譲）。logic は `render` を呼ばない。
- [ ] logic の公開関数に JSDoc（`@param`/`@returns`・副作用）が付いている。
- [ ] ストアは自分の名前空間 `mk:module:<id>` のみ・mount 非依存。マスタは `MK.people`/`MK.projects` 経由。

**UI・レイアウト**
- [ ] 余白のインライン直書きが無い（`ui.stack` 等に委譲）。隣接ブロックが密着していない。
- [ ] 375 / 768 / 1280px で崩れない（ヘッダー・テーブル・カード・グラフ）。テーブルは潰さず横スクロール、広幅で右に空白を作らない。
- [ ] 色/余白/角丸/タイポはトークン経由。ダークで確認。
- [ ] 空状態メッセージがある。破壊的操作に確認/取り消し。
- [ ] 部品は `MK.ui` のヘルパを使用（自作していない）。

**データ・安全**
- [ ] ユーザー入力は `textContent`/エスケープ。
- [ ] `exportData`/`importData`（置換・マージ）・`loadSample` を実装。該当すれば旧データ移行の対応あり。
- [ ] 日時は ISO 8601 UTC / 日付は `YYYY-MM-DD`、未設定は `null`/`[]`/`""`。

**動作・テスト**
- [ ] `node --check` 通過。`file://` で外部通信ゼロ・依存ゼロ。5モジュール切替・サンプル投入・バックアップで確認。
- [ ] ロジックの自動テストが通る（`node test/run.js`）。変更したモジュール＋依存側をテスト（[`TESTING.md`](TESTING.md)）。バグ修正には再発防止テストを追加。

---

## 7. 変更履歴（解決済みの指摘）

| 指摘 | 対応（解決済み） |
|---|---|
| 余白の不足・不揃い（設定の見出し密着 等） | `.mk-stack` と `.card > h3` の間隔規則を `design.css` に追加。インライン margin を撤去（§2.1） |
| 画面を狭めると topnav が崩れる | `@media` とヘッダーの横スクロール／2段化・ピル `nowrap` を追加（§2.2） |
| 部品の重複定義（`btn/fld/inp` 等を5モジュールで再定義） | `shared/ui.js` に集約し view から自作を排除（§4） |
| 描画とロジックの混在 | 全モジュールを `modules/<id>/{logic,view}.js` に分割（§1） |
| 日付計算の重複（wbs/workload） | `MK.util` に `addDays/daysBetween/mondayOf/fmtDate` を集約 |
