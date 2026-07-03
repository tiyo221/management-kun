# management-kun 管理ツール 仕様書（spec.md）

**共通のデザイン・共通のデータ規格・共通マスタ**のもとに、モジュールを追加・削除して育てていく管理ツールの共通仕様を定義する。

出発点は既存の5つの単一HTMLツール（目標みえるくん / スキル可視化 / タスク可視化 / todo-kun / WBS Tool）を1つに束ねたことだが、**統合自体が目的ではない**。統合はこのツールを立ち上げた経緯であり、ここから用途に応じてモジュールを増減させて発展させていくことが本来の狙い。共通基盤（デザイン／データ規格／マスタ）は、その「モジュールを載せ替えて育てる」ための土台として定義する。

- 形態: ビルド不要・外部依存ゼロ・`file://` で動作（既存ツールの原則を継承）
- 範囲: 本書は**共通（全体）仕様**。全モジュールに効く取り決め（アーキテクチャ・データ規格・名寄せ・デザイン等）を定義する。各モジュール固有の仕様は [`spec/modules/<id>.md`](spec/modules/)、機能の詳細挙動は各ツールの既存 `spec.md` を正とする。
- アプリ名: **マネジメントくん**（技術名/ディレクトリ: `management-kun`）

最終更新: 2026-07-03

---

## 1. 目的とゴール

**本来の目的は「共通基盤の上でモジュールを追加・削除して育てていくこと」**。共通のデザイン／データ規格／マスタは、その土台として1本化する。下記 §1.1〜§1.2 の「統合」は、この基盤を立ち上げるに至った出発点として読む（統合の完了がゴールではない）。

### 1.1 出発点（なぜ共通基盤を作るか）
既存の5ツールは別々に作られ、以下が重複・不揃いになっていた。これを1つに束ね直したことが本ツールの出発点であり、共通基盤を設ける動機でもある。

- **デザイン**: 配色・タイポ・コンポーネントが各ツールで独自。
- **データ規格**: localStorage キー命名、JSON ルート形状、CSV 規約がバラバラ。
- **エンティティ**: 「メンバー（人）」が複数ツールに別々に登録される。「プロジェクト」概念も各ツールで表現が異なる。

### 1.2 ゴール（何のための共通基盤か）
1. **モジュールの追加・削除で育てる**: 用途に応じてモジュールを増減できるよう、共通基盤（下記 2〜5）の上に各モジュールを載せ替える構成にする。モジュール追加・削除を低コストにすることが最上位の狙い。
2. **デザイン統一**: 全モジュールが [`DESIGN.md`](DESIGN.md)（Notion 風デザインシステム）の同一トークン・同一コンポーネントを使う。
3. **データ規格統一**: JSON エンベロープ・localStorage キー命名・CSV 規約を1本化する。
4. **人 / プロジェクトの共有**: 「メンバー（人）」と「プロジェクト」を、それぞれ独立した管理ドメインとして一元管理し、各モジュールはそれを参照する。
5. **保守性の確保**: 共通部分（デザイン/データ層）を共有資産に切り出し、モジュールごとの重複実装をなくす。

### 1.3 非ゴール（やらないこと）
- エンティティの完全統合（タスクのスキーマを1つに強制する等）は行わない。各モジュール固有のデータ構造は独立を保つ（§5.6）。
- サーバー連携・クラウド同期・認証は引き続きスコープ外（§13）。

### 1.4 プロダクトの位置づけ：マネージャの作業机（自分＋4領域）
本アプリの利用者は**マネージャ個人**を想定する。ナビは「自分の作業机」を、**自分**（マネージャ本人の作業）＋**EM が見る4領域**で分類する。「チーム管理」のような『自分以外』の一括りではなく、**見る対象の領域**で切ることで、モジュールを増やして育てる際の「棚」を明確にする。

| ゾーン | 主語 / 対象 | モジュール | People マスタ |
|---|---|---|---|
| **自分** | 自分（マネージャ） | todo（自分のタスク）/ goals（自分の目標） | 使わない |
| **ピープル** | メンバー・チーム | skills / workload / staffing | 使う |
| **デリバリー** | プロジェクトの遂行 | wbs | 使う |
| **プロダクト** | 作るもの（成果物） | —（現状モジュールなし・将来の棚） | — |
| **テクノロジー** | 技術・基盤 | —（現状モジュールなし・将来の棚） | — |

- **領域名「デリバリー」**: プロジェクト遂行の領域だが、横断マスタの **Project**（§4.4）と語がぶつかるため、領域名には「プロジェクト」を用いず **デリバリー** と呼ぶ。
- **マスタ（人・プロジェクト）はゾーンに属さない**。各ゾーンのモジュールは People/Project マスタを**参照・編集**するが（「People マスタ」列＝そのゾーンがマスタを使うか）、マスタ自体は特定ゾーンの持ち物ではなく `home` / `settings` と同列の**シェルレベル管理カテゴリ**として独立させる（ナビでもゾーン群と設定の間の独立グループ「マスタ」に置く。§3.6 / §6.4）。とくに Project は wbs（デリバリー）だけでなく workload（ピープル）からも参照される横断マスタ（§4.4 / §4.6）であり、いずれかのゾーン配下に固定すると横断性が過小表現になる。
- **プロダクト / テクノロジーは現状モジュールを持たない**。分類（棚）としては定義するが、中身が無いゾーンはナビに空グループを出さないため **`MK_CONFIG.zones` には載せない**（§1.5）。該当モジュールを追加する際にゾーンを足す。
- **自分ゾーン**は「マネージャ個人の領域（goals）＋マネージャとしてのタスク領域（todo）」。**goals は個人ツール**（自分の目標ロードマップ）であり、チームの KPI/OKR ではない。メンバーやプロジェクトと結び付けない（チーム目標管理に見せない）。
- 将来「チームの OKR/KPI 管理」が必要になった場合は、goals とは**別概念の新モジュール**として検討する（今は作らない・§14）。
- **PJ 横断 / PJ 単位のスコープ軸**（例: 横断要員計画 vs PJ 単位 WBS）は、この領域分類とは**直交する別軸**。「同種のものを複数持つ／単一で持つ」を統一的に扱う **スコープ次元**として §3.7 に定義する（本節の分類には含めない）。

### 1.5 配布プロファイル（複数エントリHTML）
1コードベースを維持したまま、**エントリHTMLごとに「積むゾーン／モジュール」を差し替える**ことで、用途別の配布形態を用意する。フォーク（`shared/*` や todo/goals の二重化）はしない。

