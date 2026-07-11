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
- 「自分」ゾーンの **todo と questions は統合しない・状態を自動連動させない**。両者は終端状態が正反対（todo＝完了すると消える"行動"／questions＝解決すると残る"ナレッジ資産"）で目的が異なる（todo＝実行／questions＝学習・成長管理）。したがって捕捉口の統合や、todo 完了で question を自動 resolve する等のライフサイクル結合は行わない（後者は questions の要である「わかった内容の記録」を飛ばし価値を損なう）。将来つなぐ場合も、状態を連動させないソフトな一方向参照（例: question から next action の todo を作る戻りリンク）に留める。
- サーバー連携・クラウド同期・認証は引き続きスコープ外（§13）。

### 1.4 プロダクトの位置づけ：マネージャの作業机（自分＋4領域）
本アプリの利用者は**マネージャ個人**を想定する。ナビは「自分の作業机」を、**自分**（マネージャ本人の作業）＋**EM が見る4領域**で分類する。「チーム管理」のような『自分以外』の一括りではなく、**見る対象の領域**で切ることで、モジュールを増やして育てる際の「棚」を明確にする。

| ゾーン | 主語 / 対象 | モジュール | People マスタ |
|---|---|---|---|
| **自分** | 自分（マネージャ） | todo（自分のタスク）/ goals（自分の目標）/ questions（わからないこと） | 使わない |
| **ピープル** | メンバー・チーム | skills / resource / oneonone | 使う |
| **デリバリー** | プロジェクトの遂行 | wbs | 使う |
| **プロダクト** | 作るもの（成果物） | releases（リリース台帳。成果物マスタは 📦 プロダクト・§4.4） | 使わない |
| **テクノロジー** | 技術・基盤 | techstack | 使わない |

> この表は**ゾーンの分類（棚）・主語・People マスタ利用**という固有情報を示す。「モジュール」列は棚を説明するための代表であり、**モジュール id の正準一覧は §5・実際のゾーン割当は各エントリ HTML の `MK_CONFIG.zones`（§1.5）を正とする**（モジュール追加時はまず §5、必要ならゾーン行を同期する）。

- **領域名「デリバリー」**: プロジェクト遂行の領域だが、横断マスタの **Project**（§4.4）と語がぶつかるため、領域名には「プロジェクト」を用いず **デリバリー** と呼ぶ。
- **マスタ（人・プロジェクト・プロダクト）はゾーンに属さない**。各ゾーンのモジュールは People/Project マスタを**参照・編集**するが（「People マスタ」列＝そのゾーンがマスタを使うか）、マスタ自体は特定ゾーンの持ち物ではなく `home` / `settings` と同列の**シェルレベル管理カテゴリ**として独立させる（ナビでもゾーン群と設定の間の独立グループ「マスタ」に置く。§3.6 / §6.4）。とくに Project は wbs（デリバリー）だけでなく workload（ピープル）からも参照される横断マスタ（§4.4 / §4.6）であり、いずれかのゾーン配下に固定すると横断性が過小表現になる。
- **プロダクトゾーンは releases（リリース台帳・Issue #84）の追加で新設**した。成果物そのものの台帳＝**Product マスタ（📦 プロダクト・§4.4）**はそれに先行して新設済みで、シェルレベルの「マスタ」グループに人・プロジェクトと並ぶ（Issue #37）。このマスタは §3.7 の Product スコープ次元のマスタを兼ね、次元化（`MK_CONFIG.dimensions` への追加）は Issue #54 で完了済み（releases は横断モジュールで、product-scoped モジュールはまだ無い。判断は [`spec/modules/releases.md`](spec/modules/releases.md)）。テクノロジーは techstack（Issue #36）の追加でゾーンを新設した。
- **自分ゾーン**は「マネージャ個人の領域（goals）＋マネージャとしてのタスク領域（todo）」。**goals は個人ツール**（自分の目標ロードマップ）であり、チームの KPI/OKR ではない。メンバーやプロジェクトと結び付けない（チーム目標管理に見せない）。
- 将来「チームの OKR/KPI 管理」が必要になった場合は、goals とは**別概念の新モジュール**として検討する（今は作らない・§14）。
- **PJ 横断 / PJ 単位のスコープ軸**（例: 横断要員計画 vs PJ 単位 WBS）は、この領域分類とは**直交する別軸**。「同種のものを複数持つ／単一で持つ」を統一的に扱う **スコープ次元**として §3.7 に定義する（本節の分類には含めない）。

### 1.5 配布プロファイル（複数エントリHTML）
1コードベースを維持したまま、**エントリHTMLごとに「積むゾーン／モジュール」を差し替える**ことで、用途別の配布形態を用意する。フォーク（`shared/*` や todo/goals の二重化）はしない。

- **仕組み**: 各エントリHTMLが `window.MK_CONFIG = { profile, zones: [...] }` を宣言し、`shared/manifest.js`（構成マニフェスト・単一ソース・Issue #137）を1本読み込む。manifest が config に応じて共有資産＋必要なモジュールの `<script>`（logic→view）＋シェルを読込順を保って動的注入する（エントリ側で `<script>` を並べない）。マネージャ（`index.html`）は `zones` を宣言せず manifest 既定（全部入り）を使う。シェル（`shared/shell.js`）は config／manifest を読んで描画するだけで、どのプロファイルにも依存しない。エントリ・モジュールを足してもシェル本体の改修は不要。
- **分離の強さ**: 読み込まなかったモジュールは、コードもデータ（`localStorage`）も**物理的に存在しない**。見た目（ナビ非表示）だけでなく実データ的にも分離される。
- **標準プロファイル**:

| エントリ | profile | ゾーン | 用途 |
|---|---|---|---|
| [`index.html`](index.html) | `manager` | 自分＋ピープル＋デリバリー＋プロダクト＋テクノロジー（全部入り）＋マスタ管理 | マネージャ本人 |
| [`member.html`](member.html) | `member` | 自分のみ（todo / goals / questions） | チームメンバーへ配布。ピープル/デリバリー/プロダクト/テクノロジーの各モジュールとマスタ管理には到達不能 |

