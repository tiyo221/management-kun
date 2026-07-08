/* モジュール／構成マニフェスト（単一ソース）— classic script・依存ゼロ・file:// 動作（Issue #137）。
   「どのモジュールがあるか（カタログ）」「既定のゾーン割当」「読み込むファイル」を **1か所** に集約し、
   エントリ HTML（index.html / member.html）と shell.js での二重管理を無くす。

   役割は2つ:
   1. データ宣言: window.MK_MANIFEST に catalog / zones / shared を載せる。shell.js はここを参照して
      META（表示メタ）と DEFAULT_ZONES（マネージャ全部入りのフォールバック）を得る。テストハーネス
      （test/harness.js）も同じデータから共有資産・モジュール一覧を導出する。
   2. スクリプト注入: ブラウザでは、エントリの window.MK_CONFIG（プロファイル）に応じて共有資産＋必要な
      モジュール（logic→view）＋ shell.js を **読込順を保って** 動的に読み込む。エントリ側は
      `<script src="shared/manifest.js">` の1行だけでよく、モジュール追加時に <script> タグを増やさない。

   設計上の制約（spec §3.3 / CODING.md）を維持: ビルド不要・外部依存ゼロ・file:// 動作・ES Modules/fetch 不使用。 */
(function () {
  "use strict";

  // モジュールのカタログ（表示メタ）。ここが title / icon の単一ソース（shell.js の META はここを読む）。
  // カタログにあるが既定ゾーンに載らないモジュール（例: workload＝旧「負荷」。resource に統合済みだが
  // 旧データ移行のため実体は残す）は、下の load で明示的に読み込む。
  // 並び順 = 既定の moduleOrder（人詳細の集約ビュー #83 が走査する順）。ゾーン順に整える。
  const CATALOG = {
    todo:      { title: "ToDo", icon: "✅" },
    goals:     { title: "目標", icon: "🎯" },
    questions: { title: "わからないこと", icon: "❓" },
    skills:    { title: "スキル", icon: "📊" },
    workload:  { title: "負荷", icon: "📈" },
    resource:  { title: "リソース", icon: "🧑‍🤝‍🧑" },
    oneonone:  { title: "1on1", icon: "🗣" },
    dashboard: { title: "ダッシュボード", icon: "🧭" },
    wbs:       { title: "WBS", icon: "🗂" },
    techstack: { title: "技術スタック", icon: "🧰" },
    releases:  { title: "リリース", icon: "🚀" },
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

  // ゾーンに載らないが常に読み込むモジュール（既定＝マネージャプロファイルのみ）。
  // workload は UI に出さない（zones 外）が、旧ツール移行（shell.js migrateLegacy）が参照するため読む。
  const LOAD = ["workload"];

  // 共有資産（全プロファイルで読み込む土台。読込順＝依存順。spec §3.3）。
  // プロファイル別の絞り込みはしない（people/projects/allocations と同格の共有マスタは基盤扱い）。
  // 分離の単位は「モジュール」＝ゾーンに載せないモジュールの logic/view を読み込まないことで担保する
  // （spec §1.5）。共有マスタ（products/demands 等）は UI（masters 設定・該当モジュール）が無ければ
  // 作成経路が無く、配布物で参照されないだけで無害。土台を絞る仕組みは必要になるまで作らない（YAGNI）。
  const SHARED = [
    "core", "store", "scope", "io",
    "people", "projects", "products", "search", "allocations", "demands",
    "ui", "sample",
  ];

  window.MK_MANIFEST = { catalog: CATALOG, zones: ZONES, load: LOAD, shared: SHARED };

  // ---- ブラウザでのスクリプト注入 ----
  // Node（テストハーネス）は自前でファイルを読み込むため、DOM が無ければここで終了する。
  if (typeof document === "undefined" || !document.head) return;

  const cfg = window.MK_CONFIG || {};
  // プロファイルが zones を宣言していればそれ（配布サブセット）を、無ければ既定（マネージャ全部入り）を使う。
  // ゾーン外の追加ロード（LOAD＝workload）は既定プロファイルにだけ効かせる。配布プロファイルは自分の
  // zones だけを載せるのが目的なので、旧データ移行専用モジュールまで引き込まない。
  const hasZones = Array.isArray(cfg.zones);
  const zones = hasZones ? cfg.zones : ZONES;
  const extra = hasZones ? [] : LOAD;

  // 読み込むモジュール id 集合を作り、カタログ順に整列する（moduleOrder をカタログ順に固定）。
  const wanted = {};
  zones.forEach((z) => (z.modules || []).forEach((id) => { wanted[id] = true; }));
  extra.forEach((id) => { wanted[id] = true; });
  const moduleIds = Object.keys(CATALOG).filter((id) => wanted[id]);

  // 読込順: 共有資産 → 各モジュール（logic→view）→ shell.js。
  const srcs = [];
  SHARED.forEach((s) => srcs.push("shared/" + s + ".js"));
  moduleIds.forEach((id) => { srcs.push("modules/" + id + "/logic.js"); srcs.push("modules/" + id + "/view.js"); });
  srcs.push("shared/shell.js");

  // async=false で動的挿入したスクリプトは「挿入順」に実行される（logic→view→shell の順序保証）。
  // document.write を使わず、file:// でも順序どおり読み込める。
  srcs.forEach((src) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = false;
    document.head.appendChild(s);
  });
})();