- **仕組み**: 各エントリHTMLが `window.MK_CONFIG = { profile, zones: [...] }` を宣言し、必要なモジュールの `<script>` だけを読み込む。シェル（`shared/shell.js`）はこの config を読んで描画するだけで、どのプロファイルにも依存しない。エントリを足してもシェル本体の改修は不要。
- **分離の強さ**: 読み込まなかったモジュールは、コードもデータ（`localStorage`）も**物理的に存在しない**。見た目（ナビ非表示）だけでなく実データ的にも分離される。
- **標準プロファイル**:

| エントリ | profile | ゾーン | 用途 |
|---|---|---|---|
| [`index.html`](index.html) | `manager` | 自分＋ピープル＋デリバリー（全部入り） | マネージャ本人 |
| [`member.html`](member.html) | `member` | 自分のみ（todo / goals） | チームメンバーへ配布。skills / workload / wbs / マスタ管理には到達不能 |

- メンバーが入力した todo / goals は、既存の JSON エクスポート／インポート（§7）でマネージャ側に回収できる（専用フローは作らない）。
- HOME/ダッシュボードは、この config（zones）を入力として生成する前提で設計する（別 Issue）。

---

## 2. 設計原則

既存5ツール共通の原則を統合アプリにも適用する。

| 原則 | 内容 |
|---|---|
| ビルド不要 | バンドラ・トランスパイラを使わない。素の HTML / CSS / Vanilla JS。 |
| 外部依存ゼロ | CDN・外部フォント・アナリティクス・ネットワーク通信を一切持たない。 |
| `file://` 動作 | ダブルクリックで開いて全機能が動く。 |
| ローカル完結 | データはユーザーの手元（localStorage / JSON / CSV ファイル）に閉じる。外部送信なし。 |
| 日本語 UI | 既存方針を継承。 |

> **`file://` 制約に伴う実装ルール**（§3.3 で詳述）: ES Modules（`import`/`type="module"`）と `fetch()` は `file://` の CORS 制約で動かないため**使わない**。共有 JS は classic `<script src>` で読み込み、グローバル名前空間 `window.MK` に公開する。共有 CSS は `<link>` で読み込む。

---

## 3. アーキテクチャ

### 3.1 構成方針：単一ページ・シェル + モジュール差し替え

「ランチャー + 共有資産」を、**1枚のシェル HTML が各モジュールを同一ページ内に差し替えロードする SPA 型**として実現する。

採用理由（重要）:
- 物理ファイルはモジュール単位に分割でき、共通資産（デザイン/データ層）を共有できる（保守性）。
- **常に1ページ＝1 origin** で動くため、`file://` でも localStorage を確実に共有でき、共通マスタ（メンバー/プロジェクト）の横断利用が成立する。
  - 別々の HTML ファイルを `file://` で開く方式だと、ブラウザにより localStorage が共有されず（Chrome は opaque origin、Firefox は挙動差あり）、共通マスタが破綻する。これを避けるためシェル方式を採る。
- ビルド不要・`file://`・依存ゼロを維持できる。

### 3.2 ディレクトリ構成

```
management-kun/
├── index.html              … シェル（ランチャー兼ホスト）。これを開く。
├── shared/
│   ├── design.css          … DESIGN.md 由来のトークン + 共通コンポーネント + レスポンシブ
│   ├── core.js             … window.MK 名前空間・共通ユーティリティ（el/uid/日付/名寄せキー/escape）
│   ├── store.js            … localStorage 永続化・スキーマ/マイグレーション
│   ├── people.js           … 人の管理（members）の CRUD・名寄せ解決API
│   ├── projects.js         … プロジェクト管理（projects）の CRUD・名寄せ解決API
│   ├── io.js               … JSON エンベロープ入出力・CSV パーサ/シリアライザ
│   ├── ui.js               … 共通UI部品（レイアウト/フォーム/モーダル/トースト）
│   └── sample.js           … サンプルデータ投入
├── modules/                … 各モジュールは logic/view に分割（詳細は CONVENTIONS.md §1）
│   ├── goals/{logic,view}.js     … 目標みえるくん（旧 mokuhyo-mieru-kun）
│   ├── skills/{logic,view}.js    … スキル可視化（旧 skill-mieru-kun）
│   ├── workload/{logic,view}.js  … タスク負荷可視化（旧 task-mieru-kun）
│   ├── todo/{logic,view}.js      … GTD ToDo（旧 todo-kun）
│   └── wbs/{logic,view}.js       … WBS / ガント（旧 wbs-tool）
├── DESIGN.md               … デザインシステム
├── CONVENTIONS.md          … UI/レイアウト規約・logic/view 分割・完成チェックリスト
├── CODING.md               … コーディング規約
├── CLAUDE.md               … 作業ガイド
├── spec.md                 … 共通（統合）仕様。これが最上位の正。
└── spec/
    ├── import-migration.md … 取り込み・移行・名寄せ（§4.6 CSV / §7 移行 / §8 名寄せ）。取込・移行作業時のみ参照。
    └── modules/            … モジュール個別仕様（統合上の位置づけ・固有データ・CSV列・旧データ移行）
        ├── goals.md
        ├── skills.md
        ├── workload.md
        ├── todo.md
        └── wbs.md
```

- 仕様は2層: **共通仕様 `spec.md`**（全モジュールに効く取り決め）＋ **個別仕様 `spec/modules/<id>.md`**（そのモジュールだけの取り決め）。修正・機能追加時は「共通仕様＋対象モジュールの個別仕様」だけを読めば足りるようにする。
- 共通仕様のうち、**取込・移行・名寄せ（§4.6 CSV / §7 / §8）は [`spec/import-migration.md`](spec/import-migration.md) に分離**した。CSV/JSON 取込・旧データ移行・名寄せを触るときだけ読めばよく、通常のモジュール編集では不要。

- 各モジュール JS は `window.MK.registerModule(id, { title, icon, mount, unmount })` で自身を登録する。
- シェルがナビゲーションを描画し、選択されたモジュールの `mount(container, ctx)` を呼ぶ。`ctx` には共通マスタ API・ストア・IO・UI 部品が渡る。
- 分割は読み込み順に依存する単純な script タグの並びで足りる（依存解決ライブラリは持たない）。

### 3.3 `file://` 制約の実装ルール