- メンバーが入力した todo / goals / questions は、既存の JSON エクスポート／インポート（§7）でマネージャ側に回収できる（専用フローは作らない）。
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
├── index.html              … シェル（マネージャ全部入りプロファイル）。これを開く。
├── member.html             … 配布プロファイル（メンバー配布用・自分ゾーンのみ。§1.5）
├── shared/
│   ├── design.css          … DESIGN.md 由来のトークン + 共通コンポーネント + レスポンシブ
│   ├── core.js             … window.MK 名前空間・共通ユーティリティ（el/uid/日付/名寄せキー/escape）
│   ├── store.js            … localStorage 永続化・スキーマ/マイグレーション
│   ├── scope.js            … スコープ次元の汎用走査（dimOf/entities/現在の対象。§3.7）
│   ├── io.js               … JSON エンベロープ入出力・CSV パーサ/シリアライザ
│   ├── people.js           … 人の管理（members）の CRUD・名寄せ解決API
│   ├── projects.js         … プロジェクト管理（projects）の CRUD・名寄せ解決API
│   ├── products.js         … プロダクト（成果物）マスタの CRUD・名寄せ解決API（§4.4）
│   ├── allocations.js      … アロケーション共有マスタ（人×器×期間×%。§3.7.5）
│   ├── demands.js          … 需要共有マスタ（器×期間×必要%。Issue #68）
│   ├── ui.js               … 共通UI部品（レイアウト/フォーム/モーダル/トースト）
│   ├── sample.js           … サンプルデータ投入
│   └── shell-*.js / shell.js … シェル（プロファイル非依存）。責務別に分割（Issue #140）。連携は
│                              window.MK.shell 経由。core=起動基盤/ルーター、nav=ナビ、home=HOME、
│                              palette=検索、masters=マスタ管理、settings=設定/移行、shell.js=ブート配線
├── modules/                … 各モジュール = `<id>/{logic,view}.js`（logic/view 分割。CONVENTIONS.md §1）
│   └── <id>/{logic,view}.js … id の一覧・ゾーン・CSV 対応は §5 のモジュール一覧表を正とする
├── test/                   … 依存ゼロの自動テスト（node test/run.js。TESTING.md）
├── DESIGN.md               … デザインシステム
├── CONVENTIONS.md          … UI/レイアウト規約・logic/view 分割・完成チェックリスト
├── CODING.md               … コーディング規約
├── CLAUDE.md               … 作業ガイド
├── TESTING.md              … テスト指針・変更影響マトリクス
├── README.md               … 概要・使い方・ドキュメント索引
├── spec.md                 … 共通（統合）仕様。これが最上位の正。
└── spec/
    ├── masters.md          … 共通マスタ（§4.4）: 共通契約＋People/Project/Allocation/Product。マスタ追加・修正時に参照。
    ├── import-migration.md … 取り込み・移行・名寄せ（§4.6 CSV / §7 移行 / §8 名寄せ）。取込・移行作業時のみ参照。
    ├── consolidation.md    … モジュール統廃合（module→module）の移行テンプレート（§9.6）。統廃合を実施する時のみ参照。
    └── modules/            … モジュール個別仕様（統合上の位置づけ・固有データ・CSV列・旧データ移行）
        └── <id>.md          … §5 の各モジュールに 1:1 対応（体裁は CONVENTIONS.md §5）
```

- 仕様は2層: **共通仕様 `spec.md`**（全モジュールに効く取り決め）＋ **個別仕様 `spec/modules/<id>.md`**（そのモジュールだけの取り決め）。修正・機能追加時は「共通仕様＋対象モジュールの個別仕様」だけを読めば足りるようにする。
- 共通仕様のうち、**取込・移行・名寄せ（§4.6 CSV / §7 / §8）は [`spec/import-migration.md`](spec/import-migration.md) に分離**した。CSV/JSON 取込・旧データ移行・名寄せを触るときだけ読めばよく、通常のモジュール編集では不要。

- 各モジュール JS は `window.MK.registerModule(id, { title, icon, description, mount, unmount })` で自身を登録する。`description` は「何ができるか」の1行説明で、HOME が初見の見取り図として描画する（§3.6・Issue #40）。
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
  description: "日々のやることを整理して前に進める", // HOME が描画する1行説明（何ができるか。§3.6 / Issue #40）
  mount(container, ctx) { /* 描画 */ },
  unmount() { /* DOM破棄 */ },
  summary() { return /* {...} */; },             // 任意。HOME サマリー（§3.6）
  searchItems() { return /* [...] */; },         // 任意。グローバル検索の対象レコード（§3.5.1）
  exportData() { return /* data */; },          // JSONエンベロープ modules.<id>.data 用
  importData(data, mode) { /* "replace" | "merge" */ },
  migrate(data, fromVersion) { return data; }    // §4.5
});
```

#### 3.5.1 グローバル検索と `searchItems()` 契約（任意。Issue #82）

シェルは **Ctrl+K（Mac: Cmd+K）** でコマンドパレットを開き、モジュール横断でインクリメンタル検索する（キーボードのみで完結＝↑↓選択・Enter 決定・Esc 閉じる。§10.2）。検索対象はシェルが1本の配列に集約する:

- **マスタ**: 人（People）・プロジェクト（Project）・プロダクト（Product）。到達可能なマスタ（配布プロファイルで有効なもの）だけを候補にする。
- **モジュール名**（画面ジャンプ）: ナビと同じ条件（カタログ既知・非表示除外・到達可能）。
- **各モジュールの主要レコード**: 各 def が**任意**で `searchItems()` を実装して供給する。

```js
searchItems() {
  return [
    { id: "t_xxx", label: "ログイン画面を直す", sub: "Next · 認証基盤", keywords: ["OAuth"] }
  ];
}
```

- `label`（主・必須）／`sub`（補助表示・任意）／`keywords`（追加の探索対象・任意）。選択するとそのモジュールへ遷移する（`route(<id>)`）。
- **`searchItems` は任意契約**（`summary()` と同型）。未実装・例外・不正形式のモジュールはシェルが無視し、候補が増えないだけで壊れない。
- マッチング（正規化・部分一致スコア・複数トークン AND・並べ替え）は DOM 非依存の純関数 `MK.search`（`shared/search.js`）に置き、テスト可能にする（`test/search.test.js`）。実装例: todo=未完タスク、questions=未解決の質問＋ナレッジ、goals=未達成の目標、releases=中止以外のリリース、techstack=技術台帳の全アイテム、wbs=全 PJ 横断の未完の葉タスク（Issue #144）。

ホストが `mount(container, ctx)` に渡す `ctx`:

| API | 役割 |
|---|---|
| `ctx.people` | People マスタの参照・CRUD・名寄せ解決（`list/get/resolve(name)/create`）（§8） |
| `ctx.projects` | Project マスタの同上 |
| `ctx.allocations` | アロケーション共有マスタの参照・CRUD（`all/get/of/forTarget/create/update/remove/percentOn`）（§3.7.5 / §4.4） |
| `ctx.demands` | 需要共有マスタの参照・CRUD（`all/get/forTarget/create/update/remove/demandOn/totalDemandOn`）（§4.4 / Issue #68） |
| `ctx.scope` | scoped モジュールに渡る「現在の対象」`{ dim, id, entity }`（§3.7.3）。global モジュールでは `null` |
| `ctx.route` | 別ビューへ遷移する `route(view)`。横断集約ビュー（ダッシュボード等）が各サマリから該当モジュールへ誘導するための導線。同一次元の scoped モジュール間（dashboard → wbs）は「現在の対象」を引き継ぐ（§3.7.3） |
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

シェルは `home` を **`master-people` / `master-projects` / `master-products` / `settings` と同列のシェルレベル特別ビュー**として持つ。ナビ先頭に「🏠 HOME」を置き、起動時の既定表示先にする（マネージャの「作業机」＝ §1.4）。

