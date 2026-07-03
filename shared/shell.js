/* シェル（ブートストラップ・ルーター）— classic script・window.MK 名前空間。
   「どのゾーン/どのモジュールを積むか」はエントリHTML側の window.MK_CONFIG から受け取る
   （配布プロファイル。spec §1.5）。シェル本体はプロファイルに依存しない。 */
(function () {
  "use strict";
  const MK = window.MK;
  const el = (t, a, c) => MK.util.el(t, a, c);

  // モジュールのメタ（未実装は「準備中」表示）spec §5。全モジュールの表示情報を持つ
  // カタログ。エントリが積まないモジュールの分は単に参照されないだけで無害。
  const META = {
    todo: { title: "ToDo", icon: "✅" },
    goals: { title: "目標", icon: "🎯" },
    skills: { title: "スキル", icon: "📊" },
    workload: { title: "負荷", icon: "📈" },
    staffing: { title: "要員計画", icon: "🧑‍🤝‍🧑" },
    wbs: { title: "WBS", icon: "🗂" },
  };
  // ゾーン構成は配布プロファイル（window.MK_CONFIG.zones）から受け取る。未指定なら
  // マネージャ用の全部入りにフォールバックする（spec §1.4 / §1.5 / §6.4）。
  // 分類は EM が見る領域で切る（自分＋4領域）。プロダクト/テクノロジーは現状モジュール
  // が無いため config には載せない（空グループを出さない。spec §1.4）。
  const DEFAULT_ZONES = [
    { label: "自分", modules: ["todo", "goals"] },
    { label: "ピープル", modules: ["skills", "workload", "staffing"] },
    { label: "デリバリー", modules: ["wbs"] },
  ];
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
      people: MK.people,
      projects: MK.projects,
      allocations: MK.allocations,
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
    // 配布プロファイルに載っていないビュー（例: 自分配布での master-people / master-projects）は先頭ゾーンへ退避
    if (!ALLOWED[view]) view = firstView();
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
    } else if (view === "settings") {
      renderSettings();
    } else {
      // 未実装モジュール
      const meta = META[view];
      main.appendChild(el("h2", { class: "mk-section-title", text: (meta ? meta.title : view) + "（準備中）" }));
      main.appendChild(el("p", { class: "mk-empty", text: "このモジュールは今後のリリースで実装予定です（spec §9）。" }));
    }
  }

  // 先頭ゾーンの最初のモジュール（起動・退避先のデフォルト）
  function firstView() {
    for (let i = 0; i < ZONES.length; i++) {
      const mods = ZONES[i].modules || [];
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

  // ---- HOME（玄関ダッシュボード。spec §3.6）----
  // ZONES を入力にゾーン別セクション＋モジュールのサマリーカードを描画する。配布プロファイル
  // （member.html）ではピープル/デリバリーゾーンが ZONES に無いため、自動的に「自分」だけになる。
  function renderHome() {
    main.appendChild(el("h2", { class: "mk-section-title", text: "🏠 HOME" }));
    ZONES.forEach((zone) => {
      // カタログ（META）未知の id だけ除外する。実装済み／未実装（＝準備中カード）はどちらも出す。
      const mods = (zone.modules || []).filter((id) => META[id]);
      if (!mods.length) return;
      main.appendChild(el("h3", { class: "mk-home-zone", text: zone.label }));
      const grid = el("div", { class: "mk-home-grid" });
      mods.forEach((id) => grid.appendChild(homeCard(id)));
      main.appendChild(grid);
    });
  }

  function homeCard(id) {
    const meta = META[id];
    const mod = MK.modules[id];
    const card = el("div", { class: "card mk-home-card", role: "button", tabindex: "0" });
    card.appendChild(el("div", { class: "mk-home-card-head" }, [
      el("span", { class: "mk-home-icon", text: meta.icon || "" }),
      el("span", { class: "mk-home-title", text: meta.title }),
    ]));
    if (!mod) {
      card.appendChild(el("div", { class: "sub", text: "準備中" }));
    } else {
      let sum = null;
      // summary は任意契約。例外・未実装でも HOME 全体を壊さない（カードは「開く」表示）。
      try { if (typeof mod.summary === "function") sum = mod.summary(); }
      catch (e) { sum = null; console.warn("summary() failed:", id, e); } // 追跡用に記録（HOME は壊さない）
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
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    return card;
  }

  function navItem(label, view) {
    const b = el("button", { class: "mk-nav-item" + (current === view ? " active" : ""), text: label });
    b.addEventListener("click", () => { route(view); closeSidebar(); });
    return b;
  }

  // ---- ナビの折りたたみ状態（ゾーン単位。設定 mk:settings.nav に { <label>: true=畳む } で保持）----
  function getNav() { return getSettings().nav || {}; }
  function toggleNavZone(label) { const n = Object.assign({}, getNav()); n[label] = !n[label]; setSettings({ nav: n }); }

  // サイドバー（ゾーン見出し＋配下モジュールの縦積み。折りたたみ可。Issue #34）。
  // 現在ビューを含むゾーンは畳んでいても展開して表示し、アクティブ項目を必ず見せる。
  function renderNav() {
    nav.innerHTML = "";
    nav.appendChild(navItem("🏠 HOME", "home"));
    ZONES.forEach((zone) => {
      const items = [];
      (zone.modules || []).forEach((id) => {
        const m = META[id];
        if (!m) return; // カタログ未知のモジュールは無視
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
  function renderPeopleView() {
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

  // ---- 人の管理 ----
  function renderPeople(container) {
    const bar = el("div", { class: "mk-toolbar" });
    const nameInput = el("input", { class: "text-input", placeholder: "氏名を入力して追加", style: "max-width:260px;" });
    const addBtn = el("button", { class: "btn btn-primary", text: "追加" });
    const add = () => { const n = nameInput.value.trim(); if (n) { MK.people.create({ name: n }); nameInput.value = ""; renderPeopleList(host); } };
    addBtn.addEventListener("click", add);
    nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
    bar.appendChild(nameInput); bar.appendChild(addBtn);
    container.appendChild(bar);
    const host = el("div", { class: "card", style: "padding:0;overflow:hidden;" });
    container.appendChild(host);
    renderPeopleList(host);
  }
  function renderPeopleList(host) {
    host.innerHTML = "";
    const members = MK.people.all();
    if (!members.length) { host.appendChild(el("div", { class: "mk-empty", text: "メンバーがいません" })); return; }
    const ul = el("ul", { class: "mk-list" });
    members.forEach((m) => {
      const info = el("div", { class: "grow" }, [
        el("div", { text: m.name }),
        el("div", { class: "sub", text: [m.role, m.note].filter(Boolean).join(" / ") }),
      ]);
      const edit = el("button", { class: "btn btn-ghost", text: "編集" });
      edit.addEventListener("click", () => editMember(m, host));
      const del = el("button", { class: "btn btn-ghost", text: "削除" });
      del.addEventListener("click", () => MK.ui.confirm(m.name + " を削除しますか？").then((ok) => { if (ok) { MK.people.remove(m.id); renderPeopleList(host); } }));
      ul.appendChild(el("li", { class: "mk-row" }, [info, edit, del]));
    });
    host.appendChild(ul);
  }
  function editMember(m, host) {
    const f = {};
    const body = el("div", {}, [
      fld("氏名", (f.name = inp(m.name))),
      fld("役割", (f.role = inp(m.role))),
      fld("表示色", (f.color = inp(m.color, "color"))),
      fld("備考", (f.note = inp(m.note))),
    ]);
    MK.ui.modal({ title: "メンバーを編集", body, actions: [
      { label: "キャンセル", variant: "btn-secondary", onClick: (c) => c() },
      { label: "保存", variant: "btn-primary", onClick: (c) => {
          if (!f.name.value.trim()) { MK.ui.toast("氏名を入力してください", "error"); return; }
          MK.people.update(m.id, { name: f.name.value.trim(), role: f.role.value, color: f.color.value, note: f.note.value });
          renderPeopleList(host); c();
        } },
    ] });
  }

  // ---- プロジェクト管理 ----
  function renderProjects(container) {
    const bar = el("div", { class: "mk-toolbar" });
    const nameInput = el("input", { class: "text-input", placeholder: "プロジェクト名を入力して追加", style: "max-width:300px;" });
    const addBtn = el("button", { class: "btn btn-primary", text: "追加" });
    const add = () => { const n = nameInput.value.trim(); if (n) { MK.projects.create({ name: n }); nameInput.value = ""; renderProjectList(host); } };
    addBtn.addEventListener("click", add);
    nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
    bar.appendChild(nameInput); bar.appendChild(addBtn);
    container.appendChild(bar);
    const host = el("div", { class: "card", style: "padding:0;overflow:hidden;" });
    container.appendChild(host);
    renderProjectList(host);
  }
  function renderProjectList(host) {
    host.innerHTML = "";
    const list = MK.projects.all();
    if (!list.length) { host.appendChild(el("div", { class: "mk-empty", text: "プロジェクトがありません" })); return; }
    const ul = el("ul", { class: "mk-list" });
    list.forEach((p) => {
      const info = el("div", { class: "grow" }, [
        el("div", { text: p.name }),
        el("div", { class: "sub", text: p.status === "archived" ? "アーカイブ" : "進行中" }),
      ]);
      const del = el("button", { class: "btn btn-ghost", text: "削除" });
      del.addEventListener("click", () => MK.ui.confirm(p.name + " を削除しますか？").then((ok) => { if (ok) { MK.projects.remove(p.id); renderProjectList(host); } }));
      ul.appendChild(el("li", { class: "mk-row" }, [info, del]));
    });
    host.appendChild(ul);
  }

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

    if (MK.store.errors.length) {
      const warn = el("div", { class: "card", style: "margin-top:16px;border-color:var(--color-error);" });
      warn.appendChild(el("h3", { text: "⚠ 破損データ" }));
      MK.store.errors.forEach((e) => warn.appendChild(el("div", { class: "sub", text: e.key + ": " + e.message })));
      main.appendChild(warn);
    }
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
    else if (MK.modules[current] && MK.scope.dimOf(MK.modules[current].scope)) { route(current); }
  });

  // ---- 起動 ----
  document.getElementById("btn-export").addEventListener("click", exportAll);
  document.getElementById("btn-import").addEventListener("click", importAll);
  document.getElementById("btn-theme").addEventListener("click", toggleTheme);
  const menuBtn = document.getElementById("btn-menu");
  if (menuBtn) menuBtn.addEventListener("click", toggleSidebar);
  const overlay = document.getElementById("mk-sidebar-overlay");
  if (overlay) overlay.addEventListener("click", closeSidebar);
  MK.store.load();
  migrateScopedData(); // scoped 化前の単一キーを対象別へ移す（§3.7.4）。route より前に実行する。
  if (MK.allocations) MK.allocations.migrateFromWorkload(); // 旧 workload 内部のアロケーションを共有マスタへ昇格（Issue #45）。
  applyTheme(getTheme());
  // 起動先: 既定は HOME。設定 startView === "last" のときだけ前回モジュールを復元する（spec §3.6）。
  const start0 = getSettings();
  const startView = start0.startView === "last" && start0.lastModule && ALLOWED[start0.lastModule]
    ? start0.lastModule : "home";
  route(startView);

  const legacyFound = Object.keys(LEGACY_KEYS).some((k) => localStorage.getItem(k) != null);
  if (legacyFound && !getSettings().migration.fromLegacyDone) {
    MK.ui.toast("旧ツールのデータが見つかりました。「設定」から移行できます。", "info");
  }
})();
