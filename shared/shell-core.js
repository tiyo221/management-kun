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
  // マスタは config が明示した分のみ出す。config を宣言するエントリ（配布サブセット・spec §1.5）で
  // masters を持たなければマスタグループは非表示＝到達不能になる。config が
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

  // ---- 現在のスコープ解決（次元・対象 id・store 名前空間）----
  // ctx・マウント・サンプル投入バーが同じ対象／同じ名前空間を見る必要があるため1か所に集約する
  // （別々に解決すると、片方を変えたときに黙ってズレる）。global モジュールでは dim/targetId が null。
  function scopeOf(id) {
    const def = MK.modules[id] || {};
    const dim = MK.scope.dimOf(def.scope);                 // scoped なら次元 config、global なら null
    const targetId = dim ? MK.scope.resolveTarget(dim, getScopeTarget(dim.dim)) : null;
    // scoped は対象別 namespace（mk:module:<id>:<targetId>:v1）へ、global は従来通り（§3.7.4）
    return { def, dim, targetId, ns: MK.scope.storeNsFor(id, def.scope, targetId) };
  }

  // ---- ctx（モジュールへ渡す契約。spec §3.5 / §3.7.3）----
  function ctxFor(id) {
    const { def, dim, targetId, ns } = scopeOf(id);
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
  // 同じビューを組み直す経路（masters:changed の再描画・マスタ画面内の絞り込み切替）の後始末。
  // ここでは**モーダルを畳まない**（Issue #265）── 一覧が作り直されるだけで画面は同じであり、
  // 畳むと編集モーダルの入力途中が消える（削除の undo を Ctrl+Z で戻すと masters:changed が飛ぶ）。
  // モーダルを畳むのはビュー切替＝route() だけ。
  function clearMain() {
    main.innerHTML = "";
  }

  // 各ビューの描画関数は別ファイル（home/masters/settings/nav）にあるため S 経由で遅延解決する。
  function route(view) {
    // 配布プロファイルに載っていないビュー（例: 自分配布での master-people / master-projects）と
    // 非表示モジュール（Issue #35）は先頭ゾーンの表示中モジュールへ退避
    if (!ALLOWED[view] || isHiddenModule(view)) view = firstView();
    // 開きっぱなしのモーダルを畳むのはここだけ（ビュー切替。Issue #265）。残すと overlay だけが
    // 画面に残り、背後は差し替わっているため操作が宙に浮く／破棄済みのノードへ書き込む。
    // unmount より先に呼ぶ（モジュールが持つ参照が生きているうちに閉じる）ため、この2行は
    // clearMain() にまとめず並びを保つ。
    MK.ui.closeAllModals();
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
      main.appendChild(el("p", { class: "mk-empty", text: "このモジュールはまだ実装されていません。" }));
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
    const t = scopeOf(view); // resolveTarget は読み取りのみ（副作用なし）
    const { def, dim, targetId } = t;
    if (!dim) { // global
      appendSampleBar(view);
      S.mountedModule = def;
      // mount 中の自動投入・正規化まで含めて「投入直後の姿」を確定させる。mount が投げても必ず
      // 確定させる（finally）。未確定の退避は liveSnapshot が検証せず有効と見なすため、飛ばすと
      // 片付けボタンがセッション中ずっと無条件で効く状態になり、以後に入れたデータを消す。
      try { def.mount(main, ctxFor(view)); } finally { sealSampleSnapshot(t); }
      return;
    }

    // scoped: 縮退モード（0=作成導線 / 1=畳む / 2+=スイッチャ）で分岐する（§3.7.2）
    const entities = MK.scope.entities(dim);
    const mode = MK.scope.mode(entities.length);
    if (mode === "empty") { renderScopeEmpty(dim); return; }
    setScopeTarget(dim.dim, targetId); // 正規化した現在対象を保存（削除で無効化された id を先頭へ寄せる等）
    main.appendChild(renderScopeBar(view, dim, entities, targetId, mode));
    appendSampleBar(view); // スコープバーの下・モジュール本体の上（対象を切り替えてから投入先を判断できる並び）
    const host = el("div");
    main.appendChild(host);
    S.mountedModule = def;
    try { def.mount(host, ctxFor(view)); } finally { sealSampleSnapshot(t); }
  }

  // ---- サンプル投入バー（Issue #256 / spec §3.6.2）----
  // 空のモジュールを「入れて試す → 要らなければ片付ける」でその場で判断できるようにする。投入の
  // 可否判定は DOM 非依存の述語 MK.canOfferSample（core.js）に委ね、ここは描画と退避の管理だけを持つ。
  // 退避はセッション内のメモリのみで localStorage に持たない。リロードで破棄されてバーは通常状態へ
  // 戻る（リロードをまたいで残す＝そのまま使うと判断した、とみなす。永続化は要求が出るまで作らない）。
  // 退避キーは ctx と同じ store 名前空間（scopeOf）にし、scoped モジュールを対象ごとに独立して扱う。
  // 値は { before: 投入前のデータ, injected: 投入直後の JSON（未確定なら null）} の組。
  const sampleSnapshots = {};

  // 有効な退避だけを返し、古くなっていれば捨てる（CONVENTIONS §2.5-3「退避した1件は、他の変更が
  // 入った時点で破棄する」）。投入直後の姿を覚えておき、現在のデータがそれと違えば――サンプルの上へ
  // 追記・編集した／JSON を取り込んだ／設定から一括サンプルを入れた／全削除した、のいずれでも――
  // 退避を捨てて片付け導線を引っ込める。捨てないと「サンプルを片付ける」が、ユーザ自身が足した
  // データごと全置換で消してしまう（片付けは replace＝取り消し不能）。
  // exportData の例外は canOfferSample と同様に握る（ここは main を空にした後・mount の前に
  // 走るため、投げると画面が白いまま操作不能になる）。
  function liveSnapshot(t) {
    const snap = sampleSnapshots[t.ns];
    if (!snap) return null;
    if (snap.injected === null) return snap; // 未確定（この描画の最後に sealSampleSnapshot で確定する）
    let now;
    try { now = JSON.stringify(t.def.exportData(t.targetId)); }
    catch (e) { console.warn("exportData() failed:", t.def.id, e); delete sampleSnapshots[t.ns]; return null; }
    if (now === snap.injected) return snap;
    delete sampleSnapshots[t.ns];
    return null;
  }

  // 「投入直後の姿」は**描画が終わったあと**に確定させる。バーはモジュール本体より先に描くため、
  // クリック時点で採ると mount 中の自動投入・正規化（daily の ensureDayInjected がルーチンを
  // items へ投入して保存する等）を取りこぼし、その差分で退避が即座に無効になる
  // ＝投入したサンプルを片付けられなくなる。
  function sealSampleSnapshot(t) {
    const snap = sampleSnapshots[t.ns];
    if (!snap || snap.injected !== null) return;
    try { snap.injected = JSON.stringify(t.def.exportData(t.targetId)); }
    catch (e) { console.warn("exportData() failed:", t.def.id, e); delete sampleSnapshots[t.ns]; }
  }

  function appendSampleBar(view) {
    const bar = renderSampleBar(view);
    if (bar) main.appendChild(bar);
  }

  // 有効な退避があれば片付けバー、無ければ（かつ投入先が空なら）投入バー。どちらでもなければ
  // null（何も出さない）。判定順が逆だと、投入直後は空でなくなるため片付け導線が出せない。
  function renderSampleBar(view) {
    const t = scopeOf(view);
    if (liveSnapshot(t)) {
      return sampleBar("サンプルを表示しています。", "サンプルを片付ける", () => {
        // 押した時点でも確かめる（描画後にサンプルの上へ書き足されていることがある）。
        const snap = liveSnapshot(t);
        if (!snap) { route(view); MK.ui.toast("サンプルを入れたあとに変更があったため、片付けを取りやめました", "info"); return; }
        if (!runSampleOp(view, () => t.def.importData(snap.before, "replace", t.targetId))) return;
        delete sampleSnapshots[t.ns];
        route(view);
        MK.ui.toast("サンプルを片付けました", "success");
      });
    }
    if (!MK.canOfferSample(view, t.targetId)) return null;
    return sampleBar(sampleEmptyText(t), "サンプルを入れて試す", () => {
      // 押した時点でも空か確かめる。バーはシェルの main 直下でモジュール本体とは兄弟のため、
      // モジュール側の render()（root の作り直し）ではバーが消えない ── 描画後に本体のフォームから
      // 入力していると、バーだけが「空」のまま残る。ここで確かめないと、全置換の loadSample が
      // 入力したばかりのデータを消す（片付け側と対称にする）。
      if (!MK.canOfferSample(view, t.targetId)) {
        route(view);
        MK.ui.toast("データが入ったため、サンプル投入を取りやめました", "info");
        return;
      }
      // 先に退避してから投入する（loadSample は全置換なので、後から元の状態は取り出せない）。
      const before = t.def.exportData(t.targetId);
      if (!runSampleOp(view, () => t.def.loadSample(t.targetId))) return;
      // 何も入らないことがある（oneonone は人が、releases はプロダクトが1件も無いと作れない）。
      // そのまま退避を残すと、空のまま「サンプルを表示しています」に切り替わって、入っていないのに
      // 片付け導線だけが出る＝投入をやり直せなくなる。退避を残さず、足りないものを伝える。
      if (MK.isEmptyExport(t.def.exportData(t.targetId))) {
        route(view);
        MK.ui.toast("サンプルを作れませんでした。先に人・プロジェクト・プロダクトを登録してください", "info");
        return;
      }
      sampleSnapshots[t.ns] = { before, injected: null }; // 確定は描画後（sealSampleSnapshot）
      route(view);
      MK.ui.toast("サンプルを入れました", "success");
    });
  }

  // 破壊的な操作（loadSample / importData）を実行し、失敗したら画面を作り直して伝える。
  // 読み取り側（canOfferSample / liveSnapshot / sealSampleSnapshot）は例外を握るのに、実際に
  // 書き換える側だけ素通しだと、投げたときトーストも再描画も走らず「何も起きなかった」ように
  // 見える（バーは押せるまま残る）。戻り値は成功したか。
  function runSampleOp(view, op) {
    try { op(); return true; }
    catch (e) {
      console.error("sample operation failed:", view, e);
      route(view);
      MK.ui.toast("サンプルの操作に失敗しました", "error");
      return false;
    }
  }

  // scoped は投入先が「表示中の対象」なので、どこへ入るのかを文面で名指しする（§3.7.2 の主語）。
  // 名前が取れない・空のときは接頭辞ごと落とす（「「」にはデータがありません」を出さない）。
  function sampleEmptyText(t) {
    const entity = t.dim && t.targetId ? MK.scope.master(t.dim).get(t.targetId) : null;
    const name = entity && entity.name ? entity.name : "";
    return (name ? "「" + name + "」には" : "") + "データがありません。サンプルを入れると、中身の入った状態で試せます。";
  }

  function sampleBar(text, label, onClick) {
    return el("div", { class: "mk-sample-bar" }, [
      el("span", { class: "grow sub", text }),
      // 空画面での主導線なので primary（対象未作成時の renderScopeEmpty と同じ性格）
      MK.ui.button(label, { variant: "btn-primary", onClick }),
    ]);
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
  S.clearMain = clearMain;
  S.getSettings = getSettings;
  S.setSettings = setSettings;
  S.isHiddenModule = isHiddenModule;
  S.setModuleHidden = setModuleHidden;
  S.getPinnedModules = getPinnedModules;
  S.isPinnedModule = isPinnedModule;
  S.setModulePinned = setModulePinned;
  S.getTheme = getTheme;
  S.applyTheme = applyTheme;
  S.toggleTheme = toggleTheme;
})();
