/* シェル：起動基盤・ルーター（classic script・window.MK 名前空間）。
   shell.js が肥大化したモノリスだったため、責務ごとに shell-*.js へ分割した（Issue #140）。
   ファイル間の連携は window.MK.shell（＝S。シェル内部の共有オブジェクト。モジュールからは触らない）に
   定数・DOM 参照・可変状態（current / peopleDetailId）と「他ファイルから呼ばれる関数」だけを載せて行う。
   読込順は shared/manifest.js が保証する（core → nav → home → palette → masters → settings → shell(=ブート)）。

   このファイル（shell-core）が最初に読まれ S を生成する。以降のファイルは S を参照するだけ。
   「どのゾーン/どのモジュールを積むか」はエントリHTML側の window.MK_CONFIG から受け取る
   （配布プロファイル。spec §1.5）。シェル本体はプロファイルに依存しない。 */
(function () {
  "use strict";
  const MK = window.MK;
  const el = MK.util.el;
  // シェル内部の共有オブジェクト（S）。ここで生成し、以降の shell-*.js が拡張する。
  const S = (window.MK.shell = {});

  // モジュールのメタ（title/icon。未実装は「準備中」表示）spec §5。
  // 単一ソースは各モジュールの def（MK.registerModule の title/icon）とする（Issue #142）。
  // ここでは全カタログ id 分の META を作り、def があればそれを、無ければ（準備中）カタログの
  // フォールバック値を、それも無ければ id 自身を採る。カタログ（構成マニフェスト・Issue #137）は
  // 「どのモジュールがあるか／並び順」の単一ソースで、id ごとに META エントリを1つ持たせる
  // （home/nav/palette 等の `META[id]` 存在判定がカタログ既知性の判定を兼ねるため）。
  // モジュール JS はシェルより先に読み込まれる（manifest の logic→view→shell 順）ので
  // ここで MK.modules は出そろっている。
  const MANIFEST = window.MK_MANIFEST || {};
  const CATALOG = MANIFEST.catalog || {};
  const META = {};
  Object.keys(CATALOG).forEach((id) => {
    const def = MK.modules[id];
    const fb = CATALOG[id] || {};
    META[id] = {
      title: (def && def.title) || fb.title || id,
      icon: (def && def.icon) || fb.icon || "",
    };
  });
  // ゾーン構成は配布プロファイル（window.MK_CONFIG.zones）から受け取る。未指定なら
  // マニフェストの既定（マネージャ用の全部入り）にフォールバックする（spec §1.4 / §1.5 / §6.4）。
  const DEFAULT_ZONES = MANIFEST.zones || [];
  // マスタは特定ゾーンの持ち物ではなく、settings と同列の「シェルレベル管理グループ」
  // として独立させる（spec §3.6 / Issue #46）。プロジェクトは wbs（デリバリー）だけで
  // なく resource（ピープル）からも参照される横断的存在（scope: "global"・§4.6）であり、
  // ゾーン配下に置くと横断性が過小表現になるため、ゾーンから切り離してナビ描画する。
  const DEFAULT_MASTERS = [
    { view: "master-people", label: "👤 人" },
    { view: "master-projects", label: "📁 プロジェクト" },
  ];
  const hasConfig = !!window.MK_CONFIG;   // エントリが配布プロファイルを宣言したか
  const CONFIG = window.MK_CONFIG || {};
  const ZONES = Array.isArray(CONFIG.zones) ? CONFIG.zones : DEFAULT_ZONES;
  // マスタは config が明示した分のみ出す。config を宣言するエントリ（member.html 等）で
  // masters を持たなければマスタグループは非表示＝到達不能になる（spec §1.5）。config が
  // 完全に無い素の起動時のみ、ZONES と同様にマネージャ既定へフォールバックする。
  const MASTERS = Array.isArray(CONFIG.masters) ? CONFIG.masters
    : (hasConfig ? [] : DEFAULT_MASTERS);
  // このプロファイルで到達可能なビュー（ナビに出るもの＋常設の settings）。
  // 設定に載っていないビューは route から拒否し、配布用エントリでチーム系ビューへ
  // 到達できないことを担保する。
  const ALLOWED = (function () {
    const set = { home: true, settings: true };
    ZONES.forEach((z) => { (z.modules || []).forEach((id) => { set[id] = true; }); });
    MASTERS.forEach((a) => { set[a.view] = true; });
    return set;
  })();
  // ゾーンに載るモジュール id の集合。hiddenModules の判定対象をこれに限定し、設定に
  // 未知 id や特別ビュー名（home 等）が残っていても安全に無視する（Issue #35）。
  const ZONE_MODULES = (function () {
    const set = {};
    ZONES.forEach((z) => { (z.modules || []).forEach((id) => { set[id] = true; }); });
    return set;
  })();
  const LEGACY_KEYS = {
    "mokuhyo-mieru-kun:v1": "goals",
    "skill-tool-data-v1": "skills",
    "todo-kun.data.v1": "todo",
    "wbs-tool-data-v1": "wbs",
  };

  const main = document.getElementById("mk-main");
  const nav = document.getElementById("mk-nav");

  // ---- 設定 ----
  function getSettings() {
    const s = MK.store.read("settings");
    // lastModule はプロファイル非依存にするため既定を持たない（起動時に firstView() へフォールバック）
    return s || { version: 1, lastModule: null, migration: { fromLegacyDone: false }, ui: {} };
  }
  function setSettings(patch) {
    MK.store.write("settings", Object.assign(getSettings(), patch));
  }

  // ---- モジュールの表示・非表示（Issue #35）----
  // UI（ナビ / HOME）から隠すだけで、データ（mk:module:<id>:*）・マスタ連携は保持する（無効化ではない）。
  function getHiddenModules() {
    const h = getSettings().hiddenModules;
    return Array.isArray(h) ? h : [];
  }
  function isHiddenModule(id) {
    return ZONE_MODULES[id] === true && getHiddenModules().indexOf(id) >= 0;
  }
  function setModuleHidden(id, hidden) {
    const h = getHiddenModules().filter((x) => x !== id);
    if (hidden) h.push(id);
    setSettings({ hiddenModules: h });
  }

  // ---- HOME のピン留め（Issue #100）----
  // ピン留めしたモジュールは HOME 先頭にフルカード、それ以外はゾーン配下のチップで出す。
  // hiddenModules と同じく ZONE_MODULES で未知 id を無視し、非表示（hidden）が優先される。
  function getPinnedModules() {
    const p = getSettings().pinnedModules;
    return Array.isArray(p) ? p : [];
  }
  function isPinnedModule(id) {
    return ZONE_MODULES[id] === true && getPinnedModules().indexOf(id) >= 0;
  }
  function setModulePinned(id, pinned) {
    const p = getPinnedModules().filter((x) => x !== id);
    if (pinned) p.push(id);
    setSettings({ pinnedModules: p });
  }

  // ---- HOME のゾーン折りたたみ（Issue #100。ナビの mk:settings.nav と同型）----
  function getHomeZones() { return getSettings().homeZones || {}; }
  function toggleHomeZone(label) {
    const z = Object.assign({}, getHomeZones());
    z[label] = !z[label];
    setSettings({ homeZones: z });
  }

  // ---- テーマ（ダークモード。spec §6.2）----
  function getTheme() {
    const t = getSettings().theme;
    if (t === "dark" || t === "light") return t;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function applyTheme(theme) {
    if (theme === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    const btn = document.getElementById("btn-theme");
    if (btn) { btn.textContent = theme === "dark" ? "☀" : "🌙"; }
    MK.bus.emit("theme:changed", { theme }); // 将来のグラフ再描画フック
  }
  function toggleTheme() {
    const next = getTheme() === "dark" ? "light" : "dark";
    setSettings({ theme: next });
    applyTheme(next);
  }

  // ---- スコープ次元の「現在の対象」（次元ごとに独立。§3.7.3）----
  // 設定 mk:settings の scope に { <dim>: <targetId> } で保持する。
  function getScopeTarget(dimKey) { return (getSettings().scope || {})[dimKey] || null; }
  function setScopeTarget(dimKey, id) {
    const s = getSettings(); s.scope = Object.assign({}, s.scope); s.scope[dimKey] = id;
    setSettings({ scope: s.scope });
  }

  // ---- ctx（モジュールへ渡す契約。spec §3.5 / §3.7.3）----
  function ctxFor(id) {
    const def = MK.modules[id] || {};
    const dim = MK.scope.dimOf(def.scope);                 // scoped なら次元 config、global なら null
    const targetId = dim ? MK.scope.resolveTarget(dim, getScopeTarget(dim.dim)) : null;
    // scoped は対象別 namespace（mk:module:<id>:<targetId>:v1）へ、global は従来通り（§3.7.4）
    const ns = MK.scope.storeNsFor(id, def.scope, targetId);
    let scope = null;
    if (dim && targetId) scope = { dim: dim.dim, id: targetId, entity: MK.scope.master(dim).get(targetId) };
    return {
      store: MK.store.scope(ns),
      scope,
      // 横断集約ビュー（ダッシュボード等）が各サマリから該当モジュールへ遷移するための導線（spec §3.5）。
      // project-scoped 同士（dashboard → wbs）は「現在の対象」が次元ごとに共有されるため PJ 文脈を引き継ぐ。
      route,
      people: MK.people,
      projects: MK.projects,
      allocations: MK.allocations,
      demands: MK.demands,
      io: MK.io,
      ui: MK.ui,
      bus: MK.bus,
      util: MK.util,
      settings: {
        get() { return (getSettings().ui || {})[id] || {}; },
        set(v) { const s = getSettings(); s.ui = s.ui || {}; s.ui[id] = v; setSettings({ ui: s.ui }); },
      },
    };
  }

  // ---- ルーティング ----
  // 各ビューの描画関数は別ファイル（home/masters/settings/nav）にあるため S 経由で遅延解決する。
  function route(view) {
    // 配布プロファイルに載っていないビュー（例: 自分配布での master-people / master-projects）と
    // 非表示モジュール（Issue #35）は先頭ゾーンの表示中モジュールへ退避
    if (!ALLOWED[view] || isHiddenModule(view)) view = firstView();
    if (S.mountedModule && typeof S.mountedModule.unmount === "function") S.mountedModule.unmount();
    S.mountedModule = null;
    main.innerHTML = "";
    S.current = view;
    S.renderNav();

    if (MK.modules[view]) {
      mountModuleView(view);
      // lastModule は「モジュール」だけを記録する（特別ビュー home/master-*/settings は記録しない）。
      // これは startView === "last" のときの復元先＝直近に開いていたモジュール（§3.6）に対応する。
      setSettings({ lastModule: view });
    } else if (view === "home") {
      S.renderHome();
    } else if (view === "master-people") {
      S.renderPeopleView();
    } else if (view === "master-projects") {
      S.renderProjectsView();
    } else if (view === "master-products") {
      S.renderProductsView();
    } else if (view === "settings") {
      S.renderSettings();
    } else {
      // 未実装モジュール
      const meta = META[view];
      main.appendChild(el("h2", { class: "mk-section-title", text: (meta ? meta.title : view) + "（準備中）" }));
      main.appendChild(el("p", { class: "mk-empty", text: "このモジュールは今後のリリースで実装予定です（spec §9）。" }));
    }
  }

  // 先頭ゾーンの最初の表示中モジュール（起動・退避先のデフォルト）。
  // 全モジュール非表示でも settings へ退避し、操作不能にならない（Issue #35）。
  function firstView() {
    for (let i = 0; i < ZONES.length; i++) {
      const mods = (ZONES[i].modules || []).filter((id) => !isHiddenModule(id));
      if (mods.length) return mods[0];
    }
    return "settings";
  }

  // ---- モジュールのマウント（global / scoped 共通の入口。§3.7.3）----
  function mountModuleView(view) {
    const def = MK.modules[view];
    const dim = MK.scope.dimOf(def.scope);
    if (!dim) { S.mountedModule = def; def.mount(main, ctxFor(view)); return; } // global

    // scoped: 縮退モード（0=作成導線 / 1=畳む / 2+=スイッチャ）で分岐する（§3.7.2）
    const entities = MK.scope.entities(dim);
    const mode = MK.scope.mode(entities.length);
    if (mode === "empty") { renderScopeEmpty(dim); return; }
    const targetId = MK.scope.resolveTarget(dim, getScopeTarget(dim.dim));
    setScopeTarget(dim.dim, targetId); // 正規化した現在対象を保存（削除で無効化された id を先頭へ寄せる等）
    main.appendChild(renderScopeBar(view, dim, entities, targetId, mode));
    const host = el("div");
    main.appendChild(host);
    S.mountedModule = def;
    def.mount(host, ctxFor(view));
  }

  // 要素数0: 「まず対象を作る」導線（§3.7.2）。到達可能ならマスタ管理へ誘導する。
  function renderScopeEmpty(dim) {
    const box = el("div", { class: "card mk-scope-empty" });
    box.appendChild(el("p", { class: "mk-empty", text: "「" + dim.label + "」がまだありません。まず作成してください。" }));
    const masterView = "master-" + dim.master; // 例: master-projects（"project" 決め打ちしない）
    if (ALLOWED[masterView]) {
      const btn = el("button", { class: "btn btn-primary", text: dim.label + "を作成" });
      btn.addEventListener("click", () => route(masterView));
      box.appendChild(btn);
    }
    main.appendChild(box);
  }

  // スコープ切替スイッチャ。single は畳んで現在対象のラベルのみ、multi は選択 UI を出す（§3.7.2/3）。
  function renderScopeBar(view, dim, entities, targetId, mode) {
    const bar = el("div", { class: "mk-scope-bar" });
    bar.appendChild(el("span", { class: "mk-scope-label", text: dim.label }));
    if (mode === "single") {
      // single は要素数1が確約されるため entities[0] は必ず存在する（§3.7.2）
      bar.appendChild(el("span", { class: "mk-scope-current", text: entities[0].name }));
      return bar;
    }
    const sel = el("select", { class: "text-input mk-scope-select" });
    entities.forEach((e) => {
      const opt = el("option", { value: e.id, text: e.name });
      if (e.id === targetId) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener("change", () => { setScopeTarget(dim.dim, sel.value); route(view); });
    bar.appendChild(sel);
    return bar;
  }

  // ---- S へ公開（定数・DOM 参照・可変状態・他ファイルから呼ばれる関数）----
  S.META = META;
  S.ALLOWED = ALLOWED;
  S.ZONES = ZONES;
  S.MASTERS = MASTERS;
  S.ZONE_MODULES = ZONE_MODULES;
  S.LEGACY_KEYS = LEGACY_KEYS;
  S.main = main;
  S.nav = nav;
  S.current = null;          // 現在のビューID
  S.mountedModule = null;    // mount 中のモジュール def
  // 開いている人詳細の personId。null なら一覧。masters:changed 再描画をまたいで保持する（Issue #83）。
  S.peopleDetailId = null;
  S.route = route;
  S.getSettings = getSettings;
  S.setSettings = setSettings;
  S.isHiddenModule = isHiddenModule;
  S.setModuleHidden = setModuleHidden;
  S.getPinnedModules = getPinnedModules;
  S.isPinnedModule = isPinnedModule;
  S.setModulePinned = setModulePinned;
  S.getHomeZones = getHomeZones;
  S.toggleHomeZone = toggleHomeZone;
  S.getTheme = getTheme;
  S.applyTheme = applyTheme;
  S.toggleTheme = toggleTheme;
})();