| 制約 | ルール |
|---|---|
| ES Modules 不可 | `import` / `export` / `type="module"` を使わない。classic script + `window.MK` 名前空間で連携。 |
| `fetch()` 不可 | 外部リソース取得をしない。サンプルデータ等はJS内にインライン定義する。 |
| 画像 | インライン SVG または絵文字のみ（外部画像参照なし）。 |
| フォント | 外部フォント読込なし。`DESIGN.md` の Notion Sans はローカルに無いため、システムフォントスタック（`Inter, -apple-system, system-ui, 'Segoe UI', Hiragino Kaku Gothic ProN, Meiryo, sans-serif`）で代替する（§6.2）。 |

### 3.4 状態とライフサイクル
- 起動時に `store.js` が localStorage から全データ（マスタ + 各モジュール）を読み込み、メモリ上の単一ステートに展開する。
- モジュールは自身のデータとマスタを `ctx` 経由で読み書きし、変更時に `store.save(namespace)` を呼ぶ → 該当 localStorage キーへ自動保存。
- モジュール切替時は前モジュールの `unmount()` で DOM を破棄（メモリ上のステートは保持）。

### 3.5 モジュール登録 API と `ctx` 契約

各モジュール JS は読み込み時に自身を登録する。

```js
MK.registerModule("todo", {
  title: "ToDo",
  icon: "✅",
  mount(container, ctx) { /* 描画 */ },
  unmount() { /* DOM破棄 */ },
  exportData() { return /* data */; },          // JSONエンベロープ modules.<id>.data 用
  importData(data, mode) { /* "replace" | "merge" */ },
  migrate(data, fromVersion) { return data; }    // §4.5
});
```

ホストが `mount(container, ctx)` に渡す `ctx`:

| API | 役割 |
|---|---|
| `ctx.people` | People マスタの参照・CRUD・名寄せ解決（`list/get/resolve(name)/create`）（§8） |
| `ctx.projects` | Project マスタの同上 |
| `ctx.allocations` | アロケーション共有マスタの参照・CRUD（`all/get/of/forTarget/create/update/remove/percentOn`）（§3.7.5 / §4.4） |
| `ctx.scope` | scoped モジュールに渡る「現在の対象」`{ dim, id, entity }`（§3.7.3）。global モジュールでは `null` |
| `ctx.store` | `get(ns)/set(ns,data)/save(ns)`（`ns` = モジュール自身の localStorage 名前空間） |
| `ctx.io` | `csv.parse/csv.stringify`・JSON ダウンロード/読込（§4.2 / §4.6） |
| `ctx.ui` | 共通UI部品（`modal/confirm/toast/tabs` 等）（§6.3） |
| `ctx.settings` | UI 状態の読み書き（`mk:settings` の `ui.<moduleId>`）（§4.8） |
| `ctx.bus` | 軽量イベント。マスタ変更時に `bus.emit("masters:changed")` → 表示中モジュールが再描画 |

規約:
- 読み込み順は `core → shared/* → modules/*`（script タグ順）。`registerModule` は即時に呼ばれる。
- モジュールは**自分の名前空間 `mk:module:<id>` のみ**書き込む。マスタの変更は必ず `ctx.people` / `ctx.projects` 経由で行い、直接 localStorage を触らない。
- マスタが変わったら `bus` 経由で全モジュールへ通知し、整合を保つ。

### 3.6 HOME ダッシュボードと `summary()` 契約

シェルは `home` を **`master-people` / `master-projects` / `settings` と同列のシェルレベル特別ビュー**として持つ。ナビ先頭に「🏠 HOME」を置き、起動時の既定表示先にする（マネージャの「作業机」＝ §1.4）。

- **HOME は1枚**。ゾーンごとに別 HOME は作らない。中身は `ZONES`（配布プロファイル。§1.5）を入力に、**ゾーン別セクション見出し＋モジュールのサマリーカードのグリッド**を描画する。配布用エントリ（`member.html`）では `ZONES` にピープル/デリバリーゾーンが無いため、HOME も自動的に「自分」セクションのみになる。
- カードは該当モジュールへ `route` するランチャーを兼ねる（クリック／Enter・Space）。カタログ（`META`）未知のモジュールは出さない。未実装モジュールは「準備中」表示。
- **起動先**は既定 HOME。設定 `mk:settings` の `startView`（`"home"` | `"last"`）が `"last"` のときだけ前回モジュール（`lastModule`）を復元する。設定画面のトグルで切替。

各モジュール def は**任意**で `summary()` を実装できる（logic 側 `MK.logic.<id>.summary()` で算出し、view は委譲するだけ）。戻り値は次の形:

```js
summary() {
  return {
    empty: false,                       // データ皆無なら true（HOME は「データがありません」を表示）
    stats: [{ label: "未完", value: 12 }] // 表示する指標（label:表示名 / value:数値 or "37%" 等の文字列）
  };
}
```

- `summary` 未実装・例外時も HOME は壊さない（カードは「開く」表示にフォールバック）。
- 集計は logic 側の純関数に置き、テスト可能にする（`test/summary.test.js`）。例: todo=未完/全タスク数、goals=達成率/目標数、skills=メンバー/スキル項目数、workload=平均稼働率/過負荷人数、wbs=進行中/進捗率。

### 3.7 スコープ次元（横断 / 単位のスコープ軸）

ゾーン分類（§1.4）に**直交する第2軸**として、「**同種のものを複数持つ／単一で持つ**」を統一的に扱う仕組みを定義する。§1.4 で予約し §14 で将来送りにしていた「PJ 横断 / PJ 単位」軸を、**Project 専用ではなく汎用の型**として起こす。

#### 3.7.1 スコープ次元と参照マスタ

- **スコープ次元（scope dimension）**: 「その1つの中に入って作業する対象」になれるマスタ。現状 **Project**、将来 **Product**。複数持ちうるし単一のこともある。
- **参照マスタ（reference master）**: 横断で参照されるが「その中に入る」対象ではないマスタ。**People**。マネージャは常に自分であり「現在の人」という作業文脈を持たないため、次元にはしない。
- **非対称の根拠**: 人＝配る資源、Project/Product＝配る先の器。People を次元と混同しない。
- Project は §4.4 では軽量マスタ（参照・色分け・束ね）だが、本節では加えて「**作業文脈（現在の対象）**」の役割を担う。

#### 3.7.2 単一は複数の縮退形（別モードを作らない）

単一持ちと複数持ちを**別モード／別エントリにしない**。単一＝「要素数が1のとき」として同じ仕組みで表現する。

