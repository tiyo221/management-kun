/* シェル：サイドバー（ナビ）＋ドロワー開閉。shell-core の次に読み込まれる（Issue #140）。
   ゾーン見出し＋配下モジュールの縦積み（折りたたみ可。Issue #34）と、狭幅（≤768px）での
   ドロワー開閉を担う。定数・状態・ルーターは S（window.MK.shell）経由で共有する。 */
(function () {
  "use strict";
  const MK = window.MK;
  const el = MK.util.el;
  const S = window.MK.shell;
  const { META, ZONES, MASTERS, nav } = S;

  function navItem(label, view) {
    const b = el("button", { class: "mk-nav-item" + (S.current === view ? " active" : ""), text: label });
    // ナビからの遷移は常にトップ（人マスタなら一覧）を出す。開きっぱなしの人詳細（#83）はここで畳む。
    b.addEventListener("click", () => { S.peopleDetailId = null; S.route(view); closeSidebar(); });
    return b;
  }

  // ---- ナビの折りたたみ状態（ゾーン単位。設定 mk:settings.nav に { <label>: true=畳む } で保持）----
  function getNav() { return S.getSettings().nav || {}; }
  function toggleNavZone(label) { const n = Object.assign({}, getNav()); n[label] = !n[label]; S.setSettings({ nav: n }); }

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
    searchItem.addEventListener("click", () => { closeSidebar(); S.openPalette(); });
    nav.appendChild(searchItem);
    nav.appendChild(navItem("🏠 HOME", "home"));
    ZONES.forEach((zone) => {
      const items = [];
      (zone.modules || []).forEach((id) => {
        const m = META[id];
        if (!m) return; // カタログ未知のモジュールは無視
        if (S.isHiddenModule(id)) return; // 非表示モジュールはナビに出さない（Issue #35）
        const implemented = !!MK.modules[id];
        items.push(navItem((m.icon ? m.icon + " " : "") + m.title + (implemented ? "" : "・準備中"), id));
      });
      if (!items.length) return; // 実質空のゾーンは見出しごと出さない
      appendNavGroup(zone.label, items, (zone.modules || []).indexOf(S.current) >= 0);
    });
    // マスタ（人・プロジェクト）はゾーンから独立した「シェルレベル管理グループ」として
    // 設定の直前に置く（spec §3.6 / Issue #46）。config が masters を持たなければ非表示。
    if (MASTERS.length) {
      appendNavGroup("マスタ", MASTERS.map((a) => navItem(a.label, a.view)),
        MASTERS.some((a) => a.view === S.current));
    }
    // 設定は「シェルの持ち物」なのでナビ末尾ではなく .mk-actions（テーマ切替の隣）に常設する
    // （Issue #148）。ここではその設定ボタンのアクティブ強調だけを現在ビューに同期する。
    const settingsBtn = document.getElementById("btn-settings");
    if (settingsBtn) settingsBtn.classList.toggle("active", S.current === "settings");
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

  S.renderNav = renderNav;
  S.closeSidebar = closeSidebar;
  S.toggleSidebar = toggleSidebar;
})();