- **HOME は1枚**。ゾーンごとに別 HOME は作らない。中身は HOME 固有の価値だけに絞り、**2段階**で描画する（Issue #100 / #169）: 先頭に「**要対応」帯**（表示中モジュールの `summary().attention` を集約した severity 別の色バッジ。Issue #102）、次に「ピン留め」セクション（`pinnedModules`・§4.8 のモジュールをサマリーカードのグリッドで表示）。**モジュール一覧の常設表示はサイドバー（常設ランチャー）に一本化し、HOME には置かない**（Issue #169。モジュール増加で HOME を肥大させない）。配布用エントリ（`member.html`）では `ZONES` にピープル/デリバリーゾーンが無いため、ピン留め候補も自動的に「自分」ゾーンのモジュールだけになる。
- **要対応帯**: バッジは重要度順（error → warn → info。同重要度はゾーン順）に並べ、クリックで該当モジュールへ遷移する。要対応が1件も無ければ帯そのものを表示しない。非表示（`hiddenModules`）のモジュールの attention は集約しない。
- ピン留めカードは該当モジュールへ `route` するランチャーを兼ねる（クリック／Enter・Space）。カタログ（`META`）未知のモジュールと非表示（`hiddenModules`・§4.8）のモジュールは出さない（**非表示はピン留めより優先**）。未実装モジュールは「準備中」表示。
- **1行説明（何ができるか。Issue #40）**: 各モジュール def の `description` を、ピン留めカードは見出しと stats の間に添える。説明文は def を単一ソースとし、シェル（`META`）にハードコードして二重管理しない。準備中（未実装＝def なし）は説明を持たない。
- ピン留めカード右端の ★/☆ トグルで解除できる（`aria-pressed`。トグルはランチャーのクリックと独立）。**ピン留めの追加はサイドバー**（各モジュール項目の右端 ☆。§6.4）から行う。ピンが1つも無いときはピン留めセクションの代わりに案内文（サイドバーの ☆ を押す旨）を表示する。ピンの表示順は `pinnedModules` の配列順（＝ピン留めした順）。
- **起動先**は既定 HOME。設定 `mk:settings` の `startView`（`"home"` | `"last"`）が `"last"` のときだけ前回モジュール（`lastModule`）を復元する。設定画面のトグルで切替。

各モジュール def は**任意**で `summary()` を実装できる（logic 側 `MK.logic.<id>.summary()` で算出し、view は委譲するだけ）。戻り値は次の形:

```js
summary() {
  return {
    empty: false,                       // データ皆無なら true（HOME は「データがありません」を表示）
    stats: [{ label: "未完", value: 12 }], // 表示する指標（label:表示名 / value:数値 or "37%" 等の文字列）
    attention: [                        // 任意。要対応事項（HOME 先頭の帯に集約。Issue #102）
      { label: "期限切れ 3件", severity: "error" } // severity: "error" | "warn" | "info"（未知値は info 扱い）
    ]
  };
}
```

- `summary` 未実装・例外時も HOME は壊さない（カードは「開く」表示にフォールバック）。
- `attention` は **stats 同様に任意**。未実装・不正形式でも HOME は壊さない（帯に出ないだけ）。実装例: todo=期限切れ/今日期限、techstack=見直し期限の超過/接近、questions=未解決件数、resource=過負荷（誰が過負荷か・warn）、wbs=期限超過タスク（error）（#181）。
- 集計は logic 側の純関数に置き、テスト可能にする（`test/summary.test.js`）。例: todo=未完/全タスク数、goals=達成率/目標数、skills=メンバー/スキル項目数、resource=現在割当/稼働中PJ、wbs=進行中/進捗率。「今日」に依存する集計は基準日を引数で受け取れるようにする（決定的テスト。TESTING §1）。

#### 3.6.1 エンティティ単位の任意契約 `summaryFor(entityType, id)`

`summary()` が**モジュール全体**を主語にするのに対し、`summaryFor(entityType, id)` は「**この人**のスキル概況」「**このPJ**の WBS 進捗」のように**エンティティ1件**を主語にしたサマリーを返す。人・プロジェクト詳細への関連情報集約ビュー（Issue #83）が、他モジュールをハード参照せずに各枠を問い合わせるための任意契約（柱1・§9.5 の欠損時グレースフルの実証対象）。

```js
summaryFor(entityType, id) {
  // entityType: マスタ種別 "person" | "project" | "product" 等（汎用。"project" 決め打ち分岐をしない・§3.7.6）
  // id: そのマスタの entityId
  return { empty: false, stats: [{ label: "担当タスク", value: 5 }] }; // summary() と完全に同型（{ empty, stats, attention? }）
}
```

- **戻り値は `summary()` 契約と完全に同型**（`{ empty, stats:[{label,value}], attention? }`）。遷移導線（クリックで該当モジュールへ飛ぶ）は消費側の集約ビュー（#83）が `ctx.route`（§3.5・§3.7.3）で別途組み立てるものとし、契約には持たせない（YAGNI）。
- **該当データ無し（empty）と契約未実装（null）を区別する**: そのモジュールが `summaryFor` を実装していても、当該エンティティに紐づくデータが無い場合は `{ empty: true, stats: [...] }` を返す。契約自体を実装しない（＝そのモジュールはエンティティ単位のサマリーを提供しない）場合はリーダが `null` を返す（下記）。
- **汎用**: `entityType` はマスタ種別に汎用で、`"project"` 等の特定種別に分岐しない（§3.7.6）。対応しない種別には `{ empty: true, ... }`（データ無し）で応える。
- 横断表示・集約ビューは他モジュールをハード参照せず、必ずコアのリーダ **`MK.readEntitySummary(moduleId, entityType, entityId)`** 経由で問い合わせる。リーダは `MK.readSummary`（§9.5）と同一原則で、**未搭載（`MK_CONFIG` から外した）・`summaryFor` 未実装・`summaryFor` が例外**のいずれでも `null` を返し、呼び手（#83）を壊さない。
- 集計は logic 側の純関数に置きテスト可能にする（リーダの契約テスト `test/read-entity-summary.test.js`、各モジュールの集約ロジックは `test/summary-for.test.js`）。
- **実装状況（#83 / #144）**: 消費者は**人詳細の集約ビュー**（シェルの `master-people` 詳細）。`skills` / `resource` / `oneonone` / `workload` / `wbs`（全 PJ 横断の担当タスク）が `summaryFor("person", id)` を実装し、詳細画面は登録済みモジュールを `MK.readEntitySummary` で走査して `null` は省き・`empty` は空状態・`stats` は集約値＋「開く →」導線で描画する。プロジェクト側の集約は `dashboard`（#78・project-scoped）に一本化し master 側へは二重実装しない（役割分担は §9.6 の判断記録）。関連プロダクト（owner）は共有マスタ `MK.products` を直接参照する（モジュールではないため契約対象外）。

### 3.7 スコープ次元（横断 / 単位のスコープ軸）

ゾーン分類（§1.4）に**直交する第2軸**として、「**同種のものを複数持つ／単一で持つ**」を統一的に扱う仕組みを定義する。§1.4 で予約し §14 で将来送りにしていた「PJ 横断 / PJ 単位」軸を、**Project 専用ではなく汎用の型**として起こす。

#### 3.7.1 スコープ次元と参照マスタ

