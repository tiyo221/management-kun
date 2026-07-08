/* シェル（ブートストラップ・ルーター）— classic script・window.MK 名前空間。
   「どのゾーン/どのモジュールを積むか」はエントリHTML側の window.MK_CONFIG から受け取る
   （配布プロファイル。spec §1.5）。シェル本体はプロファイルに依存しない。 */
(function () {
  "use strict";
  const MK = window.MK;
  const el = (t, a, c) => MK.util.el(t, a, c);

  // ストレージ使用量の警告閾値（この比率を超えたら設定画面で警告する。Issue #76）。
  const USAGE_WARN_RATIO = 0.8;
  function formatBytes(b) {
    if (b < 1024) return b + " B";
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
    return (b / (1024 * 1024)).toFixed(2) + " MB";
  }

  // モジュールのメタ（title/icon。未実装は「準備中」表示）spec §5。カタログは構成マニフェスト
  // （shared/manifest.js の window.MK_MANIFEST）を単一ソースとする（Issue #137）。エントリが積まない
  // モジュールの分は単に参照されないだけで無害。
  const MANIFEST = window.MK_MANIFEST || {};
  const META = MANIFEST.catalog || {};
  // ゾーン構成は配布プロファイル（window.MK_CONFIG.zones）から受け取る。未指定なら
  // マニフェストの既定（マネージャ用の全部入り）にフォールバックする（spec §1.4 / §1.5 / §6.4）。
  const DEFAULT_ZONES = MANIFEST.zones || [];
  // マスタは特定ゾーンの持ち物ではなく、settings と同列の「シェルレベル管理グループ」
  // として独立させる（spec §3.6 / Issue #46）。プロジェクトは wbs（デリバリー）だけで
  // なく workload（ピープル）からも参照される横断的存在（scope: "global"・§4.6）であり、
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
    "task-tool-data-v1": "workload",
    "todo-kun.data.v1": "todo",
    "wbs-tool-data-v1": "wbs",
  };

  const main = document.getElementById("mk-main");
  const nav = document.getElementById("mk-nav");
  let current = null;          // 現在のビューID
  let mountedModule = null;    // mount 中のモジュール def

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
  function route(view) {
    // 配布プロファイルに載っていないビュー（例: 自分配布での master-people / master-projects）と
    // 非表示モジュール（Issue #35）は先頭ゾーンの表示中モジュールへ退避
    if (!ALLOWED[view] || isHiddenModule(view)) view = firstView();
    if (mountedModule && typeof mountedModule.unmount === "function") mountedModule.unmount();
    mountedModule = null;
    main.innerHTML = "";
    current = view;
    renderNav();

    if (MK.modules[view]) {
      mountModuleView(view);
      // lastModule は「モジュール」だけを記録する（特別ビュー home/master-*/settings は記録しない）。
      // これは startView === "last" のときの復元先＝直近に開いていたモジュール（§3.6）に対応する。
      setSettings({ lastModule: view });
    } else if (view === "home") {
      renderHome();
    } else if (view === "master-people") {
      renderPeopleView();
    } else if (view === "master-projects") {
      renderProjectsView();
    } else if (view === "master-products") {
      renderProductsView();
    } else if (view === "settings") {
      renderSettings();
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
    if (!dim) { mountedModule = def; def.mount(main, ctxFor(view)); return; } // global

    // scoped: 縮退モード（0=作成導線 / 1=畳む / 2+=スイッチャ）で分岐する（§3.7.2）
    const entities = MK.scope.entities(dim);
    const mode = MK.scope.mode(entities.length);
    if (mode === "empty") { renderScopeEmpty(dim); return; }
    const targetId = MK.scope.resolveTarget(dim, getScopeTarget(dim.dim));
    setScopeTarget(dim.dim, targetId); // 正規化した現在対象を保存（削除で無効化された id を先頭へ寄せる等）
    main.appendChild(renderScopeBar(view, dim, entities, targetId, mode));
    const host = el("div");
    main.appendChild(host);
    mountedModule = def;
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

  // ---- HOME（玄関ダッシュボード。spec §3.6 / Issue #100）----
  // 2段階の情報密度: ピン留め（pinnedModules）＝フルカード、それ以外＝ゾーン配下の1行チップ。
  // ゾーンは折りたたみ可能（homeZones）。配布プロファイル（member.html）ではピープル/
  // デリバリーゾーンが ZONES に無いため、自動的に「自分」だけになる。
  function renderHome() {
    main.appendChild(el("h2", { class: "mk-section-title", text: "🏠 HOME" }));
    renderHomeAttention();
    renderHomePinned();
    ZONES.forEach((zone) => {
      // カタログ（META）未知の id・非表示（Issue #35）・ピン済み（先頭セクションに出る）を除外。
      // 実装済み／未実装（＝準備中チップ）はどちらも出す。
      const mods = (zone.modules || []).filter((id) => META[id] && !isHiddenModule(id) && !isPinnedModule(id));
      if (!mods.length) return; // 全部ピン済み or 非表示のゾーンは見出しごと出さない
      const collapsed = getHomeZones()[zone.label] === true;
      const head = el("button", {
        class: "mk-home-zone-toggle" + (collapsed ? " collapsed" : ""),
        "aria-expanded": String(!collapsed),
      }, [
        el("span", { class: "mk-home-caret", text: "▸" }),
        el("span", { class: "mk-home-zone-label", text: zone.label }),
      ]);
      head.addEventListener("click", () => { toggleHomeZone(zone.label); route("home"); });
      main.appendChild(head);
      if (collapsed) return;
      const row = el("div", { class: "mk-home-chips" });
      mods.forEach((id) => row.appendChild(homeChip(id)));
      main.appendChild(row);
    });
  }

  // 「要対応」帯（Issue #102）。表示中モジュールの summary().attention を集約し、severity 別の
  // バッジで表示する。attention は任意契約のため、未実装・不正形式のモジュールは単に出ない。
  // 要対応が1件も無ければ帯そのものを描画しない。
  const ATTENTION_RANK = { error: 0, warn: 1, info: 2 };
  function renderHomeAttention() {
    const items = [];
    ZONES.forEach((zone) => (zone.modules || []).forEach((id) => {
      if (!META[id] || isHiddenModule(id)) return;
      const sum = moduleSummary(id);
      if (!sum || !Array.isArray(sum.attention)) return;
      sum.attention.forEach((a) => {
        if (!a || typeof a.label !== "string") return;
        items.push({ id, label: a.label, severity: ATTENTION_RANK[a.severity] !== undefined ? a.severity : "info" });
      });
    }));
    if (!items.length) return;
    // 重要度順（error → warn → info）。同重要度はゾーン順を保つ（sort は安定）。
    items.sort((a, b) => ATTENTION_RANK[a.severity] - ATTENTION_RANK[b.severity]);
    const bar = el("div", { class: "mk-home-attention" });
    items.forEach((a) => {
      const b = el("button", {
        class: "mk-home-attn " + a.severity,
        "aria-label": META[a.id].title + ": " + a.label,
      }, [
        el("span", { class: "mk-home-attn-icon", text: META[a.id].icon || "" }),
        el("span", { text: a.label }),
      ]);
      b.addEventListener("click", () => route(a.id));
      bar.appendChild(b);
    });
    main.appendChild(bar);
  }

  // ピン留めセクション。ピンが無ければ使い方の案内だけ出す。
  function renderHomePinned() {
    const pinned = getPinnedModules().filter((id) => META[id] && ZONE_MODULES[id] && !isHiddenModule(id));
    if (!pinned.length) {
      main.appendChild(el("p", { class: "mk-home-pin-hint sub", text: "☆ を押してよく使うモジュールをピン留めすると、ここにサマリー付きで表示されます。" }));
      return;
    }
    main.appendChild(el("h3", { class: "mk-home-zone", text: "📌 ピン留め" }));
    const grid = el("div", { class: "mk-home-grid" });
    pinned.forEach((id) => grid.appendChild(homeCard(id)));
    main.appendChild(grid);
  }

  // モジュールの1行説明（＝「何ができるか」。Issue #40）。定義側 def.description を単一ソース
  // にし、META へハードコードして二重管理しない。準備中（未実装＝def なし）は説明を持たない。
  function moduleDescription(id) {
    const mod = MK.modules[id];
    return mod && typeof mod.description === "string" ? mod.description : "";
  }

  // summary は任意契約。未実装・例外でも HOME 全体を壊さない（null を返して呼び手がフォールバック）。
  // 実体は DOM 非依存の共通プリミティブ MK.readSummary（core.js・spec §9.5 柱1）に委譲し単一ソース化する。
  function moduleSummary(id) { return MK.readSummary(id); }

  // ピン留めトグル（★/☆）。カード／チップのクリック遷移と衝突しないよう伝播を止める。
  // 再描画後もフォーカスを同じトグルへ戻し、キーボード操作を連続できるようにする。
  function pinButton(id) {
    const pinned = isPinnedModule(id);
    const b = el("button", {
      class: "mk-home-pin" + (pinned ? " pinned" : ""),
      "aria-label": (pinned ? "ピン留めを解除: " : "ピン留め: ") + META[id].title,
      "aria-pressed": String(pinned),
      title: pinned ? "ピン留めを解除" : "ピン留め",
      "data-pin": id,
      text: pinned ? "★" : "☆",
    });
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      setModulePinned(id, !pinned);
      route("home");
      const again = main.querySelector('[data-pin="' + CSS.escape(id) + '"]');
      if (again) again.focus();
    });
    return b;
  }

  function homeCard(id) {
    const meta = META[id];
    const card = el("div", { class: "card mk-home-card", role: "button", tabindex: "0" });
    card.appendChild(el("div", { class: "mk-home-card-head" }, [
      el("span", { class: "mk-home-icon", text: meta.icon || "" }),
      el("span", { class: "mk-home-title", text: meta.title }),
      pinButton(id),
    ]));
    // 1行説明（何ができるか。Issue #40）。stats の上に置き、初見でも用途が分かるようにする。
    const desc = moduleDescription(id);
    if (desc) card.appendChild(el("div", { class: "mk-home-desc", text: desc }));
    if (!MK.modules[id]) {
      card.appendChild(el("div", { class: "sub", text: "準備中" }));
    } else {
      const sum = moduleSummary(id);
      if (!sum || !Array.isArray(sum.stats)) {
        card.appendChild(el("div", { class: "sub", text: "開く" }));
      } else if (sum.empty) {
        card.appendChild(el("div", { class: "mk-home-empty sub", text: "データがありません" }));
      } else {
        const row = el("div", { class: "mk-home-stats" });
        sum.stats.forEach((s) => row.appendChild(el("div", { class: "mk-stat" }, [
          el("div", { class: "num", text: String(s.value) }),
          el("div", { class: "lbl", text: s.label }),
        ])));
        card.appendChild(row);
      }
    }
    const go = () => route(id);
    card.addEventListener("click", go);
    // ピン留めトグル（内包 button）からのバブリングでは遷移しない（e.target を自分に限定）
    card.addEventListener("keydown", (e) => { if (e.target !== card) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    return card;
  }

  // ピンしていないモジュールの1行チップ（アイコン＋名前＋代表値1つ）。クリックで遷移。
  function homeChip(id) {
    const meta = META[id];
    const chip = el("div", { class: "mk-home-chip", role: "button", tabindex: "0" });
    chip.appendChild(el("span", { class: "mk-home-chip-icon", text: meta.icon || "" }));
    chip.appendChild(el("span", { class: "mk-home-chip-title", text: meta.title }));
    // 1行説明（何ができるか。Issue #40）。初見でも用途が分かるよう名前の隣に添える。
    const desc = moduleDescription(id);
    if (desc) chip.appendChild(el("span", { class: "mk-home-chip-desc", text: desc }));
    if (!MK.modules[id]) {
      chip.appendChild(el("span", { class: "mk-home-chip-stat", text: "準備中" }));
    } else {
      const sum = moduleSummary(id);
      const s = sum && Array.isArray(sum.stats) && !sum.empty ? sum.stats[0] : null;
      if (s) chip.appendChild(el("span", { class: "mk-home-chip-stat", text: s.label + " " + String(s.value) }));
    }
    chip.appendChild(pinButton(id));
    const go = () => route(id);
    chip.addEventListener("click", go);
    chip.addEventListener("keydown", (e) => { if (e.target !== chip) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    return chip;
  }

  // ---- グローバル検索（コマンドパレット。Ctrl+K / Cmd+K。Issue #82 / spec §3.5・§10.2）----
  // 検索対象を1本の配列に集約する。人・プロジェクト・（あれば）プロダクトのマスタ、到達可能な
  // モジュール名（画面ジャンプ）、各モジュールが任意契約 def.searchItems() で供給するレコード。
  // 到達不能なビュー（配布プロファイルで masters を持たない等）は候補に混ぜない。
  function buildSearchSources() {
    const items = [];
    // モジュール名（画面ジャンプ）。ナビと同じ条件（カタログ既知・非表示除外・到達可能）。
    ZONES.forEach((zone) => (zone.modules || []).forEach((id) => {
      if (!META[id] || isHiddenModule(id) || !ALLOWED[id]) return;
      items.push({ kind: "module", icon: META[id].icon || "🧩", label: META[id].title,
        sub: moduleDescription(id) || "モジュールを開く", view: id, keywords: [id] });
    }));
    // 人マスタ
    if (ALLOWED["master-people"] && MK.people) {
      MK.people.all().forEach((m) => items.push({ kind: "person", icon: "👤", label: m.name,
        sub: [m.role, m.note].filter(Boolean).join(" / ") || "人（マスタ）", view: "master-people", entityId: m.id }));
    }
    // プロジェクトマスタ
    if (ALLOWED["master-projects"] && MK.projects) {
      MK.projects.all().forEach((p) => items.push({ kind: "project", icon: "📁", label: p.name,
        sub: MK.projects.statusLabel(p.status) || "プロジェクト（マスタ）", view: "master-projects" }));
    }
    // プロダクトマスタ（member 配布では products.js を積まないため存在チェックする）
    if (ALLOWED["master-products"] && MK.products) {
      MK.products.all().forEach((p) => items.push({ kind: "product", icon: "📦", label: p.name,
        sub: p.summary || "プロダクト（マスタ）", view: "master-products" }));
    }
    // 各モジュールの主要レコード（任意契約 def.searchItems()）。未実装・例外は無視する。
    Object.keys(MK.modules).forEach((id) => {
      if (isHiddenModule(id) || !ALLOWED[id]) return;
      const def = MK.modules[id];
      if (typeof def.searchItems !== "function") return;
      let rows;
      try { rows = def.searchItems(); } catch (e) { console.warn("searchItems() failed:", id, e); return; }
      if (!Array.isArray(rows)) return;
      rows.forEach((r) => {
        if (!r || typeof r.label !== "string") return;
        items.push({ kind: "record", icon: META[id] ? META[id].icon : "🔎",
          label: r.label, sub: r.sub || (META[id] ? META[id].title : id),
          keywords: r.keywords || [], view: id });
      });
    });
    return items;
  }

  let paletteEl = null;     // 開いているパレットの overlay（多重起動防止）
  let closePalette = null;  // 開いているパレットを閉じる関数（トグル・外部から閉じる用）
  function openPalette() {
    if (paletteEl) return;
    const sources = buildSearchSources();
    const overlay = el("div", { class: "mk-palette-overlay" });
    const box = el("div", { class: "mk-palette", role: "dialog", "aria-label": "検索" });
    const input = el("input", {
      class: "mk-palette-input", type: "text", placeholder: "人・プロジェクト・モジュールを検索…",
      "aria-label": "検索", autocomplete: "off", spellcheck: "false",
    });
    const list = el("div", { class: "mk-palette-list", role: "listbox" });
    box.appendChild(input);
    box.appendChild(list);
    overlay.appendChild(box);

    let results = [];
    let active = 0;

    function close() {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      paletteEl = null;
      closePalette = null;
    }
    function activate(item) {
      close();
      if (!item) return;
      // 人を選んだら一覧ではなく集約ビュー（詳細）を開く（Issue #83）。
      if (item.kind === "person" && item.entityId) peopleDetailId = item.entityId;
      route(item.view);
    }
    function renderList() {
      list.innerHTML = "";
      if (!results.length) {
        list.appendChild(el("div", { class: "mk-palette-empty", text: "一致する候補がありません" }));
        return;
      }
      results.forEach((item, i) => {
        const row = el("div", {
          class: "mk-palette-item" + (i === active ? " active" : ""),
          role: "option", "aria-selected": String(i === active),
        }, [
          el("span", { class: "mk-palette-icon", text: item.icon || "" }),
          el("span", { class: "mk-palette-text" }, [
            el("span", { class: "mk-palette-label", text: item.label }),
            item.sub ? el("span", { class: "mk-palette-sub", text: item.sub }) : null,
          ]),
          el("span", { class: "mk-palette-kind", text: KIND_LABELS[item.kind] || "" }),
        ]);
        row.addEventListener("mousemove", () => { if (active !== i) { active = i; paintActive(); } });
        row.addEventListener("click", () => activate(item));
        list.appendChild(row);
      });
    }
    // アクティブ行の見た目だけを更新（マウス移動のたびに全再描画しない）。
    function paintActive() {
      const rows = list.querySelectorAll(".mk-palette-item");
      for (let i = 0; i < rows.length; i++) {
        const on = i === active;
        rows[i].classList.toggle("active", on);
        rows[i].setAttribute("aria-selected", String(on));
      }
      const cur = rows[active];
      if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest" });
    }
    function recompute() {
      results = MK.search.rank(input.value, sources, 20);
      active = 0;
      renderList();
    }
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); if (results.length) { active = (active + 1) % results.length; paintActive(); } return; }
      if (e.key === "ArrowUp") { e.preventDefault(); if (results.length) { active = (active - 1 + results.length) % results.length; paintActive(); } return; }
      if (e.key === "Enter") { e.preventDefault(); activate(results[active]); return; }
    }

    input.addEventListener("input", recompute);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    paletteEl = overlay;
    closePalette = close;
    recompute();
    input.focus();
  }
  function togglePalette() { if (closePalette) closePalette(); else openPalette(); }
  // 候補の種別ラベル（右端に添える）。
  const KIND_LABELS = { module: "モジュール", person: "人", project: "プロジェクト", product: "プロダクト", record: "" };

  function navItem(label, view) {
    const b = el("button", { class: "mk-nav-item" + (current === view ? " active" : ""), text: label });
    // ナビからの遷移は常にトップ（人マスタなら一覧）を出す。開きっぱなしの人詳細（#83）はここで畳む。
    b.addEventListener("click", () => { peopleDetailId = null; route(view); closeSidebar(); });
    return b;
  }

  // ---- ナビの折りたたみ状態（ゾーン単位。設定 mk:settings.nav に { <label>: true=畳む } で保持）----
  function getNav() { return getSettings().nav || {}; }
  function toggleNavZone(label) { const n = Object.assign({}, getNav()); n[label] = !n[label]; setSettings({ nav: n }); }

  // サイドバー（ゾーン見出し＋配下モジュールの縦積み。折りたたみ可。Issue #34）。
  // 現在ビューを含むゾーンは畳んでいても展開して表示し、アクティブ項目を必ず見せる。
  function renderNav() {
    nav.innerHTML = "";
    // グローバル検索（Issue #82）。デスクトップはサイドバーが常時見えるため、ここを主導線にする
    // （狭幅では topbar の🔍と Ctrl+K）。ビュー遷移ではなくパレットを開くので navItem とは別扱い。
    const searchItem = el("button", { class: "mk-nav-item mk-nav-search" }, [
      el("span", { text: "🔍 検索" }),
      el("span", { class: "mk-nav-kbd", text: "Ctrl+K" }),
    ]);
    searchItem.addEventListener("click", () => { closeSidebar(); openPalette(); });
    nav.appendChild(searchItem);
    nav.appendChild(navItem("🏠 HOME", "home"));
    ZONES.forEach((zone) => {
      const items = [];
      (zone.modules || []).forEach((id) => {
        const m = META[id];
        if (!m) return; // カタログ未知のモジュールは無視
        if (isHiddenModule(id)) return; // 非表示モジュールはナビに出さない（Issue #35）
        const implemented = !!MK.modules[id];
        items.push(navItem((m.icon ? m.icon + " " : "") + m.title + (implemented ? "" : "・準備中"), id));
      });
      if (!items.length) return; // 実質空のゾーンは見出しごと出さない
      appendNavGroup(zone.label, items, (zone.modules || []).indexOf(current) >= 0);
    });
    // マスタ（人・プロジェクト）はゾーンから独立した「シェルレベル管理グループ」として
    // 設定の直前に置く（spec §3.6 / Issue #46）。config が masters を持たなければ非表示。
    if (MASTERS.length) {
      appendNavGroup("マスタ", MASTERS.map((a) => navItem(a.label, a.view)),
        MASTERS.some((a) => a.view === current));
    }
    nav.appendChild(navItem("⚙ 設定", "settings"));
  }

  // ナビの折りたたみグループ（ゾーン／マスタ共通）。現在ビューを含むグループは畳んでいても
  // 展開してアクティブ項目を必ず見せる（activeHere）。
  function appendNavGroup(label, items, activeHere) {
    const collapsed = getNav()[label] === true && !activeHere;
    const group = el("div", { class: "mk-nav-group-wrap" });
    const head = el("button", {
      class: "mk-nav-group" + (collapsed ? " collapsed" : ""),
      "aria-expanded": String(!collapsed),
    }, [
      el("span", { class: "mk-nav-caret", text: "▸" }),
      el("span", { class: "mk-nav-group-label", text: label }),
    ]);
    head.addEventListener("click", () => { toggleNavZone(label); renderNav(); });
    group.appendChild(head);

    const list = el("div", { class: "mk-nav-list" });
    if (collapsed) list.style.display = "none";
    items.forEach((it) => list.appendChild(it));
    group.appendChild(list);
    nav.appendChild(group);
  }

  // ---- サイドバーのドロワー開閉（≤768px。デスクトップは常時表示で無害）----
  function openSidebar() {
    document.body.classList.add("mk-nav-open");
    const m = document.getElementById("btn-menu");
    if (m) m.setAttribute("aria-expanded", "true");
  }
  function closeSidebar() {
    // 開いていない（＝デスクトップ含む常時表示）ときは何もしない。ナビ項目クリックのたびに
    // 走る無駄なクラス操作を避ける。開いていた場合のみ閉じ、フォーカスをハンバーガーへ戻す（a11y）。
    if (!document.body.classList.contains("mk-nav-open")) return;
    document.body.classList.remove("mk-nav-open");
    const m = document.getElementById("btn-menu");
    if (m) { m.setAttribute("aria-expanded", "false"); m.focus(); }
  }
  function toggleSidebar() {
    if (document.body.classList.contains("mk-nav-open")) closeSidebar(); else openSidebar();
  }

  // ---- マスタ管理（人＝ピープル / プロジェクト＝デリバリー。ドメイン別のビューに分離。spec §6.4）----
  // 開いている人詳細の personId。null なら一覧。masters:changed 再描画をまたいで保持する（productFilter と同様）。
  let peopleDetailId = null;
  function renderPeopleView() {
    // 詳細を開いている場合はそちらを描画（対象が削除されていたら一覧へ退避）。
    if (peopleDetailId) {
      const person = MK.people.get(peopleDetailId);
      if (person) { renderPersonDetail(person); return; }
      peopleDetailId = null;
    }
    main.appendChild(el("h2", { class: "mk-section-title", text: "👤 人（マスタ）" }));
    const body = el("div", {});
    main.appendChild(body);
    renderPeople(body);
  }
  function renderProjectsView() {
    main.appendChild(el("h2", { class: "mk-section-title", text: "📁 プロジェクト（マスタ）" }));
    const body = el("div", {});
    main.appendChild(body);
    renderProjects(body);
  }

  // ---- 人の詳細（関連情報の集約ビュー。Issue #83 / spec §3.6.1・§9.5 柱1）----
  // その人に紐づく各モジュールの概況を「読み取り専用の集約＋各モジュールへの遷移」で一望する。
  // 各枠は他モジュールをハード参照せず MK.readEntitySummary（"person", personId）経由で問い合わせる。
  //  - null（未搭載・未ロード・summaryFor 未実装・例外）→ 枠を黙って省く（疎結合。§9.5 保証3）
  //  - { empty: true } → 枠は出すが空状態案内（該当データ無し）
  //  - stats あり → 集約値を表示し、該当モジュールへ「開く →」で遷移
  // プロジェクト側の集約は dashboard（#78・project-scoped）が担い、ここでは重複させない（§9.6 判断記録）。
  function renderPersonDetail(person) {
    main.appendChild(el("h2", { class: "mk-section-title", text: "👤 " + person.name }));
    const back = el("button", { class: "btn btn-ghost", text: "← 人マスタ一覧へ" });
    back.addEventListener("click", () => { peopleDetailId = null; route("master-people"); });
    main.appendChild(el("div", { class: "mk-toolbar" }, [back]));

    const cards = [personInfoCard(person)];
    // 登録済みモジュールを表示順（moduleOrder）に走査。非表示モジュールは集約から除く（要対応帯と同様）。
    MK.moduleOrder.forEach((id) => {
      if (isHiddenModule(id)) return;
      const sum = MK.readEntitySummary(id, "person", person.id);
      if (!sum) return;                       // 未搭載/未実装/例外 → 枠を黙って省く（疎結合）
      cards.push(personSummaryCard(id, sum));
    });
    const prod = personProductsCard(person);  // 関連プロダクト（owner）。products マスタ未ロードなら null
    if (prod) cards.push(prod);
    main.appendChild(el("div", { class: "mk-stack" }, cards));
  }

  // 人の基本情報（マスタ: 役割・備考・表示色）＋編集導線。
  function personInfoCard(person) {
    const meta = [];
    if (person.color) meta.push(el("span", {
      style: "display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;background:" + person.color + ";vertical-align:middle;",
    }));
    if (person.role) meta.push(el("span", { class: "chip", text: person.role }));
    const kids = [el("h3", { text: "基本情報" }), el("div", { style: "font-weight:600;", text: person.name })];
    if (meta.length) kids.push(el("div", { class: "sub" }, meta));
    if (person.note) kids.push(el("p", { class: "sub", text: person.note }));
    const edit = el("button", { class: "btn btn-secondary", text: "編集" });
    // 一覧からの編集と同じモーダル。保存後は masters:changed で詳細/一覧が再描画される（editMember に統合・Issue #138）。
    edit.addEventListener("click", () => editMember(person));
    kids.push(edit);
    return el("div", { class: "card" }, [el("div", { class: "mk-stack" }, kids)]);
  }

  // 1モジュール分の集約カード（summary() と同型の { empty, stats, attention? } を描画）。
  function personSummaryCard(id, sum) {
    const meta = META[id] || {};
    const kids = [el("h3", { text: (meta.icon ? meta.icon + " " : "") + (meta.title || id) })];
    if (sum.empty || !Array.isArray(sum.stats) || !sum.stats.length) {
      kids.push(MK.ui.emptyState("この人の" + (meta.title || "データ") + "はまだありません。"));
    } else {
      kids.push(MK.ui.statsRow(sum.stats.map((s) => ({ num: s.value, label: s.label }))));
    }
    if (Array.isArray(sum.attention)) {
      sum.attention.forEach((a) => { if (a && a.label) kids.push(el("p", { class: "sub", style: "color:var(--color-error);", text: "⚠ " + a.label })); });
    }
    // 遷移導線は集約ビュー側が組み立てる（契約には持たせない・§3.6.1）。到達可能なモジュールのみ。
    if (ALLOWED[id] && !isHiddenModule(id)) {
      const go = el("button", { class: "btn btn-secondary", text: (meta.title || id) + " を開く →" });
      go.addEventListener("click", () => route(id));
      kids.push(go);
    }
    return el("div", { class: "card" }, [el("div", { class: "mk-stack" }, kids)]);
  }

  // 関連プロダクト（owner。Product マスタ・§4.4）。products は共有マスタのため MK.products を直接参照する
  // （モジュールではないので readEntitySummary の対象外）。未ロード（member 配布等）なら枠ごと出さない。
  function personProductsCard(person) {
    if (!MK.products) return null;
    const owned = MK.products.all().filter((p) => p.ownerId === person.id);
    const kids = [el("h3", { text: "📦 関連プロダクト（オーナー）" })];
    if (!owned.length) {
      kids.push(MK.ui.emptyState("この人がオーナーのプロダクトはありません。"));
    } else {
      const ul = el("ul", { class: "mk-list" });
      owned.forEach((p) => {
        const meta = [el("span", { class: "chip", text: productStatusLabel(p.status) })];
        if (p.summary) meta.push(el("span", { class: "sub", text: p.summary }));
        ul.appendChild(el("li", { class: "mk-row" }, [
          el("div", { class: "grow" }, [el("div", { text: p.name }), el("div", { class: "sub" }, meta)]),
        ]));
      });
      kids.push(ul);
    }
    if (ALLOWED["master-products"]) {
      const go = el("button", { class: "btn btn-secondary", text: "プロダクトを開く →" });
      go.addEventListener("click", () => route("master-products"));
      kids.push(go);
    }
    return el("div", { class: "card" }, [el("div", { class: "mk-stack" }, kids)]);
  }

  // ---- マスタ CRUD の共通骨格（人／プロジェクト／プロダクト。Issue #138）----
  // 追加バー＋CSV 入出力＋一覧の同型部分を1本に寄せ、マスタ固有部分（API・ラベル・行描画・
  // 編集モーダル・絞り込みタブ）だけ cfg で差し込む。再描画は各マスタ操作が発火する
  // masters:changed（下の bus ハンドラ）に一任し、手動の再描画コールバックは持たない。
  //   cfg.api          … マスタ本体（create/all/remove/buildCSVRows/applyCSV を持つ）
  //   cfg.list()       … 一覧に出す配列（絞り込み後。省略時は api.all()）
  //   cfg.addPlaceholder / cfg.addMaxWidth … 追加入力欄の文言・幅
  //   cfg.csvBase / cfg.exportToast / cfg.importToast(n) … CSV ファイル名接頭辞・トースト
  //   cfg.emptyText    … 0件時の文言
  //   cfg.renderInfo(item) … 行の左側（.grow）を作る（編集・削除ボタンは共通で付与）
  //   cfg.confirmText(item) / cfg.openEdit(item) … 削除確認文言・編集モーダル起動
  //   cfg.beforeList(container) … 一覧の前に差し込む任意 UI（例: 絞り込みタブ）
  //   cfg.onImport()   … CSV 取込後の副作用（例: 絞り込みを全件へ戻す）
  function renderMaster(container, cfg) {
    const bar = el("div", { class: "mk-toolbar" });
    const nameInput = el("input", { class: "text-input", placeholder: cfg.addPlaceholder, style: "max-width:" + cfg.addMaxWidth + ";" });
    const addBtn = el("button", { class: "btn btn-primary", text: "追加" });
    // create は masters:changed を発火し、下の bus ハンドラがビュー全体を再描画する（手動再描画は不要）。
    const add = () => { const n = nameInput.value.trim(); if (n) { cfg.api.create({ name: n }); nameInput.value = ""; } };
    addBtn.addEventListener("click", add);
    nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
    bar.appendChild(nameInput); bar.appendChild(addBtn);
    const expBtn = el("button", { class: "btn btn-secondary", text: "CSV出力" });
    expBtn.addEventListener("click", () => {
      MK.io.downloadText(cfg.csvBase + "-" + MK.util.todayISO().replace(/-/g, "") + ".csv", MK.io.csv.stringify(cfg.api.buildCSVRows()), "text/csv");
      MK.ui.toast(cfg.exportToast, "success");
    });
    const impBtn = el("button", { class: "btn btn-secondary", text: "CSV取込" });
    // applyCSV は masters:changed を発火し、下の bus ハンドラがビュー全体を再描画する。
    impBtn.addEventListener("click", () => MK.io.pickCsvFile((rows) => {
      const n = cfg.api.applyCSV(rows);
      if (cfg.onImport) cfg.onImport();
      MK.ui.toast(cfg.importToast(n), "success");
    }));
    bar.appendChild(expBtn); bar.appendChild(impBtn);
    container.appendChild(bar);
    if (cfg.beforeList) cfg.beforeList(container);
    const host = el("div", { class: "card", style: "padding:0;overflow:hidden;" });
    container.appendChild(host);
    renderMasterList(host, cfg);
  }
  function renderMasterList(host, cfg) {
    host.innerHTML = "";
    const items = cfg.list ? cfg.list() : cfg.api.all();
    if (!items.length) { host.appendChild(el("div", { class: "mk-empty", text: cfg.emptyText })); return; }
    const ul = el("ul", { class: "mk-list" });
    items.forEach((item) => {
      const info = cfg.renderInfo(item);
      const edit = el("button", { class: "btn btn-ghost", text: "編集" });
      edit.addEventListener("click", () => cfg.openEdit(item));
      const del = el("button", { class: "btn btn-ghost", text: "削除" });
      // 削除も masters:changed 経由で再描画される（手動再描画は不要）。
      del.addEventListener("click", () => MK.ui.confirm(cfg.confirmText(item)).then((ok) => { if (ok) cfg.api.remove(item.id); }));
      ul.appendChild(el("li", { class: "mk-row" }, [info, edit, del]));
    });
    host.appendChild(ul);
  }
  // マスタ編集モーダルの共通骨格。fields=[{ label, build(f) }]（build は control を返しつつ f に参照を格納）、
  // onSave(f, close) が保存処理、extraActions(f) は「削除」等の先頭アクション（省略可）。
  function masterEditModal(spec) {
    const f = {};
    const body = el("div", {}, spec.fields.map((fd) => fld(fd.label, fd.build(f))));
    const actions = (spec.extraActions ? spec.extraActions(f) : []).concat([
      { label: "キャンセル", variant: "btn-secondary", onClick: (c) => c() },
      { label: "保存", variant: "btn-primary", onClick: (c) => spec.onSave(f, c) },
    ]);
    MK.ui.modal({ title: spec.title, body, actions });
  }

  // ---- 人の管理 ----
  function renderPeople(container) {
    renderMaster(container, {
      api: MK.people,
      addPlaceholder: "氏名を入力して追加",
      addMaxWidth: "260px",
      csvBase: "people",
      exportToast: "人マスタCSVを書き出しました",
      importToast: (n) => n + " 件のメンバーを取り込みました",
      emptyText: "メンバーがいません",
      confirmText: (m) => m.name + " を削除しますか？",
      openEdit: (m) => editMember(m),
      renderInfo: (m) => {
        // 氏名クリックで関連情報の集約ビュー（詳細）へ（Issue #83）。
        const nameLink = el("button", { class: "mk-linklike", text: m.name });
        nameLink.addEventListener("click", () => { peopleDetailId = m.id; route("master-people"); });
        return el("div", { class: "grow" }, [
          nameLink,
          el("div", { class: "sub", text: [m.role, m.note].filter(Boolean).join(" / ") }),
        ]);
      },
    });
  }
  // 一覧・詳細の両方から使う。保存後は masters:changed でビューが再描画されるため専用の再描画は不要（Issue #138）。
  function editMember(m) {
    masterEditModal({
      title: "メンバーを編集",
      fields: [
        { label: "氏名", build: (f) => (f.name = inp(m.name)) },
        { label: "役割", build: (f) => (f.role = inp(m.role)) },
        { label: "表示色", build: (f) => (f.color = inp(m.color, "color")) },
        { label: "備考", build: (f) => (f.note = inp(m.note)) },
      ],
      onSave: (f, c) => {
        if (!f.name.value.trim()) { MK.ui.toast("氏名を入力してください", "error"); return; }
        MK.people.update(m.id, { name: f.name.value.trim(), role: f.role.value, color: f.color.value, note: f.note.value });
        c();
      },
    });
  }

  // ---- プロジェクト管理 ----
  const PROJECT_STATUSES = MK.projects.STATUSES;
  function projectStatusLabel(key) {
    return MK.projects.statusLabel(key);
  }
  function renderProjects(container) {
    renderMaster(container, {
      api: MK.projects,
      addPlaceholder: "プロジェクト名を入力して追加",
      addMaxWidth: "300px",
      csvBase: "projects",
      exportToast: "プロジェクトCSVを書き出しました",
      importToast: (n) => n + " 件のプロジェクトを取り込みました",
      emptyText: "プロジェクトがありません",
      confirmText: (p) => p.name + " を削除しますか？",
      openEdit: (p) => editProject(p),
      renderInfo: (p) => el("div", { class: "grow" }, [
        el("div", { text: p.name }),
        el("div", { class: "sub", text: projectStatusLabel(p.status) }),
      ]),
    });
  }
  function editProject(p) {
    masterEditModal({
      title: "プロジェクトを編集",
      fields: [
        { label: "プロジェクト名", build: (f) => (f.name = inp(p.name)) },
        { label: "ステータス", build: (f) => (f.status = MK.ui.select(PROJECT_STATUSES.map((s) => ({ value: s.key, label: s.label })), p.status)) },
        { label: "表示色", build: (f) => (f.color = inp(p.color, "color")) },
        { label: "備考", build: (f) => (f.note = inp(p.note)) },
      ],
      onSave: (f, c) => {
        if (!f.name.value.trim()) { MK.ui.toast("プロジェクト名を入力してください", "error"); return; }
        MK.projects.update(p.id, { name: f.name.value.trim(), status: f.status.value, color: f.color.value, note: f.note.value });
        c();
      },
    });
  }

  // ---- プロダクト管理（Product マスタ・§6.4）----
  // ステータス絞り込みの選択状態。マスタビュー再描画（masters:changed）をまたいで保持する。
  let productFilter = "all";
  function renderProductsView() {
    main.appendChild(el("h2", { class: "mk-section-title", text: "📦 プロダクト（マスタ）" }));
    const body = el("div", {});
    main.appendChild(body);
    renderProducts(body);
  }
  function renderProducts(container) {
    renderMaster(container, {
      api: MK.products,
      addPlaceholder: "プロダクト名を入力して追加",
      addMaxWidth: "300px",
      csvBase: "products",
      exportToast: "プロダクトCSVを書き出しました",
      importToast: (n) => n + " 件のプロダクトを取り込みました",
      onImport: () => { productFilter = "all"; },
      emptyText: "プロダクトがありません",
      // ステータス絞り込み後の一覧（productFilter はビュー再描画をまたいで保持。§6.4）。
      list: () => {
        let list = MK.products.all();
        if (productFilter !== "all") list = list.filter((p) => p.status === productFilter);
        return list;
      },
      confirmText: (p) => p.name + " を削除しますか？",
      openEdit: (p) => editProduct(p),
      // ステータス絞り込みタブ（件数バッジ）を一覧の前に差し込む。
      beforeList: (container) => {
        const c = MK.products.counts();
        const tabs = el("div", { class: "mk-toolbar" });
        tabs.appendChild(productPill("全て", "all", c.all));
        MK.products.STATUSES.forEach((s) => tabs.appendChild(productPill(s.label, s.key, c[s.key])));
        container.appendChild(tabs);
      },
      renderInfo: (p) => {
        const meta = [el("span", { class: "chip", text: productStatusLabel(p.status) })];
        const owner = MK.products.ownerPerson(p);
        if (owner) meta.push(el("span", { class: "chip" }, [
          el("span", { style: "display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;background:" + (owner.color || "var(--color-steel)") + ";" }),
          "責任者: " + owner.name,
        ]));
        if (p.repo) meta.push(el("span", { class: "sub", text: p.repo }));
        (p.tags || []).forEach((t) => meta.push(el("span", { class: "chip", text: "#" + t })));
        MK.products.relatedProjects(p).forEach((proj) => meta.push(el("span", { class: "chip", text: "📁 " + proj.name })));
        if (p.summary) meta.push(el("span", { class: "sub", text: p.summary }));
        return el("div", { class: "grow" }, [el("div", { text: p.name }), el("div", { class: "sub" }, meta)]);
      },
    });
  }
  function productPill(label, key, count) {
    const b = el("button", { class: "pill-tab" + (productFilter === key ? " active" : "") }, [
      label + " ", el("span", { class: "badge badge-count", text: String(count || 0) }),
    ]);
    b.addEventListener("click", () => { productFilter = key; main.innerHTML = ""; renderProductsView(); });
    return b;
  }
  function productStatusLabel(key) {
    const s = MK.products.STATUSES.find((x) => x.key === key);
    return s ? s.label : key;
  }
  // プロジェクトのチェックボックス一覧を作る（Product⇄Project の緩い紐付け・Issue #55）。
  function projectCheckboxList(selectedIds) {
    const list = MK.projects.all();
    if (!list.length) return el("div", { class: "sub", text: "プロジェクトがありません" });
    const wrap = el("div", { class: "mk-stack", style: "max-height:160px;overflow:auto;" });
    const boxes = list.map((proj) => {
      const cb = MK.ui.checkbox((selectedIds || []).indexOf(proj.id) >= 0);
      cb.dataset.projectId = proj.id;
      wrap.appendChild(el("label", { style: "display:flex;gap:8px;align-items:center;cursor:pointer;" }, [cb, el("span", { text: proj.name })]));
      return cb;
    });
    wrap.getSelected = () => boxes.filter((b) => b.checked).map((b) => b.dataset.projectId);
    return wrap;
  }
  function editProduct(p) {
    const ownerOptions = [{ value: "", label: "未設定" }].concat(MK.people.all().map((m) => ({ value: m.id, label: m.name })));
    masterEditModal({
      title: "プロダクトを編集",
      fields: [
        { label: "プロダクト名", build: (f) => (f.name = inp(p.name)) },
        { label: "ステータス", build: (f) => (f.status = MK.ui.select(MK.products.STATUSES.map((s) => ({ value: s.key, label: s.label })), p.status)) },
        { label: "責任者", build: (f) => (f.owner = MK.ui.select(ownerOptions, p.ownerId || "")) },
        { label: "概要（提供価値）", build: (f) => (f.summary = inp(p.summary)) },
        { label: "リポジトリ / リンク", build: (f) => (f.repo = inp(p.repo)) },
        { label: "タグ（カンマ区切り）", build: (f) => (f.tags = inp((p.tags || []).join(", "))) },
        { label: "関連プロジェクト", build: (f) => (f.projects = projectCheckboxList(p.projectIds)) },
      ],
      // 削除アクションは保存/キャンセルの前に置く（従来の並び）。
      extraActions: () => [
        { label: "削除", variant: "btn-danger", onClick: (close) => MK.ui.confirm("このプロダクトを削除しますか？").then((ok) => { if (ok) { MK.products.remove(p.id); close(); } }) },
      ],
      onSave: (f, c) => {
        if (!f.name.value.trim()) { MK.ui.toast("プロダクト名を入力してください", "error"); return; }
        MK.products.update(p.id, {
          name: f.name.value.trim(), status: f.status.value, ownerId: f.owner.value || null,
          summary: f.summary.value, repo: f.repo.value.trim(),
          tags: f.tags.value.split(",").map((s) => s.trim()).filter(Boolean),
          projectIds: f.projects.getSelected ? f.projects.getSelected() : [],
        });
        c();
      },
    });
  }
  // CSV ファイル選択の共通ヘルパは MK.io.pickCsvFile（shared/io.js §4.6.2）へ集約した。

  // ---- 設定 ----
  function renderSettings() {
    main.appendChild(el("h2", { class: "mk-section-title", text: "設定" }));
    const card = el("div", { class: "card" });
    card.appendChild(el("h3", { text: "データ" }));
    card.appendChild(el("p", { class: "sub", text: "全データ（人・プロジェクト・各モジュール）を JSON で書き出し／取り込みできます。" }));
    const exp = el("button", { class: "btn btn-primary", text: "全体バックアップ（JSON）" });
    exp.addEventListener("click", exportAll);
    const imp = el("button", { class: "btn btn-secondary", text: "JSON を取り込む" });
    imp.addEventListener("click", importAll);
    card.appendChild(el("div", { class: "mk-toolbar" }, [exp, imp]));

    // サンプルデータ
    card.appendChild(el("h3", { text: "サンプルデータ" }));
    card.appendChild(el("p", { class: "sub", text: "動作確認用に、人・プロジェクト・各モジュールへサンプルを投入します（既存データは置き換わります）。" }));
    const sample = el("button", { class: "btn btn-secondary", text: "サンプルデータを読み込む" });
    sample.addEventListener("click", () => {
      MK.ui.confirm("既存データをサンプルで置き換えます。よろしいですか？").then((ok) => {
        if (!ok) return;
        MK.sample.load();
        MK.ui.toast("サンプルデータを読み込みました", "success");
        route(current);
      });
    });
    card.appendChild(sample);

    // 起動画面（spec §3.6）
    card.appendChild(el("h3", { text: "起動画面" }));
    card.appendChild(el("p", { class: "sub", text: "オンにすると起動時に前回開いていたモジュールを表示します（オフのときは HOME）。" }));
    const startCb = el("input", { type: "checkbox" });
    startCb.checked = getSettings().startView === "last";
    startCb.addEventListener("change", () => setSettings({ startView: startCb.checked ? "last" : "home" }));
    const startLabel = el("label", { class: "mk-toolbar", style: "gap:8px;cursor:pointer;" }, [startCb, el("span", { text: "起動時に前回のモジュールを開く" })]);
    card.appendChild(startLabel);

    // 旧ツール移行（検出されたら表示。spec §7.5）
    const legacy = Object.keys(LEGACY_KEYS).filter((k) => localStorage.getItem(k) != null);
    if (legacy.length) {
      card.appendChild(el("h3", { text: "旧ツールから移行" }));
      card.appendChild(el("p", { class: "sub", text: "検出: " + legacy.join(", ") }));
      const mig = el("button", { class: "btn btn-secondary", text: "旧データを取り込む" });
      mig.addEventListener("click", () => migrateLegacy(legacy));
      card.appendChild(mig);
    }
    main.appendChild(card);
    main.appendChild(renderStorageUsage());
    main.appendChild(renderModuleVisibility());

    if (MK.store.errors.length) {
      const warn = el("div", { class: "card", style: "margin-top:16px;border-color:var(--color-error);" });
      warn.appendChild(el("h3", { text: "⚠ 破損データ" }));
      MK.store.errors.forEach((e) => warn.appendChild(el("div", { class: "sub", text: e.key + ": " + e.message })));
      main.appendChild(warn);
    }
  }

  // ストレージ使用量の可視化（Issue #76 / §10.1）。閾値超過で警告表示し、
  // バックアップ導線（全体 JSON）を案内する。
  function renderStorageUsage() {
    const u = MK.store.usage();
    const pct = Math.round(u.ratio * 100);
    const warn = u.ratio >= USAGE_WARN_RATIO;
    const card = el("div", { class: "card", style: "margin-top:16px;" + (warn ? "border-color:var(--color-error);" : "") });
    card.appendChild(el("h3", { text: "ストレージ使用量" }));
    card.appendChild(el("p", { class: "sub", text: "ブラウザの保存領域（localStorage・約 5MB）の使用量です。上限に近づいたら不要データの整理と JSON バックアップを検討してください。" }));
    card.appendChild(el("div", { style: "font-weight:600;", text: formatBytes(u.bytes) + " / 約 " + formatBytes(u.quota) + "（" + pct + "%・" + u.count + " キー）" }));
    // 使用量バー
    const track = el("div", { style: "margin-top:8px;height:8px;border-radius:4px;background:var(--color-hairline);overflow:hidden;" });
    const fill = el("div", { style: "height:100%;width:" + Math.min(100, pct) + "%;background:" + (warn ? "var(--color-error)" : "var(--color-primary)") + ";" });
    track.appendChild(fill);
    card.appendChild(track);
    if (warn) {
      card.appendChild(el("p", { class: "sub", style: "margin-top:8px;color:var(--color-error);", text: "⚠ 使用量が上限の " + Math.round(USAGE_WARN_RATIO * 100) + "% を超えています。全体バックアップ（JSON）を取得し、不要なデータを整理してください。" }));
    }
    return card;
  }

  // モジュールの表示・非表示トグル（ゾーンでグルーピング。Issue #35）。
  // 変更は即ナビ・HOME へ反映する。非表示にしてもデータ・マスタ連携は保持される。
  function renderModuleVisibility() {
    const card = el("div", { class: "card", style: "margin-top:16px;" });
    card.appendChild(el("h3", { text: "モジュールの表示" }));
    card.appendChild(el("p", { class: "sub", text: "ナビと HOME に表示するモジュールを選びます。非表示にしてもデータは保持されます。" }));
    ZONES.forEach((zone) => {
      const mods = (zone.modules || []).filter((id) => META[id]);
      if (!mods.length) return;
      card.appendChild(el("h4", { class: "mk-home-zone", text: zone.label }));
      const list = el("div", { class: "mk-stack" });
      mods.forEach((id) => {
        const m = META[id];
        const cb = MK.ui.checkbox(!isHiddenModule(id));
        cb.addEventListener("change", () => { setModuleHidden(id, !cb.checked); renderNav(); });
        const label = (m.icon ? m.icon + " " : "") + m.title + (MK.modules[id] ? "" : "・準備中");
        list.appendChild(el("label", { style: "display:flex;gap:8px;align-items:center;cursor:pointer;" }, [cb, el("span", { text: label })]));
      });
      card.appendChild(list);
    });
    return card;
  }

  function exportAll() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    const fname = "management-kun-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + ".json";
    MK.io.download(fname, MK.io.buildEnvelope("all"));
    MK.ui.toast("バックアップを書き出しました", "success");
  }

  function importAll() {
    const file = el("input", { type: "file", accept: ".json,application/json" });
    file.addEventListener("change", () => {
      const f = file.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        let env;
        try { env = JSON.parse(reader.result); } catch (e) { MK.ui.toast("JSON の読み込みに失敗しました", "error"); return; }
        MK.ui.modal({
          title: "取り込み方法",
          body: el("p", { text: "既存データへの取り込み方法を選んでください。" }),
          actions: [
            { label: "キャンセル", variant: "btn-secondary", onClick: (c) => c() },
            { label: "マージ", variant: "btn-secondary", onClick: (c) => { doImport(env, "merge"); c(); } },
            { label: "置換", variant: "btn-primary", onClick: (c) => { doImport(env, "replace"); c(); } },
          ],
        });
      };
      reader.readAsText(f);
    });
    file.click();
  }
  function doImport(env, mode) {
    try {
      MK.io.importEnvelope(env, mode);
      MK.ui.toast("取り込みました（" + mode + "）", "success");
      route(current);
    } catch (e) {
      MK.ui.toast(String(e.message || e), "error");
    }
  }

  // 旧データ移行（MVP: 実装済みモジュールのみ。名寄せは自動作成・spec §7.5/§8.4）
  function migrateLegacy(keys) {
    let done = 0;
    keys.forEach((k) => {
      const moduleId = LEGACY_KEYS[k];
      if (!MK.modules[moduleId]) return; // 未実装／未搭載モジュールは対象外
      let raw;
      try { raw = JSON.parse(localStorage.getItem(k)); } catch (e) { return; }
      if (moduleId === "todo") {
        const tasks = (raw && raw.tasks ? raw.tasks : []).map((t) => ({
          id: t.id || MK.util.uid("t"),
          title: t.title || "",
          notes: t.notes || "",
          status: t.status || "inbox",
          contexts: Array.isArray(t.contexts) ? t.contexts : [],
          projectId: t.project ? MK.projects.resolveOrCreate(t.project) : (t.projectId || null),
          due: t.due || null,
          createdAt: t.createdAt || MK.util.nowISO(),
          updatedAt: t.updatedAt || MK.util.nowISO(),
          completedAt: t.completedAt || null,
        }));
        MK.modules.todo.importData({ version: 1, tasks }, "merge");
        done++;
      } else if (moduleId === "wbs") {
        const tasks = (raw && raw.tasks ? raw.tasks : []).map((t) => ({
          id: t.id,
          level: t.level || 0,
          name: t.name || "",
          assigneeId: t.assignee ? MK.people.resolveOrCreate(t.assignee) : (t.assigneeId || null),
          start: t.start || "",
          end: t.end || "",
          progress: Number(t.progress) || 0,
          status: t.status || "notstarted",
          note: t.note || "",
          deps: Array.isArray(t.deps) ? t.deps : [],
          collapsed: !!t.collapsed,
        }));
        // wbs は scoped（§3.7.4）。旧ツールのデータは PJ に紐付かないので既定 PJ（先頭・無ければ作成）へ寄せる。
        const dim = MK.scope.dimOf(MK.modules.wbs.scope);
        const targetId = dim ? MK.scope.ensureDefaultTarget(dim) : null;
        MK.modules.wbs.importData({ version: 1, uid: raw.uid || 1, tasks }, "replace", targetId);
        done++;
      } else if (moduleId === "skills") {
        // メンバー→People、スキル→新ID、評価キーを新IDへ付け替え
        const memMap = {};
        (raw.members || []).forEach((m) => { memMap[m.id] = MK.people.resolveOrCreate(m.name); });
        const skillMap = {};
        const skills = (raw.skills || []).map((s) => {
          const nid = MK.util.uid("sk");
          skillMap[s.id] = nid;
          return { id: nid, domain: s.domain || "", item: s.item || "", description: s.description || "", visible: s.visible !== false, core: !!s.core, targetLevel: s.targetLevel != null ? s.targetLevel : null, requiredCount: s.requiredCount != null ? s.requiredCount : null };
        });
        const ratings = {};
        Object.keys(raw.ratings || {}).forEach((k) => {
          const parts = k.split(":");
          const nm = memMap[parts[0]], ns = skillMap[parts[1]];
          if (nm && ns) ratings[nm + ":" + ns] = raw.ratings[k];
        });
        MK.modules.skills.importData({ version: 1, skills, ratings }, "replace");
        done++;
      } else if (moduleId === "workload") {
        const memMap = {}, memberSettings = {};
        (raw.members || []).forEach((m) => {
          const nid = MK.people.resolveOrCreate(m.name);
          memMap[m.id] = nid;
          if (m.color) { const ex = MK.people.get(nid); if (ex && !ex.color) MK.people.update(nid, { color: m.color }); }
          memberSettings[nid] = { high: m.capacityWarnHigh != null ? m.capacityWarnHigh : 80, low: m.capacityWarnLow != null ? m.capacityWarnLow : 60 };
        });
        const remap = (list) => (list || []).map((t) => Object.assign({}, t, { id: t.id || MK.util.uid("wt"), memberId: memMap[t.memberId] || null }));
        const baseline = raw.baseline ? { savedAt: raw.baseline.savedAt || MK.util.todayISO(), tasks: remap(raw.baseline.tasks) } : null;
        MK.modules.workload.importData({ version: 1, tasks: remap(raw.tasks), baseline, memberSettings }, "replace");
        done++;
      }
    });
    setSettings({ migration: { fromLegacyDone: true } });
    MK.ui.toast(done ? (done + " 件のツールを取り込みました") : "取り込める実装済みモジュールがありませんでした", done ? "success" : "info");
    route(current);
  }

  // scoped 化前の単一キー（mk:module:<id>:v1）を対象別キーへ移行する（§3.7.4 / §7 / Issue #25）。
  // 起動時に一度走ればよい（migrateLegacyScoped が旧キーを消すため冪等）。旧データが無ければ
  // 何もしない＝新規ユーザーへ余計な既定 PJ を作らない。
  function migrateScopedData() {
    MK.scope.dims().forEach((dim) => {
      Object.keys(MK.modules).forEach((id) => {
        const d = MK.scope.dimOf(MK.modules[id].scope);
        if (!d || d.dim !== dim.dim) return;                                  // この次元の scoped モジュールのみ
        if (localStorage.getItem(MK.store.keyOf("module:" + id)) == null) return; // 旧キーなし＝移行不要
        const targetId = MK.scope.ensureDefaultTarget(dim);                   // 既定 PJ へ寄せる
        if (targetId) MK.scope.migrateLegacyScoped(id, targetId);
      });
    });
  }

  // ---- フォーム小物 ----
  function fld(label, control) { return el("div", { class: "field" }, [el("label", { text: label }), control]); }
  function inp(value, type) { return el("input", { class: "text-input", type: type || "text", value: value || "" }); }

  // マスタ変更時、マスタ管理画面表示中なら再描画。scoped モジュール表示中は
  // スイッチャ/現在対象がマスタに連動するため再マウントする（対象の増減・削除に追随。§3.7.2/3）。
  MK.bus.on("masters:changed", () => {
    if (current === "master-people") { main.innerHTML = ""; renderPeopleView(); }
    else if (current === "master-projects") { main.innerHTML = ""; renderProjectsView(); }
    else if (current === "master-products") { main.innerHTML = ""; renderProductsView(); }
    else if (MK.modules[current] && MK.scope.dimOf(MK.modules[current].scope)) { route(current); }
  });

  // ---- 起動 ----
  document.getElementById("btn-export").addEventListener("click", exportAll);
  document.getElementById("btn-import").addEventListener("click", importAll);
  document.getElementById("btn-theme").addEventListener("click", toggleTheme);
  const menuBtn = document.getElementById("btn-menu");
  if (menuBtn) menuBtn.addEventListener("click", toggleSidebar);
  // グローバル検索（Ctrl+K / Cmd+K）。どの画面からでも開ける（Issue #82 / spec §10.2）。
  // capture 段階で拾い、入力欄にフォーカスがあってもブラウザ既定を上書きして起動する。
  const searchBtn = document.getElementById("btn-search");
  if (searchBtn) searchBtn.addEventListener("click", openPalette);
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); togglePalette(); }
  }, true);
  const overlay = document.getElementById("mk-sidebar-overlay");
  if (overlay) overlay.addEventListener("click", closeSidebar);
  // 書込失敗（特に容量超過）を握りつぶさず案内する（Issue #76 / §10.1）。容量超過時は
  // 全体 JSON バックアップへの導線を提示する。失敗しても _cache には新値が残るため、
  // ここから書き出せば直近の変更ごと退避できる。
  MK.store.onWriteError = function (info) {
    if (info && info.quota) {
      MK.ui.modal({
        title: "保存領域が上限に達しました",
        body: el("div", {}, [
          el("p", { text: "データを保存できませんでした（ブラウザ保存領域の容量超過）。直近の変更はこの画面には反映されていますが、まだ保存されていません。" }),
          el("p", { text: "全体バックアップ（JSON）を書き出して退避したうえで、不要なデータを整理してください。" }),
        ]),
        actions: [
          { label: "閉じる", variant: "btn-secondary", onClick: (c) => c() },
          { label: "全体バックアップ（JSON）", variant: "btn-primary", onClick: (c) => { exportAll(); c(); } },
        ],
      });
    } else {
      MK.ui.toast("保存に失敗しました: " + (info ? info.ns : ""), "error");
    }
  };
  MK.store.load();
  migrateScopedData(); // scoped 化前の単一キーを対象別へ移す（§3.7.4）。route より前に実行する。
  if (MK.allocations) MK.allocations.migrateFromWorkload(); // 旧 workload 内部のアロケーションを共有マスタへ昇格（Issue #45）。
  if (MK.products) MK.products.migrateOwnerToPeople(); // 旧・自由文字列 owner を People マスタへ名寄せ移行（Issue #56）。
  applyTheme(getTheme());
  // 起動先: 既定は HOME。設定 startView === "last" のときだけ前回モジュールを復元する（spec §3.6）。
  const start0 = getSettings();
  const startView = start0.startView === "last" && start0.lastModule
    && ALLOWED[start0.lastModule] && !isHiddenModule(start0.lastModule)
    ? start0.lastModule : "home";
  route(startView);

  const legacyFound = Object.keys(LEGACY_KEYS).some((k) => localStorage.getItem(k) != null);
  if (legacyFound && !getSettings().migration.fromLegacyDone) {
    MK.ui.toast("旧ツールのデータが見つかりました。「設定」から移行できます。", "info");
  }
})();