| 次元の要素数 | UI 挙動 |
|---|---|
| 0 | 「まず対象（Project 等）を作る」導線 |
| 1 | スイッチャを畳む／隠す。scoped モジュールはその1つを直接表示。cross ビューは自明（1件）だが成立 |
| 2+ | スイッチャ表示。scoped は選択中の文脈で描画、cross は全対象を集約 |

単一 PdM / 単一 PJ 向けと複数兼務向けで**アプリを分岐させず、差は config（§1.5 `MK_CONFIG`）のみに出す**。

#### 3.7.3 モジュールの `scope` 属性と「現在の対象」

各モジュール def に `scope` を宣言する。

- `scope: "global"` … 横断・常時（todo / goals / skills / 要員計画 / マスタ）。既定。
- `scope: { dim: "project" }` … Project 文脈で動く（wbs）。将来 `{ dim: "product" }`。

「現在の対象」状態は**次元ごとに独立**して持つ（Project の現在／Product の現在は別々）。シェルはスコープ切替スイッチャを提供し、選択中エンティティを scoped モジュールへ `ctx.scope` で渡す（§3.5）。global モジュールは次元文脈の外（`ctx.scope === null`）。scoped モジュールが受け取る `ctx.scope` の形は次のとおり:

```js
ctx.scope = { dim: "project", id: "<projectId>", entity: { /* Project オブジェクト全体 */ } };
```

- **マスタ参照は横断（scope で縛らない）**: `scope` が縛るのは**データ保存の namespace（§3.7.4）と UI の作業文脈**のみ。`ctx.people` / `ctx.projects` は scoped/global を問わず**全マスタを横断参照**できる（例: WBS が現在 PJ 外のメンバーも参照・アサインすることは妨げない）。「その PJ の人だけ」等の絞り込みは各モジュールの表示都合であり、次元の制約ではない。
- **ゾーン軸との関係**: ゾーン（§1.4）は残す。`scope` はゾーンに直交し、「デリバリー領域の project-scoped モジュール」のように二次元で位置づく。

#### 3.7.4 scoped データの保存（ハイブリッド）

**登録は1モジュール、保存は対象別 namespace** とする。

| モジュール種別 | localStorage キー |
|---|---|
| global | `mk:module:<id>:v1`（従来通り。§4.1） |
| scoped | `mk:module:<id>:<targetId>:v1`（例 `mk:module:wbs:<projectId>:v1`） |

- 利点: 対象単位のバックアップ／エクスポートがキー単位で完結、破損の影響を**対象単位に局所化**（§10.1）、`member.html` と同じ「読み込まなければ物理的に存在しない」思想（§1.5）と一致。
- `ctx.store` は現在の対象を見て該当キーへ読み書きする（**モジュールコードは1つのまま**）。

#### 3.7.5 横断ビューとアロケーション（要員計画の例）

「各PJで誰がアサインされ、空き要員はどれだけか」の PJ 横断俯瞰＝**要員計画**は、**People を主語に Project 次元を横断集約**する cross ビュー。データ源は**共有アロケーション**とし、各モジュール内部（WBS の担当等）を**覗かない**（§4.4 が将来送りにした「全モジュール横断集約＝モジュール独立と相反」を避けるため）。

- **アロケーション（計画・共有）**: `人 × 器（Project/Product）× 期間 × 割当%`。マネージャが**トップダウンで planning する粗い事実**。
- **担当（実行・WBS 内部）**: タスクの `assigneeId`。**ボトムアップの細かい事実**。
- 両者は**同じ People を指すが別レコード**。片方を他方から**導出しない**（WBS はその人の全稼働を網羅せず、計画はタスク分解の前から必要）。WBS は People 参照のみで**独立を維持**。
- **所有と配線（現行・Issue #45 で昇格済み）**: アロケーションは特定モジュールに属さない**中立な共有マスタ `mk:allocations`**（People / Projects と同格。§4.4）に置く。編集（planning）は**要員計画（staffing）**が担い、`ctx.allocations` 経由で読み書きする。要員計画は workload の logic API に依存せず、**workload を外してもアロケーションと要員計画は成立する**。
  - **昇格の経緯**: 当初は YAGNI により新たな共有マスタを作らず workload を次元対応させて内部保持していたが、その消費者として要員計画（staffing）が現れ「第2の消費者出現＝昇格トリガー」に到達したため、中立マスタへ切り出した。移行は加算的・非破壊（旧 `mk:module:workload:v1`.`allocations[]` を `mk:allocations` へ id 保持のまま移設し、workload 側から除去。§7）。
- 担当合計 vs アロケーションの**照合クロス機能**は将来枠（§14）。

#### 3.7.6 型のみ汎用・配線は Project のみ（YAGNI）

- スコープ次元の**型／契約だけ**を汎用に定義し、実装配線は **Project の1次元のみ**。
- **Product はモジュール追加時に実体化**する（Product マスタ・モジュールは今は作らない。§1.5「モジュールの無いゾーンは載せない」と同思想）。
- **ガードレール**: コード上で `"project"` を**決め打ち分岐しない**。次元は config の配列を回して扱う（[`CONVENTIONS.md`](CONVENTIONS.md)）。config は `MK_CONFIG.dimensions` に**宣言的な配列**で持たせる想定（詳細スキーマは実装 Issue で確定）:

```js
MK_CONFIG.dimensions = [
  { dim: "project", label: "プロジェクト", master: "projects" },
  // 将来: { dim: "product", label: "プロダクト", master: "products" }
];
```

  Product を紙上で当てて「config に次元を1行足す＋モジュールを足す」だけで成立することをレビューで確認する。
- 逆に、Project が要らない汎用機構まで先に作るのも**過剰設計として避ける**。

---

## 4. 共通データ規格

### 4.1 localStorage キー命名規約

すべて `mk:` プレフィックスで統一する（旧 `:v1` / `-data-v1` / `.data.v1` の混在を解消）。

| キー | 内容 |
|---|---|
| `mk:people:v1` | 人の管理マスタ `{ members }`（§4.4） |
| `mk:projects:v1` | プロジェクト管理マスタ `{ projects }`（§4.4） |
| `mk:allocations:v1` | アロケーション共有マスタ `{ allocations }`（人×器×期間×割当%。§3.7.5 / §4.4） |
| `mk:module:goals:v1` | 目標みえるくんのデータ |
| `mk:module:skills:v1` | スキル可視化のデータ |
| `mk:module:workload:v1` | タスク負荷可視化のデータ（負荷＝タスクに専念。計画は `mk:allocations` へ昇格・Issue #45） |
| `mk:module:todo:v1` | ToDo のデータ |
| `mk:module:wbs:v1` | WBS のデータ |
| `mk:settings:v1` | アプリ設定（最後に開いたモジュール、列幅等のUI状態） |