- **スコープ次元（scope dimension）**: 「その1つの中に入って作業する対象」になれるマスタ。現状 **Project・Product**（Issue #54 で Product も次元化）。複数持ちうるし単一のこともある。
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
- `scope: { dim: "project" }` … Project 文脈で動く（wbs）。`{ dim: "product" }` も config 上は次元化済み（Issue #54）だが、宣言するモジュールはまだ無い。

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
- **所有と配線（現行・Issue #45 で昇格済み）**: アロケーションは特定モジュールに属さない**中立な共有マスタ `mk:allocations`**（People / Projects と同格。§4.4）に置く。編集（planning）は**リソース（resource・旧 staffing）**が担い、`ctx.allocations` 経由で読み書きする。リソースは workload の logic API に依存しないため、**workload を外してもアロケーションと要員計画は成立する**（この独立性を根拠に workload は Issue #167 で退役・撤去した）。
  - **昇格の経緯**: 当初は YAGNI により新たな共有マスタを作らず workload を次元対応させて内部保持していたが、その消費者として要員計画（resource・旧 staffing）が現れ「第2の消費者出現＝昇格トリガー」に到達したため、中立マスタへ切り出した。移行は加算的・非破壊（旧 `mk:module:workload:v1`.`allocations[]` を `mk:allocations` へ id 保持のまま移設し、workload 側から除去。§7）。
- 担当合計 vs アロケーションの**照合クロス機能**は将来枠（§14）。

#### 3.7.6 型は汎用・次元化済みは Project / Product、モジュールは必要時に実体化（YAGNI）

- スコープ次元の**型／契約**は汎用に定義し、`MK_CONFIG.dimensions` への配線（次元化）は **Project・Product の2次元**（Product は Issue #54 で config に追加。それ以前は Project のみ）。
- **Product マスタは Issue #37 で先行追加**（`products`・`mk:products`。People / Project と同格の横断マスタ・§4.4）、**Product 次元としての配線（`MK_CONFIG.dimensions` への追加）は Issue #54 で完了**。config に1行足すだけで `master: "products"` が既存の products マスタに解決した（コード改修なし）。
- **product-scoped モジュールはまだ無い**（YAGNI）。次元の配線とモジュールの実体化は別軸で、必要になったモジュール追加時に `scope: { dim: "product" }` を宣言すれば足りる（wbs が `scope: { dim: "project" }` を宣言しているのと同じ要領）。
- **ガードレール**: コード上で `"project"` を**決め打ち分岐しない**。次元は config の配列を回して扱う（[`CONVENTIONS.md`](CONVENTIONS.md)）。`shared/scope.js` / `shared/shell-core.js` は `MK_CONFIG.dimensions` を配列として汎用に走査するのみで、Product 追加時も改修不要だったことをテスト（`test/scope.test.js` の Product ケース）で確認済み。

```js
MK_CONFIG.dimensions = [
  { dim: "project", label: "プロジェクト", master: "projects" },
  { dim: "product", label: "プロダクト", master: "products" },
];
```

- 逆に、次元が要らない汎用機構まで先に作るのも**過剰設計として避ける**。

---

## 4. 共通データ規格

### 4.1 localStorage キー命名規約

すべて `mk:` プレフィックスで統一する（旧 `:v1` / `-data-v1` / `.data.v1` の混在を解消）。

**マスタ・設定キー**（増減頻度が低く §4.4 が正）:

| キー | 内容 |
|---|---|
| `mk:people:v1` | 人の管理マスタ `{ members }`（§4.4） |
| `mk:projects:v1` | プロジェクト管理マスタ `{ projects }`（§4.4） |
| `mk:products:v1` | プロダクト（成果物）マスタ `{ products }`（§4.4・Issue #37） |
| `mk:allocations:v1` | アロケーション共有マスタ `{ allocations }`（人×器×期間×割当%。§3.7.5 / §4.4） |
| `mk:demands:v1` | 需要共有マスタ `{ demands }`（器×期間×必要%。§4.4 / Issue #68） |
| `mk:settings:v1` | アプリ設定（最後に開いたモジュール、列幅等のUI状態。§4.8） |

**モジュールキー**（規則。個々の id は §5、各モジュールの具体キーは `spec/modules/<id>.md` を正とする）:

| 種別 | キー規則 |
|---|---|
| global モジュール | `mk:module:<id>:v1` |
| scoped モジュール（§3.7.4） | `mk:module:<id>:<targetId>:v1`（現行では wbs が `mk:module:wbs:<projectId>:v1`） |

- `vN` のバージョンはキー単位で独立にあげられる（§4.5）。
- global モジュールは単一キーで対象を持たず、scoped モジュールは対象別に複数キーを持つ。

### 4.2 JSON エンベロープ（入出力の共通形）

すべてのエクスポートは以下の共通エンベロープに従う。`todo-kun` の `{version, exportedAt, ...}` を基礎に拡張。

```json
{
  "schema": "management-kun",
  "schemaVersion": 1,
  "exportedAt": "2026-06-30T12:00:00.000Z",
  "scope": "all | people | projects | products | allocations | demands | <moduleId>",
  "people": [],
  "projects": [],
  "products": [],
  "allocations": [],
  "demands": [],
  "modules": {
    "todo": { "version": 1, "data": { } },
    "wbs":  { "version": 1, "scope": { "dim": "project" }, "targets": { "<projectId>": { } } }
  }
}
```

> `modules` は上を代表例として示す（global＝`todo`／scoped＝`wbs`）。実際は全モジュールが並ぶ。**モジュール id の一覧は §5 を正とする**（ここでは列挙しない）。

- **全体バックアップ**: `scope: "all"`。`people` / `projects` / `products` / `allocations` / `demands` と全 `modules` を含む。
- **モジュール単体エクスポート**: `scope: "<moduleId>"`。`people` / `projects` 等のマスタは参照解決に必要な分を同梱する（名前で再解決できるよう）。
- **マスタ単位**: `scope: "people"` / `"projects"` / `"products"` / `"allocations"` / `"demands"`（該当マスタのみを含み、他は空にする。`shared/io.js` の `buildEnvelope`）。
- **global モジュール**は `modules.<id>` が `{ version, data }`。**scoped モジュール（wbs）**は `{ version, scope: { dim }, targets: { <targetId>: <data> } }` 形式で対象別に束ねる（§3.7.4。`shared/io.js`）。
- 各モジュールデータの中身は、対応するモジュール個別仕様（[`spec/modules/<id>.md`](spec/modules/)）のデータモデルに準拠する（タスク配列、goals 配列等）。
- 日時は ISO 8601 UTC 文字列、日付のみのフィールドは `YYYY-MM-DD`。未設定の任意項目は省略せず `null` / `[]` / `""` を入れる（人間・AI が構造を推測しやすくするため。todo-kun の規約を全モジュールへ展開）。

### 4.3 インポート方針
- 取り込み時に `置換 / マージ` を選べる（既存 todo-kun・各ツール準拠）。
  - **置換**: 対象 scope を全消去して取込内容で再構築。
  - **マージ**: `id` 一致で上書き、なければ追加。マスタ参照は §4.4 の名前解決で再結合。
- `schema` 不一致・`schemaVersion` 未来値は警告し、可能ならマイグレーション（§4.5）、不能なら中断。
- 壊れた JSON でもアプリは起動し、エラーを握りつぶさず案内する（堅牢性）。

### 4.4 共通マスタ（People / Project / Allocation / Product）

