/* シェル：グローバル検索（コマンドパレット。Ctrl+K / Cmd+K。Issue #82 / spec §3.5・§10.2）。
   shell-core・shell-home の後に読む（moduleDescription を home から借りるため。Issue #140）。
   検索対象を1本の配列に集約する。人・プロジェクト・（あれば）プロダクトのマスタ、到達可能な
   モジュール名（画面ジャンプ）、各モジュールが任意契約 def.searchItems() で供給するレコード。
   到達不能なビュー（配布プロファイルで masters を持たない等）は候補に混ぜない。 */
(function () {
  "use strict";
  const MK = window.MK;
  const el = MK.util.el;
  const S = window.MK.shell;
  const { META, ALLOWED, ZONES } = S;
  const { route, isHiddenModule } = S;
  // moduleDescription は home（先行ファイル）が S に載せる横断関数。読込順への暗黙依存を避けるため
  // 分割代入せず、利用箇所で S.moduleDescription(...) と実行時解決する（他の横断関数と統一）。

  // 候補の種別ラベル（右端に添える）。
  const KIND_LABELS = { module: "モジュール", person: "人", project: "プロジェクト", product: "プロダクト", record: "" };

  function buildSearchSources() {
    const items = [];
    // モジュール名（画面ジャンプ）。ナビと同じ条件（カタログ既知・非表示除外・到達可能）。
    ZONES.forEach((zone) => (zone.modules || []).forEach((id) => {
      if (!META[id] || isHiddenModule(id) || !ALLOWED[id]) return;
      items.push({ kind: "module", icon: META[id].icon || "🧩", label: META[id].title,
        sub: S.moduleDescription(id) || "モジュールを開く", view: id, keywords: [id] });
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
    const overlay = el("div", { class: "mk-palette-overlay" }); // クラス名を変えるなら shared/ui.js の FRONT_OVERLAY_SELECTOR も直す
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
      if (item.kind === "person" && item.entityId) S.peopleDetailId = item.entityId;
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

  S.openPalette = openPalette;
  S.togglePalette = togglePalette;
})();