- `vN` のバージョンはキー単位で独立にあげられる（§4.5）。
- **scoped モジュール**（§3.7）は対象別に `mk:module:<id>:<targetId>:v1` を持つ（例 `mk:module:wbs:<projectId>:v1`）。global モジュールは上表どおり対象を持たない。

### 4.2 JSON エンベロープ（入出力の共通形）

すべてのエクスポートは以下の共通エンベロープに従う。`todo-kun` の `{version, exportedAt, ...}` を基礎に拡張。

```json
{
  "schema": "management-kun",
  "schemaVersion": 1,
  "exportedAt": "2026-06-30T12:00:00.000Z",
  "scope": "all | people | projects | <moduleId>",
  "people": [],
  "projects": [],
  "modules": {
    "goals":    { "version": 1, "data": { } },
    "skills":   { "version": 1, "data": { } },
    "workload": { "version": 1, "data": { } },
    "todo":     { "version": 1, "data": { } },
    "wbs":      { "version": 1, "data": { } }
  }
}
```

- **全体バックアップ**: `scope: "all"`。`people` / `projects` と全 `modules` を含む。
- **モジュール単体エクスポート**: `scope: "<moduleId>"`。`people` / `projects` は参照解決に必要な分のみ含める（メンバー/プロジェクトを名前で再解決できるよう同梱）。
- **人のみ / プロジェクトのみ**: `scope: "people"` / `scope: "projects"`。
- 各 `modules.<id>.data` の中身は、対応する既存 `spec.md` のデータモデルに準拠する（タスク配列、goals 配列等）。
- 日時は ISO 8601 UTC 文字列、日付のみのフィールドは `YYYY-MM-DD`。未設定の任意項目は省略せず `null` / `[]` / `""` を入れる（人間・AI が構造を推測しやすくするため。todo-kun の規約を全モジュールへ展開）。

### 4.3 インポート方針
- 取り込み時に `置換 / マージ` を選べる（既存 todo-kun・各ツール準拠）。
  - **置換**: 対象 scope を全消去して取込内容で再構築。
  - **マージ**: `id` 一致で上書き、なければ追加。マスタ参照は §4.4 の名前解決で再結合。
- `schema` 不一致・`schemaVersion` 未来値は警告し、可能ならマイグレーション（§4.5）、不能なら中断。
- 壊れた JSON でもアプリは起動し、エラーを握りつぶさず案内する（堅牢性）。

### 4.4 人の管理（People）とプロジェクト管理（Project）

人とプロジェクトは性質も関係するモジュールも異なるため、**独立した2つの管理ドメイン**として分離する（別ストア `mk:people` / `mk:projects`、別管理画面）。両者を1つの「マスタ」に混ぜない。

モジュールごとの利用関係（軸が直交している＝分離が妥当な根拠）:

| モジュール | People を使う | Project を使う |
|---|---|---|
| goals | – | 任意（Goal↔Project） |
| skills | ✓ | – |
| workload | ✓ | 任意 |
| todo | – | ✓ |
| wbs | ✓ | 任意 |

#### People マスタ — Member（人） … `mk:people:v1`
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

#### Project マスタ — プロジェクト管理ドメイン … `mk:projects:v1`
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

#### アロケーションマスタ — 計画（人×器×期間×割当%） … `mk:allocations:v1`
マネージャがトップダウンで planning する**共有された計画事実**（§3.7.5）。People / Projects と同格の**中立な共有マスタ**として独立させ、特定モジュールに属させない（Issue #45 で workload 内部から昇格）。参照・編集は `ctx.allocations` 経由（§3.5）で、直接 localStorage を触らない。編集（planning）は要員計画（staffing）が担う。

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | string | 一意ID（`a_<epoch>_<rand>`。昇格前の workload 由来は `wa_…` を保持） |
| `memberId` | string \| null | 対象メンバー（People 参照） |
| `targetId` | string \| null | 器のID（現状 Project 参照。次元は `dim` で識別） |
| `dim` | string | 次元キー（器の種類。既定 `project`・将来 `product`。§3.7.6 の config 由来。`"project"` 決め打ち禁止） |
| `startDate` / `endDate` | string | 割当期間（YYYY-MM-DD、未設定は空文字） |
| `percent` | number | 割当率(%)。100 超も許容（過剰アサインの可視化） |
| `note` | string | 備考（任意） |

- WBS の担当（`assigneeId`）・workload のタスク（負荷）とは**別レコード**。片方から導出せず、片方を変えても他方に影響しない（§3.7.5）。
- 集計純関数 `percentOn(list, memberId, date)`（器を跨いだ期間内合算）をマスタが提供し、要員計画の「空き＝キャパ−全器割当」算出が再利用する。

### 4.5 スキーマバージョニングとマイグレーション
- バージョンは2階層: エンベロープの `schemaVersion`（全体構造）と、各 localStorage キー／`modules.<id>.version`（個別データ構造）。
- マイグレーションは名前空間ごとに登録する連鎖関数で表現する。

```js
MK.migrations["module:wbs"] = [
  { to: 2, up(data){ /* v1→v2 */ return data; } },
  { to: 3, up(data){ /* v2→v3 */ return data; } },
];
```

- 読込時、`store` が現行バージョン未満のデータに `up()` を**昇順で順次適用**し、最新化してから利用・保存する。
- 現行より**新しい**バージョン（未知の上位）を検出したら読込を拒否し、警告する（壊さない）。
- エンベロープ取込時も `schemaVersion` を同様に判定する（§4.3）。
- 旧ツールの localStorage キー / 旧 JSON からの移行は §7（名寄せは §8）。

### 4.6 CSV 規約（共通）

> **本節の詳細は [`spec/import-migration.md`](spec/import-migration.md) §4.6 / §4.6.1 に分離。** UTF-8（BOM許容/出力はBOM付き）・RFC4180 自前パーサ・名前参照・寛容解釈で `shared/io.js` に集約。CSV 対象は **skills / wbs**。共通ドメイン（People / Project）の列仕様、モジュール固有列（各 `spec/modules/<id>.md`）の参照先も同ファイルを正とする。名前参照は取込時に §8 名寄せで解決する。