> **本節の詳細は [`spec/masters.md`](spec/masters.md) に分離。** マスタの**共通契約（§4.4.1 マスタ共通設計）**と各マスタ（People / Project / Allocation / Product）の個別定義は同ファイルを正とする。マスタを追加・修正するときに参照する。
>
> 要点: 人とプロジェクトは軸が直交するため**独立ドメイン**に分離（別ストア `mk:people` / `mk:projects`、別管理画面）。アロケーション・プロダクトも同格の独立ドメイン。すべてのマスタは共通契約（`mk:<domain>:v1`・`all/get/create/update/remove` ＋名寄せ `resolve/resolveOrCreate` ＋ CSV `buildCSVRows/applyCSV`・変更時 `masters:changed` 発火・**CSV 取込は id 保持の名寄せ upsert**）に従う。マスタは今後も増える前提で、新マスタは §4.4.1 を満たす形で追加する。

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

> **本節の詳細は [`spec/import-migration.md`](spec/import-migration.md) §4.6 / §4.6.1 に分離。** UTF-8（BOM許容/出力はBOM付き）・RFC4180 自前パーサ・名前参照・寛容解釈で `shared/io.js` に集約。CSV 対象モジュールは §5 の一覧表（CSV 列＝✓）を正とする（Issue #77 で共通契約化し展開。マスタ側は People / Project / Product も対応）。共通ドメイン（People / Project）の列仕様、モジュール固有列（各 `spec/modules/<id>.md`）の参照先も同ファイルを正とする。名前参照は取込時に §8 名寄せで解決する。

### 4.7 ID・採番規約
- **マスタ**: People `m_<base36 epoch>_<rand>`、Project `p_<base36 epoch>_<rand>`。グローバルに一意。
- **マスタ参照**: People = `memberId`（string）、Project = `projectId`（string）。wbs の担当は `assigneeId`（People の string ID）。
- **モジュール内部 ID**: 既存方式を踏襲して移行リスクを避ける（goals: `g_`/`s_`、todo: `t_<epoch>_<rand>`、wbs: 数値 `uid++`（`deps` が数値参照のため変更しない）、skills: 既存採番）。
- ID は**再利用しない**。

### 4.8 アプリ設定 `mk:settings:v1`
UI 状態と移行フラグを集約する（モジュールのデータとは分離）。

```json
{
  "version": 1,
  "lastModule": "todo",
  "startView": "home",
  "theme": "dark",
  "hiddenModules": ["oneonone"],
  "pinnedModules": ["todo", "wbs"],
  "nav": { "プロダクト": true },
  "migration": { "fromLegacyDone": true },
  "ui": {
    "wbs": { "colWidths": [] }
  }
}
```

- `lastModule`: 直近に開いていたモジュール（`startView === "last"` のとき起動先に使う）。
- `startView`: 起動先。`"home"`（既定）＝ HOME を表示 / `"last"` ＝ `lastModule` を復元（§3.6）。
- `theme`: `"light"` / `"dark"`。未設定時は OS の `prefers-color-scheme` に従う（§6.2）。
- `hiddenModules`: ナビ／HOME から隠すモジュール id の配列。**UI から隠すだけ**で、データ（`mk:module:<id>:*`）・マスタ連携は保持する（無効化ではない）。既定は全表示（未設定＝空配列）。設定画面のトグルで切替え、変更は即ナビへ反映する。ゾーンに載らない未知 id が残っていても安全に無視する。非表示モジュールへの `route` は先頭ゾーンの表示中モジュールへ退避し、全モジュールを隠しても設定画面へは常に到達できる。
- `pinnedModules`: HOME のピン留めセクションにフルカードで出すモジュール id の配列（配列順＝表示順。§3.6 / Issue #100）。既定は空（未設定＝ピンなし。案内文を表示）。サイドバー各項目の右端 ☆／HOME カード上の ★ トグルで切替える（Issue #169）。`hiddenModules` と同様、ゾーンに載らない未知 id は安全に無視し、非表示（`hiddenModules`）が優先される。
- `nav`: サイドバーナビのゾーン折りたたみ状態（`{ <ゾーンlabel>: true=畳む }`。CONVENTIONS §2.2 / Issue #34）。現在ビューを含むゾーンは畳んでいても展開表示する。
- `migration.fromLegacyDone`: 旧ツール自動移行の実施済みフラグ（§7.5）。
- `ui.<moduleId>`: 各モジュールが必要とする UI 状態（列幅・表示期間など）。`ctx.settings` 経由で読み書きする。

`mk:settings` は端末ごとの UI 状態（テーマ・表示設定）であり、共有・バックアップの対象データではないため、JSON エンベロープ（§4.2）の入出力には含めない。

---

## 5. モジュール仕様（位置づけと固有データ）

各モジュールの**統合上の位置づけ・共通マスタとの関係・固有データ・CSV 列・旧データ移行元は、モジュール個別仕様（[`spec/modules/<id>.md`](spec/modules/)）を正**とする。さらに機能の詳細挙動は各ツールの既存 `spec.md` を正とする。本節はモジュール一覧のみを示す（個別詳細は本書に重複させない）。

| id | 名称 | ゾーン | 個別仕様 | CSV |
|---|---|---|---|---|
| goals | 目標みえるくん | 自分 | [`spec/modules/goals.md`](spec/modules/goals.md) | ✓ |
| questions | わからないこと | 自分 | [`spec/modules/questions.md`](spec/modules/questions.md) | ✓ |
| skills | スキル可視化 | ピープル | [`spec/modules/skills.md`](spec/modules/skills.md) | ✓ |
| resource | リソース（要員計画・横断。旧 staffing） | ピープル | [`spec/modules/resource.md`](spec/modules/resource.md) | – |
| oneonone | 1on1メモ | ピープル | [`spec/modules/oneonone.md`](spec/modules/oneonone.md) | ✓ |
| todo | GTD ToDo | 自分 | [`spec/modules/todo.md`](spec/modules/todo.md) | ✓ |
| dashboard | プロジェクト・ダッシュボード（横断集約・読み取り専用。project-scoped） | デリバリー | [`spec/modules/dashboard.md`](spec/modules/dashboard.md) | – |
| wbs | WBS / ガント | デリバリー | [`spec/modules/wbs.md`](spec/modules/wbs.md) | ✓ |
| techstack | 技術スタック台帳 | テクノロジー | [`spec/modules/techstack.md`](spec/modules/techstack.md) | ✓ |
| releases | リリース台帳 | プロダクト | [`spec/modules/releases.md`](spec/modules/releases.md) | – |

- プロダクト台帳（📦 プロダクト）は**ゾーンモジュールではなく Product マスタ**として実装した（§4.4）。ゾーン（作業ツール）ではなく人・プロジェクトと同格の横断マスタのため、本一覧には載せない。

- 共通マスタの利用関係（People / Project）の一覧は §4.4 を参照。
- モジュール追加・削除の手順は [`CONVENTIONS.md`](CONVENTIONS.md) §5、新規モジュールの個別仕様も `spec/modules/<id>.md` として同じ体裁で追加する。

