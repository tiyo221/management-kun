/* モジュール wbs — ロジック（階層計算・ロールアップ・依存・CRUD・CSV整形）。DOM/UI に触れない。CONVENTIONS §1 */
(function () {
  "use strict";
  const MK = window.MK;
  const store = MK.store.scope("module:wbs");

  const STATUS = [
    { key: "notstarted", label: "未着手", color: "var(--color-hairline-strong)" },
    { key: "inprogress", label: "進行中", color: "var(--color-primary)" },
    { key: "done", label: "完了", color: "var(--color-success)" },
    { key: "hold", label: "保留", color: "var(--color-warning)" },
  ];

  let lastDeleted = null;

  function load() {
    const d = store.get();
    const data = d && Array.isArray(d.tasks) ? d : { version: 1, uid: 1, tasks: [] };
    if (typeof data.uid !== "number") data.uid = data.tasks.reduce((m, t) => Math.max(m, (t.id || 0) + 1), 1);
    data.tasks.forEach((t) => { if (!Array.isArray(t.deps)) t.deps = []; });
    return data;
  }
  function save(d) { store.set(d); }
  function tasks() { return load().tasks; }
  function nextId(d) { return d.uid++; }

  // 階層ユーティリティ（純粋）
  function childrenRange(tasks, idx) { const lvl = tasks[idx].level; let end = idx + 1; while (end < tasks.length && tasks[end].level > lvl) end++; return [idx + 1, end]; }
  function subtreeEnd(tasks, idx) { return childrenRange(tasks, idx)[1]; }
  function isParent(tasks, idx) { const r = childrenRange(tasks, idx); return r[1] > r[0]; }
  function wbsNumbers(tasks) { const c = []; return tasks.map((t) => { const L = t.level; c[L] = (c[L] || 0) + 1; c.length = L + 1; return c.slice(0, L + 1).join("."); }); }
  function summaryOf(tasks, idx) {
    const [s, e] = childrenRange(tasks, idx);
    let minStart = null, maxEnd = null, sum = 0, cnt = 0;
    for (let k = s; k < e; k++) { if (isParent(tasks, k)) continue; const t = tasks[k]; if (t.start && (!minStart || t.start < minStart)) minStart = t.start; if (t.end && (!maxEnd || t.end > maxEnd)) maxEnd = t.end; sum += Number(t.progress) || 0; cnt++; }
    return { start: minStart, end: maxEnd, progress: cnt ? Math.round(sum / cnt) : 0 };
  }
  function hiddenFlags(tasks) { const hidden = new Array(tasks.length).fill(false); tasks.forEach((t, i) => { if (t.collapsed) { const [s, e] = childrenRange(tasks, i); for (let k = s; k < e; k++) hidden[k] = true; } }); return hidden; }
  function depsCreatesCycle(tasks, currentId, predId) {
    if (currentId === predId) return true;
    const map = {}; tasks.forEach((t) => (map[t.id] = t));
    const seen = {};
    const visit = (id) => { if (id === currentId) return true; if (seen[id]) return false; seen[id] = true; const t = map[id]; return !!(t && t.deps.some(visit)); };
    return visit(predId);
  }

  // 操作（save のみ・描画は view）
  function blank(d, level) { return { id: nextId(d), level, name: "新規タスク", assigneeId: null, start: "", end: "", progress: 0, status: "notstarted", note: "", deps: [], collapsed: false }; }
  function addRoot() { const d = load(); d.tasks.push(blank(d, 0)); save(d); }
  function addChild(idx) { const d = load(); const t = blank(d, d.tasks[idx].level + 1); d.tasks.splice(idx + 1, 0, t); d.tasks[idx].collapsed = false; save(d); }
  function addSibling(idx) { const d = load(); const t = blank(d, d.tasks[idx].level); d.tasks.splice(subtreeEnd(d.tasks, idx), 0, t); save(d); }
  function indent(idx) { const d = load(); if (idx === 0 || d.tasks[idx].level > d.tasks[idx - 1].level) return; const e = subtreeEnd(d.tasks, idx); for (let k = idx; k < e; k++) d.tasks[k].level++; save(d); }
  function outdent(idx) { const d = load(); if (d.tasks[idx].level === 0) return; const e = subtreeEnd(d.tasks, idx); for (let k = idx; k < e; k++) d.tasks[k].level--; save(d); }
  function moveUp(idx) { const d = load(); const tk = d.tasks; const lvl = tk[idx].level; let p = idx - 1; while (p >= 0 && tk[p].level > lvl) p--; if (p < 0 || tk[p].level < lvl) return; const block = tk.splice(idx, subtreeEnd(tk, idx) - idx); tk.splice(p, 0, ...block); save(d); }
  function moveDown(idx) { const d = load(); const tk = d.tasks; const lvl = tk[idx].level; const e = subtreeEnd(tk, idx); if (e >= tk.length || tk[e].level < lvl) return; const nextEnd = subtreeEnd(tk, e); const block = tk.splice(idx, e - idx); tk.splice(idx + (nextEnd - e), 0, ...block); save(d); }
  function deleteTask(idx) {
    const d = load(); const e = subtreeEnd(d.tasks, idx);
    const removed = d.tasks.splice(idx, e - idx);
    const removedIds = removed.map((t) => t.id);
    d.tasks.forEach((t) => { t.deps = t.deps.filter((id) => removedIds.indexOf(id) < 0); });
    lastDeleted = { index: idx, block: removed };
    save(d);
  }
  function undoDelete() { if (!lastDeleted) return; const d = load(); d.tasks.splice(lastDeleted.index, 0, ...lastDeleted.block); lastDeleted = null; save(d); }
  function update(idx, patch) { const d = load(); Object.assign(d.tasks[idx], patch); save(d); }
  function toggleCollapse(idx) { const d = load(); d.tasks[idx].collapsed = !d.tasks[idx].collapsed; save(d); }
  function setAssignee(idx, name) { const d = load(); d.tasks[idx].assigneeId = name && name.trim() ? MK.people.resolveOrCreate(name) : null; save(d); }
  function addDep(idx, predId) { const d = load(); if (depsCreatesCycle(d.tasks, d.tasks[idx].id, predId)) return false; if (d.tasks[idx].deps.indexOf(predId) < 0) d.tasks[idx].deps.push(predId); save(d); return true; }
  function removeDep(idx, predId) { const d = load(); d.tasks[idx].deps = d.tasks[idx].deps.filter((id) => id !== predId); save(d); }

  function stats() {
    const t = tasks(); const leaves = t.filter((x, i) => !isParent(t, i));
    const cnt = { notstarted: 0, inprogress: 0, done: 0, hold: 0 }; let sum = 0;
    leaves.forEach((x) => { cnt[x.status] = (cnt[x.status] || 0) + 1; sum += Number(x.progress) || 0; });
    return { overall: leaves.length ? Math.round(sum / leaves.length) : 0, leaves: leaves.length, done: cnt.done, inprogress: cnt.inprogress };
  }

  function buildCSVRows() {
    const t = tasks(); const nums = wbsNumbers(t);
    const rows = [["WBS番号", "タスク名", "担当者", "開始", "終了", "進捗", "ステータス", "先行", "備考"]];
    t.forEach((task, i) => {
      const r = isParent(t, i) ? summaryOf(t, i) : task;
      const assignee = task.assigneeId && MK.people.get(task.assigneeId) ? MK.people.get(task.assigneeId).name : "";
      const preds = task.deps.map((pid) => { const pi = t.findIndex((x) => x.id === pid); return pi >= 0 ? nums[pi] : ""; }).filter(Boolean).join(" ");
      const label = (STATUS.find((s) => s.key === task.status) || {}).label || task.status;
      rows.push([nums[i], task.name, assignee, r.start || "", r.end || "", String(r.progress != null ? r.progress : task.progress), label, preds, task.note || ""]);
    });
    return rows;
  }

  function exportData() { return load(); }
  function importData(data, mode) {
    if (mode === "merge") {
      const d = load(); const byId = {}; d.tasks.forEach((t) => (byId[t.id] = t));
      (data.tasks || []).forEach((t) => (byId[t.id] = t));
      d.tasks = Object.keys(byId).map((k) => byId[k]);
      d.uid = Math.max(d.uid || 1, data.uid || 1); save(d);
    } else { save({ version: 1, uid: data && data.uid ? data.uid : 1, tasks: (data && data.tasks) || [] }); }
  }
  function loadSample() {
    const d = { version: 1, uid: 1, tasks: [] };
    const today = MK.util.todayISO();
    const mk = (level, name, opts) => Object.assign({ id: d.uid++, level, name, assigneeId: null, start: "", end: "", progress: 0, status: "notstarted", note: "", deps: [], collapsed: false }, opts || {});
    const sato = MK.people.resolveOrCreate("佐藤 花子"), suzuki = MK.people.resolveOrCreate("鈴木 一郎"), tanaka = MK.people.resolveOrCreate("田中 美咲");
    const t1 = mk(0, "新製品ローンチ");
    const t2 = mk(1, "要件定義", { assigneeId: sato, start: today, end: MK.util.addDays(today, 4), progress: 100, status: "done" });
    const t3 = mk(1, "設計", { assigneeId: suzuki, start: MK.util.addDays(today, 5), end: MK.util.addDays(today, 9), progress: 60, status: "inprogress" });
    const t4 = mk(1, "デザイン", { assigneeId: tanaka, start: MK.util.addDays(today, 5), end: MK.util.addDays(today, 12), progress: 20, status: "inprogress" });
    const t5 = mk(1, "リリース", { start: MK.util.addDays(today, 13), end: MK.util.addDays(today, 13), status: "notstarted" });
    d.tasks = [t1, t2, t3, t4, t5];
    t3.deps = [t2.id]; t4.deps = [t2.id]; t5.deps = [t3.id, t4.id];
    save(d);
  }

  MK.logic = MK.logic || {};
  MK.logic.wbs = { STATUS, load, save, tasks, childrenRange, subtreeEnd, isParent, wbsNumbers, summaryOf, hiddenFlags, depsCreatesCycle, addRoot, addChild, addSibling, indent, outdent, moveUp, moveDown, deleteTask, undoDelete, update, toggleCollapse, setAssignee, addDep, removeDep, stats, buildCSVRows, exportData, importData, loadSample };
})();