### 4.7 ID・採番規約
- **マスタ**: People `m_<base36 epoch>_<rand>`、Project `p_<base36 epoch>_<rand>`。グローバルに一意。
- **マスタ参照**: People = `memberId`（string）、Project = `projectId`（string）。wbs の担当は `assigneeId`（People の string ID）。
- **モジュール内部 ID**: 既存方式を踏襲して移行リスクを避ける（goals: `g_`/`s_`、todo: `t_<epoch>_<rand>`、wbs: 数値 `uid++`（`deps` が数値参照のため変更しない）、workload/skills: 既存採番）。
- ID は**再利用しない**。

### 4.8 アプリ設定 `mk:settings:v1`
UI 状態と移行フラグを集約する（モジュールのデータとは分離）。

```json
{
  "version": 1,
  "lastModule": "todo",
  "startView": "home",
  "theme": "dark",
  "migration": { "fromLegacyDone": true },
  "ui": {
    "wbs":      { "colWidths": [] },
    "workload": { "range": "quarter" }
  }
}
```

- `lastModule`: 直近に開いていたモジュール（`startView === "last"` のとき起動先に使う）。
- `startView`: 起動先。`"home"`（既定）＝ HOME を表示 / `"last"` ＝ `lastModule` を復元（§3.6）。
- `theme`: `"light"` / `"dark"`。未設定時は OS の `prefers-color-scheme` に従う（§6.2）。
- `migration.fromLegacyDone`: 旧ツール自動移行の実施済みフラグ（§7.5）。
- `ui.<moduleId>`: 各モジュールが必要とする UI 状態（列幅・表示期間など）。`ctx.settings` 経由で読み書きする。

---

## 5. モジュール仕様（位置づけと固有データ）

各モジュールの**統合上の位置づけ・共通マスタとの関係・固有データ・CSV 列・旧データ移行元は、モジュール個別仕様（[`spec/modules/<id>.md`](spec/modules/)）を正**とする。さらに機能の詳細挙動は各ツールの既存 `spec.md` を正とする。本節はモジュール一覧のみを示す（個別詳細は本書に重複させない）。

| id | 名称 | ゾーン | 個別仕様 | CSV |
|---|---|---|---|---|
| goals | 目標みえるくん | 自分 | [`spec/modules/goals.md`](spec/modules/goals.md) | – |
| skills | スキル可視化 | ピープル | [`spec/modules/skills.md`](spec/modules/skills.md) | ✓ |
| workload | タスク負荷可視化 | ピープル | [`spec/modules/workload.md`](spec/modules/workload.md) | – |
| staffing | 要員計画（横断） | ピープル | [`spec/modules/staffing.md`](spec/modules/staffing.md) | – |
| todo | GTD ToDo | 自分 | [`spec/modules/todo.md`](spec/modules/todo.md) | – |
| wbs | WBS / ガント | デリバリー | [`spec/modules/wbs.md`](spec/modules/wbs.md) | ✓ |

- 共通マスタの利用関係（People / Project）の一覧は §4.4 を参照。
- モジュール追加・削除の手順は [`CONVENTIONS.md`](CONVENTIONS.md) §5、新規モジュールの個別仕様も `spec/modules/<id>.md` として同じ体裁で追加する。

### 5.6 タスクのスキーマは統一しない（明示）
todo / wbs / workload の「タスク」は意味も構造も異なる（GTD状態 / 階層+依存 / 負荷+期間）。これらを単一スキーマへ強制統合しない。統一するのは **エンベロープ・命名・CSV規約・共通マスタ参照**までとする。

---

## 6. デザイン統一

### 6.1 方針
- 全モジュールが `shared/design.css` のみを参照し、[`DESIGN.md`](DESIGN.md) のトークンを CSS 変数として実装する。
- モジュール独自の色・余白・角丸の直書きを禁止し、必ずトークン経由で指定する。

### 6.2 トークン実装（`shared/design.css`）
- `DESIGN.md` の `colors` / `typography` / `rounded` / `spacing` を `:root` の CSS 変数へ1:1で写像する。
  - 例: `--color-primary:#5645d4;` `--rounded-md:8px;` `--space-xl:24px;` 等。
- フォント: 外部依存ゼロのため Notion Sans は読み込めない。`--font-sans` をシステムスタック（`Inter, -apple-system, system-ui, 'Segoe UI', 'Hiragino Kaku Gothic ProN', Meiryo, sans-serif`）で定義し、日本語表示も担保する。
  - DESIGN.md の「Inter で代替しない」方針は外部フォント前提のため、依存ゼロ制約を優先して逸脱する（既知の差分として記録）。
- **ダークモード**: `[data-theme="dark"]` で色トークンを上書きする（`shared/design.css`）。初期テーマは `mk:settings.theme`、未設定時は OS の `prefers-color-scheme` に従う。
  - 切替時に `theme:changed` を `MK.bus` で発火する。Canvas / SVG で自前描画するモジュール（goals / skills / workload / wbs）は、色を**描画時に CSS 変数から読み**、このイベントで**再描画**する（CSS のように自動追従しないため）。
  - DESIGN.md にダーク値の定義がない（Known Gaps）ため、ダーク配色は本アプリ独自の派生とする。

### 6.3 共通コンポーネント
DESIGN.md の `components` をクラスとして提供（最低限の初期セット）:
- ボタン: `.btn-primary`（purple 8px角丸）/ `.btn-secondary` / `.btn-dark` / `.btn-ghost` / `.btn-link`
- カード: `.card` / `.card-feature` + パステル `tint` バリアント
- 入力: `.text-input`（44px・focus で primary 2px ボーダー）/ `.search-pill`
- タブ: `.pill-tab` / `.segmented-tab`（アクティブ状態あり）
- バッジ: `.badge-*`（purple/pink/orange + tag chips）
- テーブル: `.comparison-table` / 行ホスト
- 構造: ダーク hero band、フッター、トースト、モーダル
- 規律: ボタンは 8px 角丸（ピル不可）、カードは 12px、ピル/バッジのみ `full`。primary purple は本文・大面積背景に使わない。inline リンクは link-blue。

