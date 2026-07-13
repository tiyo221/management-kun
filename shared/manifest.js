/* モジュール／構成マニフェスト（単一ソース）— classic script・依存ゼロ・file:// 動作（Issue #137）。
   「どのモジュールがあるか（カタログ）」「既定のゾーン割当」「読み込むファイル」を **1か所** に集約し、
   エントリ HTML（index.html / member.html）と shell.js での二重管理を無くす。

   役割は2つ:
   1. データ宣言: window.MK_MANIFEST に catalog / zones / shared を載せる。shell.js はここを参照して
      モジュール id の集合・並び順と DEFAULT_ZONES（マネージャ全部入りのフォールバック）を得る。
      表示メタ（title/icon/description）は各モジュールの def が単一ソース（Issue #142）。テストハーネス
      （test/harness.js）も同じデータから共有資産・モジュール一覧を導出する。
   2. スクリプト注入: ブラウザでは、エントリの window.MK_CONFIG（プロファイル）に応じて共有資産＋必要な
      モジュール（logic→view）＋ shell.js を **読込順を保って** 動的に読み込む。エントリ側は
      `<script src="shared/manifest.js">` の1行だけでよく、モジュール追加時に <script> タグを増やさない。

   設計上の制約（spec §3.3 / CODING.md）を維持: ビルド不要・外部依存ゼロ・file:// 動作・ES Modules/fetch 不使用。 */
(function () {
  "use strict";

  // モジュールのカタログ。キー＝全モジュール id の登録（＝どのモジュールがあるか）と並び順
  // （moduleOrder。人詳細の集約ビュー #83 が走査する順。ゾーン順に整える）を担う。
  // 表示メタ（title / icon / description）の単一ソースは各モジュールの def（MK.registerModule）側に置き、
  // ここには持たせない（Issue #142。以前は title/icon をここと def の二重管理だった）。
  // 値は原則空 {}。例外として、まだ def を持たない「準備中」モジュールは、HOME 等で名前を出すため
  // フォールバックの { title, icon } をここに書ける（def を実装したら空へ戻す。shell が def を優先して読む）。
  const CATALOG = {
    todo:      {},
    goals:     {},
    questions: {},
    skills:    {},
    resource:  {},
    oneonone:  {},
    dashboard: {},
    wbs:       {},
    techstack: {},
    releases:  {},
  };

  // 既定（マネージャ全部入り）のゾーン割当。index.html は zones を宣言せずこれを使う（＝ここが正）。
  // 配布プロファイル（member.html）は自分のゾーンを MK_CONFIG.zones で上書き宣言する（サブセット）。
  // 分類は EM が見る領域で切る（自分＋4領域。spec §1.4 / §3.6）。
  const ZONES = [
    { label: "自分", modules: ["todo", "goals", "questions"] },
    { label: "ピープル", modules: ["skills", "resource", "oneonone"] },
    { label: "デリバリー", modules: ["dashboard", "wbs"] },
    { label: "プロダクト", modules: ["releases"] },
    { label: "テクノロジー", modules: ["techstack"] },
  ];

  // ゾーンに載らないが常に読み込むモジュール（既定＝マネージャプロファイルのみ）。現状は無し。
  // （旧 workload はゾーン外ロードだったが Issue #167 で退役・撤去。旧データの吸い上げは
  //  モジュール本体に依存しない store レベルの終端移行 MK.allocations.migrateFromWorkload() が担う。）
  const LOAD = [];

  // 共有資産（全プロファイルで読み込む土台。読込順＝依存順。spec §3.3）。
  // プロファイル別の絞り込みはしない（people/projects/allocations と同格の共有マスタは基盤扱い）。
  // 分離の単位は「モジュール」＝ゾーンに載せないモジュールの logic/view を読み込まないことで担保する
  // （spec §1.5）。共有マスタ（products/demands 等）は UI（masters 設定・該当モジュール）が無ければ
  // 作成経路が無く、配布物で参照されないだけで無害。土台を絞る仕組みは必要になるまで作らない（YAGNI）。
  const SHARED = [
    "core", "store", "scope", "io", "masters",
    "people", "projects", "products", "search", "allocations", "demands",
    "ui", "sample",
  ];

  window.MK_MANIFEST = { catalog: CATALOG, zones: ZONES, load: LOAD, shared: SHARED };

  // ---- ブラウザでのスクリプト注入 ----
  // Node（テストハーネス）は自前でファイルを読み込むため、DOM が無ければここで終了する。
  if (typeof document === "undefined" || !document.head) return;

  const cfg = window.MK_CONFIG || {};
  // プロファイルが zones を宣言していればそれ（配布サブセット）を、無ければ既定（マネージャ全部入り）を使う。
  // ゾーン外の追加ロード（LOAD）は既定プロファイルにだけ効かせる。配布プロファイルは自分の
  // zones だけを載せるのが目的なので、ゾーン外モジュールまで引き込まない。
  const hasZones = Array.isArray(cfg.zones);
  const zones = hasZones ? cfg.zones : ZONES;
  const extra = hasZones ? [] : LOAD;

  // 読み込むモジュール id 集合を作り、カタログ順に整列する（moduleOrder をカタログ順に固定）。
  const wanted = {};
  zones.forEach((z) => (z.modules || []).forEach((id) => { wanted[id] = true; }));
  extra.forEach((id) => { wanted[id] = true; });
  const moduleIds = Object.keys(CATALOG).filter((id) => wanted[id]);

  // シェルはビュー単位に分割してある（Issue #140）。読込順は core が最初（S＝window.MK.shell を生成）、
  // shell.js が最後（起動配線＝ブート。全描画関数が S に載った後に走る）。間の順序は palette が
  // home の moduleDescription を借りるため home→palette とする以外は独立。
  const SHELL = [
    "shell-core", "shell-nav", "shell-home", "shell-palette", "shell-masters", "shell-settings", "shell",
  ];

  // 読込順: 共有資産 → 各モジュール（logic→view）→ シェル各ファイル。
  const srcs = [];
  SHARED.forEach((s) => srcs.push("shared/" + s + ".js"));
  moduleIds.forEach((id) => { srcs.push("modules/" + id + "/logic.js"); srcs.push("modules/" + id + "/view.js"); });
  SHELL.forEach((s) => srcs.push("shared/" + s + ".js"));

  // async=false で動的挿入したスクリプトは「挿入順」に実行される（logic→view→shell の順序保証）。
  // document.write を使わず、file:// でも順序どおり読み込める。
  srcs.forEach((src) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = false;
    document.head.appendChild(s);
  });
})();