### 5.6 タスクのスキーマは統一しない（明示）
todo / wbs の「タスク」は意味も構造も異なる（GTD状態 / 階層+依存）。これらを単一スキーマへ強制統合しない。統一するのは **エンベロープ・命名・CSV規約・共通マスタ参照**までとする。

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
  - 切替時に `theme:changed` を `MK.bus` で発火する。Canvas / SVG で自前描画するモジュール（goals / skills / wbs）は、色を**描画時に CSS 変数から読み**、このイベントで**再描画**する（CSS のように自動追従しないため）。
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
1. **左サイドバー**（`.mk-sidebar`。Issue #34）: アプリ名「マネジメントくん」 + モジュール切替（ゾーン見出し＋配下モジュールを**縦積み**）+ 下部にテーマ切替・全体バックアップ（取り込み/バックアップ）。ゾーン見出し（`.mk-nav-group`）は折りたたみトグルで、状態は `mk:settings.nav` に保持する。各モジュール項目の右端には**ピン留めトグル ☆/★**（`.mk-nav-pin`）を置く（Issue #169）: 未ピンは行 hover 時のみ ☆ を表示し、ピン済みは ★ を常時表示する。クリックは `stopPropagation` で遷移させず（ラベル＝遷移／右端 ☆＝トグル、と役割を場所で分ける）、`pinnedModules`（§4.8）を更新して HOME のピン留めカードに反映する。**768px 以下ではサイドバーをオフキャンバスのドロワー**にし、`.mk-topbar` のハンバーガー（`#btn-menu`）で開閉・オーバーレイクリック／項目選択で閉じる。モジュール増加には縦方向で耐える（旧「上部ナビ＋pill タブ」から刷新。CONVENTIONS.md §2.2・`index.html` / `shared/shell.js` が現状の正）。
2. モジュール切替は**ゾーンに分けて表示**（§1.4）。各ゾーンにラベルを付け、区切りで分離する。**どのゾーンに何を載せるかはエントリ HTML の `MK_CONFIG.zones` を正とする**（§1.4 / §1.5）ため、ここではモジュール名を列挙しない。負荷（workload）は Issue #52 でナビから降格（登録・データ・マスタ連携は維持したままナビ非表示）。プロダクトゾーンは releases（Issue #84）で新設した。
3. メイン: 選択モジュールの描画領域。**HOME**（🏠・ナビ先頭）を起動時の既定表示先とし、要対応帯＋ピン留めカードを描画する（§3.6）。
4. **マスタ管理**: 人・プロジェクト・プロダクトの管理画面。マスタは特定ゾーンの持ち物ではなく、`home` / `settings` と同列の**シェルレベル特別ビュー**（§3.6）であり、ナビでは**ゾーン群と設定の間の独立グループ「マスタ」**として並べる（Issue #46）。それぞれ**別ドメイン**（別ストア・別 CRUD・名寄せ）であり、その独立グループの下に**ドメインに沿って別エントリ・別ビューで分離**して並列に置く ──「👤 人」（`master-people`）／「📁 プロジェクト」（`master-projects`）／「📦 プロダクト」（`master-products`・§4.4・Issue #37）。プロジェクトは wbs だけでなく workload からも参照される横断マスタ（`scope: "global"`・§4.6）のため、特定ゾーン配下に置くと横断性が過小表現になる。プロダクトは将来 Product 次元のマスタを兼ねる（§3.7）。マスタは業務データであり、設定(config)とは混ぜない。
5. 設定: アプリ設定・全体バックアップ（エクスポート/インポート）・**モジュールの表示/非表示切替**（`hiddenModules`・§4.8。Issue #35 / #93。非表示はナビ・HOME から隠すのみでデータ・マスタ連携は保持）。

---

## 7. 移行・互換性

> **本章の詳細は [`spec/import-migration.md`](spec/import-migration.md) §7 に分離。** 旧 localStorage キー / 旧 JSON の検出・取り込み（§7.1・§7.3）、メンバー/プロジェクトの名寄せ（§7.2 → §8）、段階リリース順（§7.4）、移行トリガと UX（§7.5）を規定する。各モジュールの旧キー / 形状 → 移行先の対応は、モジュール個別仕様（[`spec/modules/<id>.md`](spec/modules/)）の「旧データ移行」節を正とする。

---

## 8. 名寄せ（参照解決）

> **本章の詳細は [`spec/import-migration.md`](spec/import-migration.md) §8 に分離。** 名前（文字列）をマスタ実体（People / Project の `id`）へ解決する共通処理（`shared/people.js` / `shared/projects.js` に集約）。照合キー正規化（§8.2）・判定（§8.3）・ハイブリッド確定（§8.4）・レビュー画面（§8.5）・未解決の保持（§8.6）・手入力（§8.7）・マスタのマージ（§8.8）・冪等性（§8.9）・CSV/JSON との関係（§8.10）を規定する。移行・CSV/JSON 取込・手入力で共用する。

---

## 9. MVP とフェーズ計画

統合プロジェクトの観点での MVP / Phase 2 を定義する（各モジュール内部の MVP は既存 spec.md に従う）。

> **本章は v1（MVP）時点のフェーズ計画・記録**。「5モジュール」等の列挙はその時点のスナップショットであり、現行のモジュール一覧・数は §5 の表・§1.4・`index.html` の `MK_CONFIG` を正とする（本章を現行モジュール数と読み替えない）。ただし §9.5（Phase 2 の再定義）・§9.6（Phase 3 の方向）は MVP 完了**後**に定めた現行方針であり、v1 スナップショットではない。
>
> **実装状況（v1・実装済み）**: §9.1 の MVP は完了。シェル＋5モジュール（todo/goals/wbs/skills/workload）・デザイン統一・人/プロジェクトマスタ・旧データ自動移行・全体JSON入出力・設定に加え、**ダークモード**・**領域別のゾーン分け（自分＋4領域・§1.4）**・**共有UIヘルパ**・**logic/view 分割**（CONVENTIONS.md）も実装済み。以降は §9.2 Phase 2 のうち、questions / resource / oneonone / techstack / releases / dashboard（PJ 横断集約・Issue #78）・Product/Allocation/Demand マスタ・スコープ次元（§3.7）等を追加実装した（現行は 11モジュール構成）。

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
- プロジェクト・ダッシュボード（横断集約ビュー）（§4.4）。**実装済み**（`dashboard`・project-scoped・Issue #78）: 1つの Project を主語に基本情報・WBS 進捗・アサイン状況・関連プロダクトを読み取り専用で集約し、各カードから該当モジュールへ `ctx.route` で遷移する（[`spec/modules/dashboard.md`](spec/modules/dashboard.md)）。

### 9.3 MVP に持ち込まないもの
- 各モジュールへの新機能追加（統合 MVP は「現状機能の移植＋規格/デザイン統一」まで）。
- §12 スコープ外の項目。

### 9.4 構築順
§7.4（段階リリース）の順に従う: 基盤（design / store / io / people / projects / shell）→ todo → goals → wbs → skills。（当初はこの後に workload を載せたが、Issue #52 で resource へ役割移譲し #167 で退役・撤去した。）

### 9.5 Phase 2 の方針（MVP 後の再定義・2026-07）

§9.2 は v1 決定時の Phase 2 リスト（名寄せレビュー・CSV 展開・ダッシュボード等）で、その大半は実装済み（§9 冒頭の実装状況）。MVP 完了後、Phase 2 の柱を次のとおり再定義した。

