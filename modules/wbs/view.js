/* モジュール wbs — ビュー（描画・イベント）。計算は MK.logic.wbs に委譲。CONVENTIONS §1 */
(function () {
  "use strict";
  const MK = window.MK;
  const el = MK.util.el;
  const ui = MK.ui;
  const L = () => MK.logic.wbs;

  const ROW_H = 34;
  const NAME_W = 200; // ガントの固定名前列の幅（Issue #165）
  // ガントのズーム段階（1日あたりの px 幅）。日＝従来幅、週/月で圧縮して横長を緩和（Issue #157）。
  const ZOOM = { day: 24, week: 12, month: 5 };
  let root = null;
  let opsMenu = null;
  let pendingFocusId = null; // 移動・インデント後に再フォーカスする行の task id（Issue #156）
  let viewMode = "table"; // "table" | "gantt"（テーブル/ガントのタブ切替）
  let zoomKey = "day"; // ZOOM のキー
  let ganttHost = null; // ガントのスクロール容器（「今日へスクロール」用）
  let ganttMeta = null; // { min, dayW, nameW }（スクロール位置計算用）

  function render() {
    if (!root) return;
    closeOpsMenu();
    const tasks = L().tasks();
    root.innerHTML = "";
    root.appendChild(ui.sectionTitle("WBS"));

    const st = L().stats();
    const stats = ui.statsRow([
      { num: st.overall + "%", label: "全体進捗（葉平均）" }, { num: st.leaves, label: "葉タスク数" },
      { num: st.done + "/" + st.leaves, label: "完了" }, { num: st.inprogress, label: "進行中" },
    ]);
    const bar = ui.toolbar([
      ui.button("＋ 大項目", { variant: "btn-primary", onClick: () => { L().addRoot(); render(); } }),
      ui.button("CSV 出力", { onClick: () => { MK.io.downloadText("wbs-" + MK.util.todayISO().replace(/-/g, "") + ".csv", MK.io.csv.stringify(L().buildCSVRows()), "text/csv"); MK.ui.toast("CSV を書き出しました", "success"); } }),
    ]);

    if (!tasks.length) { root.appendChild(ui.stack([stats, bar, ui.emptyState({
      title: "まだタスクがありません",
      hint: "大項目を追加し、その下に小項目をぶら下げて WBS を組み立てます。進捗や期間はガントに反映されます。",
      action: { label: "＋ 最初の大項目を追加", onClick: () => { L().addRoot(); render(); } },
    })])); return; }

    const nums = L().wbsNumbers(tasks);
    const hidden = L().hiddenFlags(tasks);
    const visible = []; tasks.forEach((t, i) => { if (!hidden[i]) visible.push(i); });

    // テーブル / ガントのタブ切替。片方を全幅で表示する（Issue #157）。
    const tabs = ui.pillTabs(
      [{ key: "table", label: "テーブル" }, { key: "gantt", label: "ガント" }],
      viewMode, (k) => { viewMode = k; render(); }
    );

    let panel;
    if (viewMode === "gantt") {
      const gantt = renderGantt(tasks, nums, visible);
      panel = ui.stack([ganttBar(), el("div", { class: "wbs-wrap" }, [gantt])]);
      // ガントを開いた/ズームしたら今日付近を初期表示にする（rAF で DOM 反映後に）
      requestAnimationFrame(scrollToToday);
    } else {
      ganttHost = null; ganttMeta = null;
      panel = el("div", { class: "wbs-wrap" }, [renderTable(tasks, nums, visible)]);
    }
    root.appendChild(ui.stack([stats, bar, tabs, panel]));
    // 移動・インデント直後は操作した行へフォーカスを戻す（連続操作しやすく）。Issue #156。
    if (pendingFocusId != null) {
      const id = pendingFocusId; pendingFocusId = null;
      const trEl = root.querySelector('tr[data-id="' + id + '"]');
      if (trEl) trEl.focus();
    }
  }

  // ガント用ツールバー：ズーム（日/週/月）＋「今日へスクロール」。
  function ganttBar() {
    const zoom = ui.pillTabs(
      [{ key: "day", label: "日" }, { key: "week", label: "週" }, { key: "month", label: "月" }],
      zoomKey, (k) => { zoomKey = k; render(); }
    );
    zoom.appendChild(ui.button("今日へスクロール", { onClick: scrollToToday }));
    return zoom;
  }

  // ガントのスクロール位置を今日が中央に来るよう調整する。
  // 名前列（NAME_W）は sticky で常在するため、バーが見える幅はそのぶん狭い。
  function scrollToToday() {
    if (!ganttHost || !ganttMeta) return;
    const idx = MK.util.daysBetween(ganttMeta.min, MK.util.todayISO());
    const x = idx * ganttMeta.dayW + ganttMeta.dayW / 2;
    const barViewport = Math.max(0, ganttHost.clientWidth - ganttMeta.nameW);
    ganttHost.scrollLeft = Math.max(0, x - barViewport / 2);
  }

  function renderTable(tasks, nums, visible) {
    const grid = el("table", { class: "wbs-grid" });
    grid.appendChild(el("tr", {}, ["#", "タスク名", "担当", "開始", "終了", "進捗", "状態", "先行", ""].map((h) => el("th", { text: h }))));
    visible.forEach((idx) => {
      const t = tasks[idx];
      const parent = L().isParent(tasks, idx);
      const sum = parent ? L().summaryOf(tasks, idx) : null;
      const tr = el("tr", { tabindex: "0" });
      tr.dataset.id = String(t.id);
      // キーボード操作（行そのものにフォーカスがある時のみ）: Alt+↑↓ で移動、Tab/Shift+Tab で
      // 字下げ/字上げ、Esc で行フォーカス解除（Issue #156）。入力セル編集中は誤発火させない。
      tr.addEventListener("keydown", (e) => {
        if (e.target !== tr) return;
        if (e.altKey && e.key === "ArrowUp") { e.preventDefault(); rowOp(idx, t.id, () => L().moveUp(idx)); }
        else if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); rowOp(idx, t.id, () => L().moveDown(idx)); }
        else if (e.key === "Tab") { e.preventDefault(); rowOp(idx, t.id, () => (e.shiftKey ? L().outdent(idx) : L().indent(idx))); }
        else if (e.key === "Escape") { tr.blur(); }
      });
      tr.appendChild(el("td", {}, [el("span", { class: "wbs-num", text: nums[idx] })]));

      const nameWrap = el("div", { class: "wbs-name", style: "padding-left:" + (t.level * 14) + "px;" });
      if (parent) { const tg = el("span", { class: "wbs-toggle", text: t.collapsed ? "▶" : "▼" }); tg.addEventListener("click", () => { L().toggleCollapse(idx); render(); }); nameWrap.appendChild(tg); }
      else nameWrap.appendChild(el("span", { class: "wbs-toggle", text: "" }));
      nameWrap.appendChild(cellInput(t.name, "text", (v) => { L().update(idx, { name: v }); render(); }, parent ? "summary" : ""));
      tr.appendChild(el("td", {}, [nameWrap]));

      tr.appendChild(el("td", {}, [assigneeCell(idx, t)]));

      if (parent) {
        tr.appendChild(el("td", { class: "summary", text: sum.start || "" }));
        tr.appendChild(el("td", { class: "summary", text: sum.end || "" }));
        tr.appendChild(el("td", { class: "summary", text: sum.progress + "%" }));
        tr.appendChild(el("td", { class: "summary", text: "—" }));
        tr.appendChild(el("td", { class: "summary", text: "—" }));
      } else {
        tr.appendChild(el("td", {}, [cellInput(t.start, "date", (v) => { L().update(idx, { start: v }); render(); })]));
        tr.appendChild(el("td", {}, [cellInput(t.end, "date", (v) => { L().update(idx, { end: v }); render(); })]));
        tr.appendChild(el("td", {}, [cellInput(String(t.progress), "number", (v) => { L().update(idx, { progress: clamp(v) }); render(); })]));
        tr.appendChild(el("td", {}, [statusCell(idx, t)]));
        tr.appendChild(el("td", {}, [depCell(tasks, nums, idx, t)]));
      }
      tr.appendChild(el("td", { class: "wbs-ops" }, [moveButtons(idx, t.id), opsCell(idx)]));
      grid.appendChild(tr);
    });
    return el("div", { class: "wbs-table" }, [grid]);
  }

  function assigneeCell(idx, t) {
    const cur = t.assigneeId ? MK.people.get(t.assigneeId) : null;
    const inputEl = el("input", { class: "cell", list: "mk-people-list", value: cur ? cur.name : "", placeholder: "—", style: "width:90px;" });
    inputEl.addEventListener("change", () => { L().setAssignee(idx, inputEl.value); render(); });
    return inputEl;
  }
  function statusCell(idx, t) {
    const sel = el("select", { class: "cell" });
    L().STATUS.forEach((s) => sel.appendChild(el("option", { value: s.key, text: s.label })));
    sel.value = t.status;
    sel.addEventListener("change", () => { L().update(idx, { status: sel.value }); render(); });
    return sel;
  }
  function depCell(tasks, nums, idx, t) {
    const wrap = el("span");
    t.deps.forEach((pid) => { const pi = tasks.findIndex((x) => x.id === pid); if (pi < 0) return; const chip = el("span", { class: "wbs-dep-chip", title: "クリックで削除", text: nums[pi] }); chip.addEventListener("click", () => { L().removeDep(idx, pid); render(); }); wrap.appendChild(chip); });
    const sel = el("select", { class: "cell" });
    sel.appendChild(el("option", { value: "", text: "＋" }));
    tasks.forEach((cand, ci) => { if (ci === idx || L().isParent(tasks, ci)) return; if (t.deps.indexOf(cand.id) >= 0) return; if (L().depsCreatesCycle(tasks, t.id, cand.id)) return; sel.appendChild(el("option", { value: String(cand.id), text: nums[ci] })); });
    sel.addEventListener("change", () => { if (sel.value) { if (!L().addDep(idx, Number(sel.value))) MK.ui.toast("循環するため追加できません", "error"); render(); } });
    wrap.appendChild(sel);
    return wrap;
  }

  // 移動・インデントを実行し、rerender 後に同じ行へフォーカスを戻す（Issue #156）。
  function rowOp(idx, id, fn) { fn(); pendingFocusId = id; render(); }

  // 各行に常時表示する移動・インデントボタン（メニューを開かず1クリック）。Issue #156。
  function moveButtons(idx, id) {
    const mk = (label, title, fn) => { const b = el("button", { class: "btn btn-ghost", text: label, title, "aria-label": title }); b.addEventListener("click", (e) => { e.stopPropagation(); rowOp(idx, id, fn); }); return b; };
    return el("span", { class: "wbs-move" }, [
      mk("↑", "上へ移動 (Alt+↑)", () => L().moveUp(idx)),
      mk("↓", "下へ移動 (Alt+↓)", () => L().moveDown(idx)),
      mk("⇤", "字上げ・親へ (Shift+Tab)", () => L().outdent(idx)),
      mk("⇥", "字下げ・子にする (Tab)", () => L().indent(idx)),
    ]);
  }

  function opsCell(idx) {
    const b = el("button", { class: "btn btn-ghost", text: "⋯", title: "操作" });
    b.addEventListener("click", (e) => { e.stopPropagation(); openOpsMenu(b, idx); });
    return b;
  }
  function openOpsMenu(anchor, idx) {
    closeOpsMenu();
    const rect = anchor.getBoundingClientRect();
    const menu = el("div", { class: "wbs-ops-menu" });
    const run = (fn) => { closeOpsMenu(); fn(); render(); };
    // 移動・字下げ/字上げは各行の常時ボタン＋キーボードへ移した（Issue #156）。
    // メニューには頻度の低い追加・削除だけを残す。
    const items = [
      ["＋ 子タスク", () => L().addChild(idx), ""], ["＋ 兄弟タスク", () => L().addSibling(idx), ""],
      ["✕ 削除", () => { L().deleteTask(idx); showUndo(); }, "danger"],
    ];
    items.forEach(([label, fn, cls]) => { const it = el("button", { class: "wbs-ops-item " + cls, text: label }); it.addEventListener("click", (e) => { e.stopPropagation(); run(fn); }); menu.appendChild(it); });
    menu.style.top = (rect.bottom + 4) + "px";
    menu.style.left = Math.min(rect.left, window.innerWidth - 168) + "px";
    document.body.appendChild(menu);
    opsMenu = menu;
    setTimeout(() => document.addEventListener("click", closeOpsMenu), 0);
  }
  function closeOpsMenu() { if (!opsMenu) return; opsMenu.remove(); opsMenu = null; document.removeEventListener("click", closeOpsMenu); }

  function showUndo() {
    const host = document.getElementById("mk-toasts") || (function () { const h = el("div", { id: "mk-toasts", class: "mk-toasts" }); document.body.appendChild(h); return h; })();
    const b = el("button", { class: "btn btn-ghost", text: "元に戻す" });
    const toast = el("div", { class: "mk-toast show" }, ["削除しました　", b]);
    b.addEventListener("click", () => { L().undoDelete(); render(); toast.remove(); });
    host.appendChild(toast);
    setTimeout(() => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 300); }, 6000);
  }

  // ---- ガント（freeze panes: 固定名前列＋固定日付ヘッダ＋バーSVG）Issue #165 ----
  // 1つのスクロール容器＋CSS grid（2×2）＋sticky で全同期する（スクロール同期 JS なし）。
  //   コーナー: sticky top+left ／ 日付ヘッダ: sticky top ／ 名前列: sticky left ／ バー: 通常
  function renderGantt(tasks, nums, visible) {
    const host = el("div", { class: "wbs-gantt" });
    const DAY_W = ZOOM[zoomKey] || ZOOM.day;
    const showDayNum = DAY_W >= 12; // 月ズーム（幅が狭い）では日付数字を省き、月ラベルのみ表示
    const A = MK.util.addDays, D = MK.util.daysBetween;
    let min = null, max = null;
    tasks.forEach((t, i) => { const r = L().isParent(tasks, i) ? L().summaryOf(tasks, i) : t; if (r.start && (!min || r.start < min)) min = r.start; if (r.end && (!max || r.end > max)) max = r.end; });
    if (!min) { min = MK.util.todayISO(); max = A(min, 30); }
    min = A(min, -2); max = A(max, 4);
    ganttHost = host; ganttMeta = { min, dayW: DAY_W, nameW: NAME_W }; // 「今日へスクロール」用
    const days = D(min, max) + 1, W = days * DAY_W, bodyH = visible.length * ROW_H;
    const pos = {}, esc = MK.util.escapeHtml;
    const todayIdx = D(min, MK.util.todayISO());

    // 日付ヘッダ（sticky top）: 週末網掛け＋月ラベル＋日付数字。高さ ROW_H。
    let head = '<svg width="' + W + '" height="' + ROW_H + '" viewBox="0 0 ' + W + ' ' + ROW_H + '">';
    // バー領域（body）: 週末網掛け・今日線・行罫線・バー・進捗・依存線。y は body 基準（vi*ROW_H）。
    let body = '<svg width="' + W + '" height="' + bodyH + '" viewBox="0 0 ' + W + ' ' + bodyH + '">';
    for (let i = 0; i < days; i++) {
      const date = A(min, i), dow = new Date(date + "T00:00:00").getDay(), x = i * DAY_W;
      if (dow === 0 || dow === 6) {
        head += '<rect x="' + x + '" y="0" width="' + DAY_W + '" height="' + ROW_H + '" fill="var(--color-surface)"></rect>';
        body += '<rect x="' + x + '" y="0" width="' + DAY_W + '" height="' + bodyH + '" fill="var(--color-surface)"></rect>';
      }
      if (new Date(date + "T00:00:00").getDate() === 1 || i === 0) head += '<text x="' + (x + 3) + '" y="14" font-size="10" fill="var(--color-steel)">' + esc(date.slice(0, 7)) + '</text>';
      if (showDayNum) head += '<text x="' + (x + DAY_W / 2) + '" y="28" text-anchor="middle" font-size="9" fill="var(--color-muted)">' + new Date(date + "T00:00:00").getDate() + '</text>';
    }
    // 行の対応づけを助ける薄い横罫線（名前列の行境界と揃える）。
    for (let vi = 1; vi < visible.length; vi++) { const y = vi * ROW_H; body += '<line x1="0" y1="' + y + '" x2="' + W + '" y2="' + y + '" stroke="var(--color-hairline-soft)" stroke-width="1"></line>'; }
    if (todayIdx >= 0 && todayIdx < days) { const tx = todayIdx * DAY_W + DAY_W / 2; body += '<line x1="' + tx + '" y1="0" x2="' + tx + '" y2="' + bodyH + '" stroke="var(--color-error)" stroke-width="1" stroke-dasharray="3 3"></line>'; }
    visible.forEach((idx, vi) => {
      const t = tasks[idx], parent = L().isParent(tasks, idx), r = parent ? L().summaryOf(tasks, idx) : t, y = vi * ROW_H;
      if (!r.start || !r.end) return;
      const x = D(min, r.start) * DAY_W, w = (D(r.start, r.end) + 1) * DAY_W;
      pos[t.id] = { x, w, y: y + ROW_H / 2 };
      if (r.start === r.end && !parent) { const cy = y + ROW_H / 2, cx = x + DAY_W / 2; body += '<path d="M ' + cx + ' ' + (cy - 7) + ' L ' + (cx + 7) + ' ' + cy + ' L ' + cx + ' ' + (cy + 7) + ' L ' + (cx - 7) + ' ' + cy + ' Z" fill="var(--color-primary)"></path>'; }
      else if (parent) { body += '<rect x="' + x + '" y="' + (y + 12) + '" width="' + w + '" height="6" rx="2" fill="var(--color-steel)"></rect>'; }
      else {
        const color = (L().STATUS.find((st) => st.key === t.status) || L().STATUS[0]).color;
        body += '<rect x="' + x + '" y="' + (y + 8) + '" width="' + w + '" height="18" rx="4" fill="var(--color-hairline)"></rect>';
        body += '<rect x="' + x + '" y="' + (y + 8) + '" width="' + (w * (Number(t.progress) || 0) / 100) + '" height="18" rx="4" fill="' + color + '"></rect>';
      }
    });
    visible.forEach((idx) => {
      const t = tasks[idx]; if (L().isParent(tasks, idx)) return;
      t.deps.forEach((pid) => { const a = pos[pid], b = pos[t.id]; if (!a || !b) return; const x1 = a.x + a.w, y1 = a.y, x2 = b.x, y2 = b.y, mx = Math.max(x1 + 8, x2 - 8); body += '<path d="M ' + x1 + ' ' + y1 + ' H ' + mx + ' V ' + y2 + ' H ' + x2 + '" fill="none" stroke="var(--color-slate)" stroke-width="1"></path><path d="M ' + x2 + ' ' + y2 + ' l -5 -3 l 0 6 z" fill="var(--color-slate)"></path>'; });
    });

    const corner = el("div", { class: "wbs-gantt-corner", text: "タスク名" });
    const headCell = el("div", { class: "wbs-gantt-head" }); headCell.innerHTML = head + "</svg>";
    const nameCol = el("div", { class: "wbs-gantt-names" });
    visible.forEach((idx) => {
      const t = tasks[idx], parent = L().isParent(tasks, idx);
      const inner = el("div", { class: "wbs-gantt-name", style: "padding-left:" + (t.level * 14) + "px;" });
      if (parent) { const tg = el("span", { class: "wbs-toggle", text: t.collapsed ? "▶" : "▼" }); tg.addEventListener("click", () => { L().toggleCollapse(idx); render(); }); inner.appendChild(tg); }
      else inner.appendChild(el("span", { class: "wbs-toggle", text: "" }));
      inner.appendChild(el("span", { class: "wbs-num", text: nums[idx] }));
      inner.appendChild(el("span", { class: "wbs-gantt-name-text" + (parent ? " summary" : ""), text: t.name || "", title: t.name || "" }));
      nameCol.appendChild(el("div", { class: "wbs-gantt-name-row" }, [inner]));
    });
    const barCell = el("div", { class: "wbs-gantt-bars" }); barCell.innerHTML = body + "</svg>";

    host.appendChild(el("div", { class: "wbs-gantt-grid", style: "grid-template-columns:" + NAME_W + "px max-content;" }, [corner, headCell, nameCol, barCell]));
    return host;
  }

  function cellInput(value, type, onChange, cls) {
    const i = el("input", { class: "cell " + (cls || ""), type: type || "text", value: value || "" });
    if (type === "number") { i.min = "0"; i.max = "100"; i.style.width = "52px"; }
    i.addEventListener("change", () => onChange(i.value));
    return i;
  }
  function clamp(v) { let n = parseInt(v, 10); if (isNaN(n)) n = 0; return Math.max(0, Math.min(100, n)); }

  function refreshPeopleDatalist() { const dl = document.getElementById("mk-people-list"); if (!dl) return; dl.innerHTML = ""; MK.people.all().forEach((m) => dl.appendChild(el("option", { value: m.name }))); }
  MK.bus.on("masters:changed", () => { if (root) refreshPeopleDatalist(); });

  MK.registerModule("wbs", {
    title: "WBS", icon: "🗂",
    description: "作業を分解して進捗とスケジュールを管理する",
    // Project 次元に属する scoped モジュール（§3.7.3）。シェルが現在の Project の
    // 対象別 store を ctx.store で渡してくるので、それに束ねてから描画する。
    scope: { dim: "project" },
    mount(container, ctx) {
      if (ctx && ctx.store) L().setStore(ctx.store);
      root = el("div"); container.appendChild(root);
      if (!document.getElementById("mk-people-list")) document.body.appendChild(el("datalist", { id: "mk-people-list" }));
      refreshPeopleDatalist(); render();
    },
    unmount() { closeOpsMenu(); root = null; },
    summary() { return L().summary(); },
    // 全 PJ 横断（§3.7.4）: 検索・人単位サマリーは表示中 PJ に限らず全 PJ を走査する。
    searchItems() { return L().searchItems(); },
    summaryFor(entityType, id) { return L().summaryFor(entityType, id); },
    // 対象別 scope（§3.7.4）: io が PJ ごとに targetId を渡す。省略時は表示中の store。
    exportData(targetId) { return L().exportData(targetId); },
    importData(data, mode, targetId) { L().importData(data, mode, targetId); },
    // サンプル/旧ツール移行の投入先は、自分の次元の既定対象（先頭 PJ・無ければ作成）へ寄せる。
    // this はこの def（scope を持つ）。dim 決め打ちを避けつつ既定 PJ を解決する（§3.7.6）。
    loadSample() {
      const dim = MK.scope.dimOf(this.scope);
      L().loadSample(dim ? MK.scope.ensureDefaultTarget(dim) : null);
    },
  });
})();
