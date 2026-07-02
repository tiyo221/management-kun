/* モジュール wbs — ビュー（描画・イベント）。計算は MK.logic.wbs に委譲。CONVENTIONS §1 */
(function () {
  "use strict";
  const MK = window.MK;
  const el = MK.util.el;
  const ui = MK.ui;
  const L = () => MK.logic.wbs;

  const DAY_W = 24, ROW_H = 34;
  let root = null;
  let opsMenu = null;

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

    if (!tasks.length) { root.appendChild(ui.stack([stats, bar, ui.emptyState("タスクがありません。「＋ 大項目」から追加してください。")])); return; }

    const nums = L().wbsNumbers(tasks);
    const hidden = L().hiddenFlags(tasks);
    const visible = []; tasks.forEach((t, i) => { if (!hidden[i]) visible.push(i); });
    const wrap = el("div", { class: "wbs-wrap" }, [renderTable(tasks, nums, visible), renderGantt(tasks, nums, visible)]);
    root.appendChild(ui.stack([stats, bar, wrap]));
  }

  function renderTable(tasks, nums, visible) {
    const grid = el("table", { class: "wbs-grid" });
    grid.appendChild(el("tr", {}, ["#", "タスク名", "担当", "開始", "終了", "進捗", "状態", "先行", ""].map((h) => el("th", { text: h }))));
    visible.forEach((idx) => {
      const t = tasks[idx];
      const parent = L().isParent(tasks, idx);
      const sum = parent ? L().summaryOf(tasks, idx) : null;
      const tr = el("tr");
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
      tr.appendChild(el("td", { class: "wbs-ops" }, [opsCell(idx)]));
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
    const items = [
      ["＋ 子タスク", () => L().addChild(idx), ""], ["＋ 兄弟タスク", () => L().addSibling(idx), ""],
      ["⇥ 字下げ（子にする）", () => L().indent(idx), ""], ["⇤ 字上げ（親へ）", () => L().outdent(idx), ""],
      ["↑ 上へ移動", () => L().moveUp(idx), ""], ["↓ 下へ移動", () => L().moveDown(idx), ""],
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
    const b = el("button", { class: "btn btn-ghost", text: "元に戻す", style: "color:#fff;" });
    const toast = el("div", { class: "mk-toast show" }, ["削除しました　", b]);
    b.addEventListener("click", () => { L().undoDelete(); render(); toast.remove(); });
    host.appendChild(toast);
    setTimeout(() => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 300); }, 6000);
  }

  // ---- ガント（インラインSVG）----
  function renderGantt(tasks, nums, visible) {
    const host = el("div", { class: "wbs-gantt" });
    const A = MK.util.addDays, D = MK.util.daysBetween;
    let min = null, max = null;
    tasks.forEach((t, i) => { const r = L().isParent(tasks, i) ? L().summaryOf(tasks, i) : t; if (r.start && (!min || r.start < min)) min = r.start; if (r.end && (!max || r.end > max)) max = r.end; });
    if (!min) { min = MK.util.todayISO(); max = A(min, 30); }
    min = A(min, -2); max = A(max, 4);
    const days = D(min, max) + 1, W = days * DAY_W, headH = ROW_H, H = headH + visible.length * ROW_H;
    const pos = {}, esc = MK.util.escapeHtml;
    let s = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">';
    for (let i = 0; i < days; i++) {
      const date = A(min, i), dow = new Date(date + "T00:00:00").getDay(), x = i * DAY_W;
      if (dow === 0 || dow === 6) s += '<rect x="' + x + '" y="0" width="' + DAY_W + '" height="' + H + '" fill="var(--color-surface)"></rect>';
      if (new Date(date + "T00:00:00").getDate() === 1 || i === 0) s += '<text x="' + (x + 3) + '" y="14" font-size="10" fill="var(--color-steel)">' + esc(date.slice(0, 7)) + '</text>';
      s += '<text x="' + (x + DAY_W / 2) + '" y="28" text-anchor="middle" font-size="9" fill="var(--color-muted)">' + new Date(date + "T00:00:00").getDate() + '</text>';
    }
    const todayIdx = D(min, MK.util.todayISO());
    if (todayIdx >= 0 && todayIdx < days) { const tx = todayIdx * DAY_W + DAY_W / 2; s += '<line x1="' + tx + '" y1="0" x2="' + tx + '" y2="' + H + '" stroke="var(--color-error)" stroke-width="1" stroke-dasharray="3 3"></line>'; }
    visible.forEach((idx, vi) => {
      const t = tasks[idx], parent = L().isParent(tasks, idx), r = parent ? L().summaryOf(tasks, idx) : t, y = headH + vi * ROW_H;
      if (!r.start || !r.end) return;
      const x = D(min, r.start) * DAY_W, w = (D(r.start, r.end) + 1) * DAY_W;
      pos[t.id] = { x, w, y: y + ROW_H / 2 };
      if (r.start === r.end && !parent) { const cy = y + ROW_H / 2, cx = x + DAY_W / 2; s += '<path d="M ' + cx + ' ' + (cy - 7) + ' L ' + (cx + 7) + ' ' + cy + ' L ' + cx + ' ' + (cy + 7) + ' L ' + (cx - 7) + ' ' + cy + ' Z" fill="var(--color-primary)"></path>'; }
      else if (parent) { s += '<rect x="' + x + '" y="' + (y + 12) + '" width="' + w + '" height="6" rx="2" fill="var(--color-steel)"></rect>'; }
      else {
        const color = (L().STATUS.find((st) => st.key === t.status) || L().STATUS[0]).color;
        s += '<rect x="' + x + '" y="' + (y + 8) + '" width="' + w + '" height="18" rx="4" fill="var(--color-hairline)"></rect>';
        s += '<rect x="' + x + '" y="' + (y + 8) + '" width="' + (w * (Number(t.progress) || 0) / 100) + '" height="18" rx="4" fill="' + color + '"></rect>';
        const name = t.name && t.name.length > Math.floor(w / 7) ? t.name.slice(0, Math.floor(w / 7)) : t.name;
        s += '<text x="' + (x + 5) + '" y="' + (y + 21) + '" font-size="11" fill="var(--color-ink)">' + esc(name || "") + '</text>';
      }
    });
    visible.forEach((idx) => {
      const t = tasks[idx]; if (L().isParent(tasks, idx)) return;
      t.deps.forEach((pid) => { const a = pos[pid], b = pos[t.id]; if (!a || !b) return; const x1 = a.x + a.w, y1 = a.y, x2 = b.x, y2 = b.y, mx = Math.max(x1 + 8, x2 - 8); s += '<path d="M ' + x1 + ' ' + y1 + ' H ' + mx + ' V ' + y2 + ' H ' + x2 + '" fill="none" stroke="var(--color-slate)" stroke-width="1"></path><path d="M ' + x2 + ' ' + y2 + ' l -5 -3 l 0 6 z" fill="var(--color-slate)"></path>'; });
    });
    host.innerHTML = s + "</svg>";
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