**原則**: **疎結合な任意契約の上で横断価値を出す。** 下記の柱1（着脱耐性）と柱2（横断価値）は対立ではなく表裏——横断価値はモジュール間の結合を増やし、着脱耐性は結合を減らしたい。この緊張を「柱1が疎結合な任意契約を定義し、柱2がその契約の最初の消費者＝実証になる」で解く。両者は別プロジェクトに分けず、同一原則として同時に進める。

**柱1: モジュール着脱に耐える器**

- 着脱は `MK_CONFIG`（§1.5）を人が編集する**宣言的着脱**を上限とする。実行時に着脱する UI・動的レジストリ・プラグイン機構は**作らない**。それが必要になったら、機構を足すのではなく**アーキテクチャ見直しの合図**とする（「`file://` で開くだけで動く／ローカル完結／外部依存ゼロ」を最優先で死守する）。
- 保証する内容は3点に固定する:
  1. 外したモジュールがあっても**アプリが起動し、全画面が壊れない**。
  2. 外したモジュールの**データ（`mk:module:<id>`）は消えない**。名前空間規約の結果として自然に生存し、再装着で復活する（機構ではなく規約で満たす）。
  3. 他モジュール／マスタの**横断表示は該当枠を黙って省く**（エラーにしない）。
- 新規に作る「機構」はほぼ無い。担保は**規律＋テスト**: 横断表示は「任意契約（`summary()` 同様）で問い合わせ → 無ければ枠を省く」で書き、他モジュールへのハード参照を禁止する。`MK_CONFIG` からモジュールを外しても起動・全画面・横断表示が壊れないことをテストで検証し、CONVENTIONS §6 の完成チェックリストにも項目を追加する。

**柱2: 横断価値の顕在化**

- 共通マスタ・共通規格に投じた統合の価値を「人1人・プロジェクト1つ」を主語に顕在化する: 人・プロジェクト詳細への関連情報集約ビュー（Issue #83）。
- 実装は必ず柱1の任意契約＋欠損時グレースフルの上に載せる（横断価値がそのまま柱1の契約の実証になる）。
- なお、モジュール間クロス機能（WBS 担当合計 vs アロケーション照合など）は当初 Phase 2 の柱2 に含めていたが、Phase 3 へ送った（§9.6）。（当初併記していた「wbs → workload 負荷流し込み」は workload 退役・撤去〔#167〕により対象消滅。）

**完了条件（Phase 2 → Phase 3 の物差し）**

Phase 2 の完了は次の2点で判定する。両方を満たしたら Phase 3 に移る。

1. **#83（人・プロジェクト詳細の集約ビュー）が任意契約の上で動く**こと。他モジュールへのハード参照を持たず、各枠は任意契約（`MK.readSummary` 同様）で問い合わせ → 無ければ黙って省く（柱1・§9.5 の欠損時グレースフルの実証になっている）。
2. **Phase 3 移行時に各モジュールの負担を抑える core 基盤が揃う**こと。具体的には (a) エンティティ（人・プロジェクト等）単位の任意契約、(b) 結合レベル（`MK_CONFIG` からモジュールを外す）での着脱テスト、(c) 統廃合のための統合移行テンプレート（§7.5 の one-off 移行スクリプトの雛形）の3つ。

### 9.6 Phase 3（方向）

モジュールの**拡張・統廃合**をメインに据える。統廃合（モジュール／データ名前空間／マスタのマージ）は汎用マージエンジンを作らず、既存の旧データ移行（§7.5）と同じ **one-off の移行スクリプト方式**で行う（`file://`・外部依存ゼロと整合）。Phase 2 の柱1で「detach してもデータは名前空間ごと生存し migrate できる」契約を固めておくことが、Phase 3 の統廃合の前提となる。

**モジュール間クロス機能**（Phase 2 の柱2 から移設）: WBS 担当合計 vs アロケーション照合。複数モジュールを結合する横断機能であり、柱1の任意契約＋着脱耐性が固まってから着手する。実装は必ず任意契約＋欠損時グレースフルの上に載せる。（当初併記していた「wbs → workload 負荷流し込み」は workload 退役・撤去〔#167〕により対象消滅。）

**統廃合の判断記録**

モジュール／データ名前空間／マスタを統合・廃止するかの判断は、汎用の判断基準を先に作らず、**判断のたびに決定ログとして1行ずつ追記する**方式で育てる（下表。最初の1行は #83 実装時に dashboard との境界を整理した記録になる想定）。

| 日付 | 対象 | 判断 | 理由 |
|---|---|---|---|
| 2026-07-07 | 人・プロジェクト詳細の集約ビュー（#83）と プロジェクト・ダッシュボード（#78・`dashboard`） | **統合せず役割分担で共存**。人詳細＝**マスタ側**（`master-people`）の集約ビューとしてシェルに実装（新規）。プロジェクトの集約は既存 `dashboard`（project-scoped モジュール）に一本化し、**master 側にプロジェクト詳細は作らない**（重複回避）。人・プロジェクトどちらも同じ任意契約 `summaryFor(entityType,id)`＋リーダ `MK.readEntitySummary` を土台にする。 | People は参照マスタ（スコープ次元にしない・§3.7.1）ゆえ「その中に入る」dashboard 型の scoped ビューに載せられず、マスタ一覧からの詳細が自然。一方 Project はスコープ次元で既に `dashboard` が「1 PJ を主語に WBS 進捗・アサイン・関連プロダクトを集約」する器を持つため、同じ表示を master 側に二重実装しない。両者を1つの汎用契約で賄うことで柱1（§9.5）の実証を兼ねる。 |
| 2026-07-10 | `workload`（タスク負荷可視化）を**退役・撤去**（#167） | **モジュール本体（logic/view）・カタログ登録・CSS・テストを削除**。役割は #52 で `resource`（要員計画・共有アロケーション）へ移譲済みで、resource は workload の task データに依存しない。旧データは、モジュール本体に依存しない store レベルの終端ワンショット移行 `MK.allocations.migrateFromWorkload()`（起動時・冪等）が `mk:module:workload` から内部アロケーションを共有マスタへ吸い上げ、**吸い上げ後にキーごと破棄**する。 | #52 でナビ降格して以降 UI から到達不能・機能的に死んでいた。基盤を軽く保つ（§1.2）ため新モジュール追加の前に正式退役。移行チェーンが本体ロードに依存しないことを spike で確認した（§7.5 の `task-tool-data-v1` → workload 取込分岐は受け皿消滅のため撤去）。 |

**廃止時の作法**: 廃止するモジュールは、まずモジュール単位で JSON エクスポート（`scope:"module"`）→ その後 `mk:module:<id>` キーを削除する。専用の廃止機構は作らない（手順として運用する）。

