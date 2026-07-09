/* シェル：ブート（起動配線）。分割後の shell-*.js を最後に束ねるエントリ（Issue #140）。
   かつて約1360行のモノリスだったが、責務ごとに shell-core / shell-nav / shell-home /
   shell-palette / shell-masters / shell-settings へ分割し、このファイルには
   「masters:changed の再描画」「topbar/キーボードのイベント配線」「起動シーケンス」だけを残した。
   すべての描画関数・状態は S（window.MK.shell）に載っており、ここは最後に読まれるので全て参照できる。 */
(function () {
  "use strict";
  const MK = window.MK;
  const el = MK.util.el;
  const S = window.MK.shell;
  const { ALLOWED } = S;
  const { route, exportAll, importAll, toggleTheme, toggleSidebar, closeSidebar, openPalette, togglePalette } = S;
  const { getSettings, getTheme, applyTheme, isHiddenModule, migrateScopedData } = S;
  const { renderPeopleView, renderProjectsView, renderProductsView } = S;

  // マスタ変更時、マスタ管理画面表示中なら再描画。scoped モジュール表示中は
  // スイッチャ/現在対象がマスタに連動するため再マウントする（対象の増減・削除に追随。§3.7.2/3）。
  MK.bus.on("masters:changed", () => {
    if (S.current === "master-people") { S.main.innerHTML = ""; renderPeopleView(); }
    else if (S.current === "master-projects") { S.main.innerHTML = ""; renderProjectsView(); }
    else if (S.current === "master-products") { S.main.innerHTML = ""; renderProductsView(); }
    else if (MK.modules[S.current] && MK.scope.dimOf(MK.modules[S.current].scope)) { route(S.current); }
  });

  // ---- 起動 ----
  document.getElementById("btn-export").addEventListener("click", exportAll);
  document.getElementById("btn-import").addEventListener("click", importAll);
  document.getElementById("btn-theme").addEventListener("click", toggleTheme);
  // 設定はナビ末尾から .mk-actions へ移設（Issue #148）。挙動は従来どおり view=settings へ遷移。
  const settingsBtn = document.getElementById("btn-settings");
  if (settingsBtn) settingsBtn.addEventListener("click", () => { route("settings"); closeSidebar(); });
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

  const legacyFound = Object.keys(S.LEGACY_KEYS).some((k) => localStorage.getItem(k) != null);
  if (legacyFound && !getSettings().migration.fromLegacyDone) {
    MK.ui.toast("旧ツールのデータが見つかりました。「設定」から移行できます。", "info");
  }
})();