### 6.4 アプリシェルの画面構成
1. 上部ナビ（白・sticky）: アプリ名「マネジメントくん」 + モジュール切替（pill タブ）+ 右側にテーマ切替・全体バックアップ（エクスポート/インポート）。
2. モジュール切替は**ゾーンに分けて表示**（§1.4）: 「**自分**」（ToDo / 目標）｜「**ピープル**」（スキル / 負荷 / 要員計画）｜「**デリバリー**」（WBS）。各ゾーンにラベルを付け、区切りで分離する（プロダクト/テクノロジーは現状モジュールが無いため表示しない）。
3. メイン: 選択モジュールの描画領域。
4. **マスタ管理**: 人・プロジェクトの管理画面。マスタは特定ゾーンの持ち物ではなく、`home` / `settings` と同列の**シェルレベル特別ビュー**（§3.6）であり、ナビでは**ゾーン群と設定の間の独立グループ「マスタ」**として並べる（Issue #46）。人とプロジェクトは**別ドメイン**（別ストア・別 CRUD・名寄せ）であり、その独立グループの下に**ドメインに沿って別エントリ・別ビューで分離**して並列に置く ──「👤 人」（`master-people`）／「📁 プロジェクト」（`master-projects`）。プロジェクトは wbs だけでなく workload からも参照される横断マスタ（`scope: "global"`・§4.6）のため、特定ゾーン配下に置くと横断性が過小表現になる。マスタは業務データであり、設定(config)とは混ぜない。
5. 設定: アプリ設定・全体バックアップ（エクスポート/インポート）。

---

## 7. 移行・互換性

> **本章の詳細は [`spec/import-migration.md`](spec/import-migration.md) §7 に分離。** 旧 localStorage キー / 旧 JSON の検出・取り込み（§7.1・§7.3）、メンバー/プロジェクトの名寄せ（§7.2 → §8）、段階リリース順（§7.4）、移行トリガと UX（§7.5）を規定する。各モジュールの旧キー / 形状 → 移行先の対応は、モジュール個別仕様（[`spec/modules/<id>.md`](spec/modules/)）の「旧データ移行」節を正とする。

---

## 8. 名寄せ（参照解決）

> **本章の詳細は [`spec/import-migration.md`](spec/import-migration.md) §8 に分離。** 名前（文字列）をマスタ実体（People / Project の `id`）へ解決する共通処理（`shared/people.js` / `shared/projects.js` に集約）。照合キー正規化（§8.2）・判定（§8.3）・ハイブリッド確定（§8.4）・レビュー画面（§8.5）・未解決の保持（§8.6）・手入力（§8.7）・マスタのマージ（§8.8）・冪等性（§8.9）・CSV/JSON との関係（§8.10）を規定する。移行・CSV/JSON 取込・手入力で共用する。

---

## 9. MVP とフェーズ計画

統合プロジェクトの観点での MVP / Phase 2 を定義する（各モジュール内部の MVP は既存 spec.md に従う）。

> **実装状況（v1・実装済み）**: §9.1 の MVP は完了。シェル＋5モジュール（todo/goals/wbs/skills/workload）・デザイン統一・人/プロジェクトマスタ・旧データ自動移行・全体JSON入出力・設定に加え、**ダークモード**・**領域別のゾーン分け（自分＋4領域・§1.4）**・**共有UIヘルパ**・**logic/view 分割**（CONVENTIONS.md）も実装済み。以降は §9.2 Phase 2。

### 9.1 MVP（v1）に含むもの
- 単一ページ・シェル＋モジュール登録（§3.5）。
- デザイン統一: `shared/design.css`（DESIGN トークン＋共通コンポーネント）（§6）。
- 人 / プロジェクト マスタの CRUD と基本管理画面（§4.4）。
- 5モジュールの移植: 既存機能を維持し、デザインとデータ規格（`mk:*` / エンベロープ）を統一（§5）。
- 旧データの自動移行（§7.5。名寄せは自動作成のみ＝レビュー画面なし）。
- 全体 JSON 入出力（`scope:"all"`）（§4.2）。
- 設定 `mk:settings`（最低限: `lastModule` / 移行フラグ / 必要な UI 状態）（§4.8）。
- 堅牢性・エラーハンドリングの最低線（§10）。

### 9.2 Phase 2（MVP 後）
- 名寄せレビュー画面＋近似一致の「要確認」運用（§8.5）。
- マスタの事後マージ＋Undo（§8.8）、「未解決の名前」一覧（§8.6）。
- CSV 統一の全モジュール展開（現状 skills/wbs → 人/プロジェクト/他へ）（§4.6.1）。
- プロジェクト・ダッシュボード（横断集約ビュー）（§4.4）。

### 9.3 MVP に持ち込まないもの
- 各モジュールへの新機能追加（統合 MVP は「現状機能の移植＋規格/デザイン統一」まで）。
- §12 スコープ外の項目。

### 9.4 構築順
§7.4（段階リリース）の順に従う: 基盤（design / store / io / people / projects / shell）→ todo → goals → wbs → skills → workload。

---

## 10. 非機能要件
- オフライン完全動作（`file://`・ネットワーク不要）。
- パフォーマンス: 各モジュールの既存想定（例: skills は数十名×数百スキル、wbs は数百タスク、todo は数百〜千件）をシェル統合後も維持。
- 可搬性: フォルダごとコピーで別環境へ移動可能（データは JSON で別途移動）。

### 10.1 エラーハンドリング・堅牢性
- 起動時、各 localStorage キーを**個別に** try/parse する。あるキーが壊れていても他は読み込み、影響を1モジュール/マスタに限定する。
- 壊れたキーは「初期化する／そのデータのみ破棄して続行」をユーザーに案内し、無言で消さない。
- JSON / CSV 取込はスキーマ・バージョン検証 → 失敗時は中断し**理由を表示**（握りつぶさない）。部分的に不正な行はスキップして件数を警告（§4.6 / §8.10）。
- 破損検知時は全体バックアップ（JSON）への導線を提示する。

### 10.2 アクセシビリティ・キーボード
- 主要操作はキーボードで到達可能、フォーカスを可視化、適切なラベル / `aria` を付与する。
- コントラストは DESIGN トークン準拠（§6）。
- 既存ショートカット（todo のクイックキャプチャ Enter、編集 Esc キャンセル等）を尊重し、モジュール横断で一貫させる。

---

## 11. 受け入れ条件（統合観点）
1. `index.html` を `file://` で開くだけで、5モジュールすべてに切替・操作できる（外部通信ゼロ）。
2. メンバーを「人の管理」に1回登録すると、skills と workload の双方で同じメンバーとして参照される（再読込後も保持）。
3. 全体バックアップ（`scope:"all"`）を JSON で書き出し、別環境でインポートして全モジュール+人/プロジェクトを復元できる。
4. skills / wbs の CSV が共通規約（UTF-8 BOM・名前参照・寛容パース）で入出力でき、名前でマスタへ解決される。
5. 全モジュールが同一の DESIGN トークン・コンポーネントで描画され、見た目が統一されている。
6. 旧5ツールの localStorage / 旧 JSON を取り込み、メンバー/プロジェクトが名寄せ統合される。
7. 壊れた JSON / localStorage でもアプリが起動し、エラーを握りつぶさず案内する。