**統廃合の実務テンプレート**: モジュール統合（`mk:module:a` → `mk:module:b`）を実施する際の手順書＋one-off スクリプト骨格＋テストパターン＋後始末の作法は [`spec/consolidation.md`](spec/consolidation.md) を正とする（汎用エンジンは作らず、毎回そこからコピーして作る）。旧ツール→本アプリの移行（[`spec/import-migration.md`](spec/import-migration.md) §7）とは別物。

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
- 保存（`MK.store.write`）で容量超過（`QuotaExceededError`）を検知したら握りつぶさず案内する。案内には容量超過の旨と全体バックアップ（JSON）導線を含める。書込失敗時も `_cache` には新値が残り、アプリはクラッシュせず操作を継続できる（そのまま JSON へ退避可能）。
- 設定画面に `mk:` プレフィックスキーの合計使用量（概算バイト・上限比）を表示し、閾値（80%）超過時は警告とバックアップ導線を出す（`MK.store.usage()`）。

### 10.2 アクセシビリティ・キーボード
- 主要操作はキーボードで到達可能、フォーカスを可視化、適切なラベル / `aria` を付与する。
- コントラストは DESIGN トークン準拠（§6）。
- 既存ショートカット（todo のクイックキャプチャ Enter、編集 Esc キャンセル等）を尊重し、モジュール横断で一貫させる。

---

## 11. 受け入れ条件（統合観点）

> **本章は v1（MVP）時点の受け入れ条件の記録**。「5モジュール」「skills / wbs の CSV」等はその時点の基準であり、現行実装と読み替えない。現行の姿（モジュール一覧・CSV 対象）は §1.4・§4.6・§5 と各実装ファイルを正とする。

1. `index.html` を `file://` で開くだけで、5モジュールすべてに切替・操作できる（外部通信ゼロ）。
2. メンバーを「人の管理」に1回登録すると、skills と workload の双方で同じメンバーとして参照される（再読込後も保持）。
3. 全体バックアップ（`scope:"all"`）を JSON で書き出し、別環境でインポートして全モジュール+人/プロジェクトを復元できる。
4. skills / wbs の CSV が共通規約（UTF-8 BOM・名前参照・寛容パース）で入出力でき、名前でマスタへ解決される。
5. 全モジュールが同一の DESIGN トークン・コンポーネントで描画され、見た目が統一されている。
6. 旧5ツールの localStorage / 旧 JSON を取り込み、メンバー/プロジェクトが名寄せ統合される。
7. 壊れた JSON / localStorage でもアプリが起動し、エラーを握りつぶさず案内する。

---

## 12. 決定事項サマリー

> 各行は**決定（方針）そのもの**を記録する。「CSV 対象」「MVP のモジュール数」など**時点で変わる列挙**は v1 決定時のスナップショットであり、現行の対象は各節（CSV=§4.6・モジュール一覧=§5・ゾーン=§1.4）を正とする。

| 論点 | 決定 |
|---|---|
| アーキテクチャ | 単一ページ・シェル + モジュール差し替えロード（classic script・`window.MK`）。ビルド不要・`file://`・依存ゼロ。 |
| データ統合の深さ | 人の管理（People）とプロジェクト管理（Project）を**独立ドメインに分離**して共有 + JSON エンベロープ・localStorage 命名・CSV 規約を統一。各モジュール固有データは独立。 |
| 人 / プロジェクト | 別ストア・別管理画面に分離（軸が直交）。Project は本バージョンは軽量マスタに留め、横断集約ビューは将来拡張。 |
| ナビ分類（ゾーン） | アプリは「マネージャの作業机」。ナビを **自分** ＋ **EM が見る4領域（ピープル/デリバリー/プロダクト/テクノロジー）** で分類（§1.4）。現行ゾーン構成は `index.html` の `MK_CONFIG.zones` を正とする（自分=todo/goals/questions・ピープル=skills/resource/oneonone・デリバリー=wbs・プロダクト=releases・テクノロジー=techstack。workload は Issue #52 でナビ降格の後 #167 で退役・撤去）。マスタ管理（人/プロジェクト/プロダクト）はゾーンに属さず独立グループに置く（§6.4）。goals は自分ツールで Member/Project と結び付けない（KPI/OKR に見せない）。チーム OKR は将来別モジュール（§1.4）。 |
| タスクスキーマ | 統一しない（todo/wbs は別構造のまま）。 |
| スコープ次元 | ゾーンに直交する第2軸として **スコープ次元**（「その中に入って作業する対象」＝Project・Product）を定義。People は参照マスタで次元にしない（§3.7.1）。 |
| 単一/複数 | 単一は「要素数1の縮退形」。別モードを作らず config 駆動で差を出す（§3.7.2）。「現在の対象」は次元ごとに独立（§3.7.3）。 |
| scoped データ | 登録は1モジュール・保存は対象別 namespace `mk:module:<id>:<targetId>:v1`（ハイブリッド。§3.7.4）。scoped は `ctx.scope` を受け取る。 |
| 要員計画 | PJ 横断俯瞰は**共有アロケーション**（人×器×期間×%）を参照。WBS 担当とは別レコード（同じ People を指す）。アロケーションは中立な共有マスタ `mk:allocations` として実装（Issue #45 で workload 内部から昇格）、WBS は独立維持（§3.7.5）。 |
| 次元の実体化 | 型/契約は汎用定義、配線は Project・Product の2次元（Product は #54）。product-scoped モジュールはモジュール追加時に実体化（YAGNI）。コードで `"project"` 決め打ち分岐しない（§3.7.6）。 |
| localStorage 命名 | `mk:` プレフィックスで統一（`mk:people:v1` / `mk:projects:v1` / `mk:module:<id>:v1` / `mk:settings:v1`）。 |
| JSON | 共通エンベロープ `{schema, schemaVersion, exportedAt, scope, people, projects, modules}`。 |
| CSV | UTF-8（BOM許容/出力はBOM付き）・RFC4180 自前パーサ・名前参照・寛容解釈。現行の対象は §4.6・§5 を正とする（v1 決定時は skills / wbs）。 |
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
- （Phase 2）名寄せレビュー画面（§8.5）・マスタの事後マージ（§8.8）・「未解決の名前」一覧（§8.6）・CSV 統一の全モジュール展開。
- （実装済み）~~レーダーチャート（skills）~~（skills「レーダー」タブ・Issue #79。メンバーのスキル評価を SVG 自前描画のレーダーで可視化・複数人比較）。
- （Phase 2 / 将来）~~プロジェクト・ダッシュボード~~（実装済み・`dashboard`・Issue #78。§9.2）。
- （Phase 3）モジュール間クロス機能（例: 担当合計 vs アロケーション照合）。Phase 2 の柱2 から Phase 3 へ送った（§9.6）。
- **（思想確定・実装は段階進行）スコープ次元（§3.7）**: 「PJ 横断 / PJ 単位」軸の思想は §3.7 で確定済み。**実装済み**: シェルのスイッチャ・`ctx.scope`（#24）／wbs の対象別 namespace 化（#25）／アロケーションの次元対応（共有マスタ `人×器×期間×%`。#26、#45 で中立マスタへ昇格）／要員計画モジュール（横断ビュー。旧 `staffing` → `resource` へ発展・#27 / #52）／Product マスタ新設（#37）／Product スコープ次元の config 配線（#54）。**残る実装**: product-scoped モジュールの実体化は必要になった時点の後続 Issue で扱う。
- （将来）チームの OKR/KPI 管理。必要になれば goals とは別概念の新モジュールとして検討する（§1.4）。