---

## 12. 決定事項サマリー

| 論点 | 決定 |
|---|---|
| アーキテクチャ | 単一ページ・シェル + モジュール差し替えロード（classic script・`window.MK`）。ビルド不要・`file://`・依存ゼロ。 |
| データ統合の深さ | 人の管理（People）とプロジェクト管理（Project）を**独立ドメインに分離**して共有 + JSON エンベロープ・localStorage 命名・CSV 規約を統一。各モジュール固有データは独立。 |
| 人 / プロジェクト | 別ストア・別管理画面に分離（軸が直交）。Project は本バージョンは軽量マスタに留め、横断集約ビューは将来拡張。 |
| ナビ分類（ゾーン） | アプリは「マネージャの作業机」。ナビを **自分（todo/goals）** ＋ **EM が見る4領域（ピープル/デリバリー/プロダクト/テクノロジー）** で分類（§1.4）。現状モジュールがあるのは自分/ピープル(skills/workload＋人マスタ)/デリバリー(wbs＋プロジェクトマスタ)で、プロダクト/テクノロジーは将来の棚。マスタ管理はドメインに沿って分離し、人＝ピープル・プロジェクト＝デリバリーに別エントリで置く（§6.4）。goals は自分ツールで Member/Project と結び付けない（KPI/OKR に見せない）。チーム OKR は将来別モジュール（§1.4）。 |
| タスクスキーマ | 統一しない（todo/wbs/workload は別構造のまま）。 |
| スコープ次元 | ゾーンに直交する第2軸として **スコープ次元**（「その中に入って作業する対象」＝現状 Project・将来 Product）を定義。People は参照マスタで次元にしない（§3.7.1）。 |
| 単一/複数 | 単一は「要素数1の縮退形」。別モードを作らず config 駆動で差を出す（§3.7.2）。「現在の対象」は次元ごとに独立（§3.7.3）。 |
| scoped データ | 登録は1モジュール・保存は対象別 namespace `mk:module:<id>:<targetId>:v1`（ハイブリッド。§3.7.4）。scoped は `ctx.scope` を受け取る。 |
| 要員計画 | PJ 横断俯瞰は**共有アロケーション**（人×器×期間×%）を参照。WBS 担当とは別レコード（同じ People を指す）。当面 workload を次元対応させて実装、WBS は独立維持（§3.7.5）。 |
| 次元の実体化 | 型/契約のみ汎用定義、配線は Project のみ。Product はモジュール追加時に実体化（YAGNI）。コードで `"project"` 決め打ち分岐しない（§3.7.6）。 |
| localStorage 命名 | `mk:` プレフィックスで統一（`mk:people:v1` / `mk:projects:v1` / `mk:module:<id>:v1` / `mk:settings:v1`）。 |
| JSON | 共通エンベロープ `{schema, schemaVersion, exportedAt, scope, people, projects, modules}`。 |
| CSV | UTF-8（BOM許容/出力はBOM付き）・RFC4180 自前パーサ・名前参照・寛容解釈。skills/wbs が対象。 |
| 名寄せ正規化 | NFKC＋trim＋連続空白圧縮＋英字小文字化。全角/半角・空白差は自動統合。空白有無のみの差は「要確認」へ。 |
| 名寄せ確定 | ハイブリッド：完全一致=自動リンク／未一致=新規マスタ作成／近似一致のみレビュー停止。未解決は原文を保持。 |
| フォント | 外部依存ゼロのためシステムフォントスタックで代替（Notion Sans 非読込）。 |
| ダークモード | `[data-theme="dark"]` でトークン上書き。テーマは `mk:settings.theme`（未設定は OS 設定）。切替で `theme:changed` 発火（グラフ再描画用フック）。配色は独自派生。 |
| アプリ名 | **マネジメントくん**（技術名/ディレクトリ `management-kun`）。 |
| MVP | 基盤＋デザイン統一＋人/プロジェクトマスタ＋5モジュール移植＋旧データ自動移行（名寄せは自動作成）＋全体JSON入出力。名寄せレビュー/CSV統一/マスタ統合は Phase 2。 |
| ID採番 | マスタは `m_`/`p_`。モジュール内部IDは既存方式を踏襲（wbs は数値 `uid` を維持）。再利用しない。 |
| 成果物範囲 | 本書は全体統合仕様。モジュール詳細は各既存 spec.md を参照。 |

---

## 13. スコープ外
- サーバー連携・クラウド同期・ログイン・複数ユーザー同時編集。
- エンティティの完全統合（単一データストア化）。
- 通知・リマインダー、モバイルアプリ化。
- 各モジュール既存 spec の「スコープ外」項目は引き続き対象外。

---

## 14. 未決事項（実装フェーズで詰める）

v1 実装済み（§9 の実装状況を参照）。残るは主に Phase 2 と将来検討・細部の磨き込み。

- アプリ**アイコン**のデザイン（名前は確定: マネジメントくん）。
- 細かな表示調整（各モジュールの余白・レスポンシブの詰め）。共有層（`design.css`/`ui.js`）で対応する（CONVENTIONS.md）。
- （Phase 2）名寄せレビュー画面（§8.5）・マスタの事後マージ（§8.8）・「未解決の名前」一覧（§8.6）・CSV 統一の全モジュール展開・レーダーチャート（skills）。
- （Phase 2 / 将来）プロジェクト・ダッシュボード、モジュール間クロス機能（例: wbs → workload 負荷流し込み、担当合計 vs アロケーション照合）。
- **（思想確定・実装は段階進行）スコープ次元（§3.7）**: 「PJ 横断 / PJ 単位」軸の思想は §3.7 で確定済み。**実装済み**: シェルのスイッチャ・`ctx.scope`（#24）／wbs の対象別 namespace 化（#25）／workload の次元対応（共有アロケーション `人×器×期間×%`。#26）／要員計画モジュール（横断ビュー `staffing`。#27）。**残る実装**: Product 実体化は後続 Issue で扱う。
- （将来）チームの OKR/KPI 管理。必要になれば goals とは別概念の新モジュールとして検討する（§1.4）。
