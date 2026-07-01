/* モジュール todo — ロジック（データ・計算・CRUD）。DOM/UI に触れない。CONVENTIONS §1 */
(function () {
  "use strict";
  const MK = window.MK;
  const store = MK.store.scope("module:todo");

  const STATUSES = [
    { key: "inbox", label: "Inbox" },
    { key: "next", label: "Next" },
    { key: "waiting", label: "Waiting" },
    { key: "someday", label: "Someday" },
    { key: "done", label: "Done" },
  ];

  function load() {
    const d = store.get();
    if (!d || !Array.isArray(d.tasks)) return { version: 1, tasks: [] };
    return d;
  }
  function save(d) { d.exportedAt = MK.util.nowISO(); store.set(d); }
  function tasks() { return load().tasks; }

  function counts() {
    const c = { all: 0 };
    STATUSES.forEach((s) => (c[s.key] = 0));
    tasks().forEach((t) => { c.all++; c[t.status] = (c[t.status] || 0) + 1; });
    return c;
  }

  function filtered(filter, search) {
    const q = MK.util.normalizeKey(search || "");
    let items = tasks();
    if (filter && filter !== "all") items = items.filter((t) => t.status === filter);
    if (q) items = items.filter((t) => MK.util.normalizeKey(t.title).includes(q) || MK.util.normalizeKey(t.notes).includes(q));
    return items;
  }

  function addTask(title) {
    const d = load();
    const now = MK.util.nowISO();
    d.tasks.unshift({
      id: MK.util.uid("t"), title: title.trim(), notes: "", status: "inbox",
      contexts: [], projectId: null, due: null, createdAt: now, updatedAt: now, completedAt: null,
    });
    save(d);
  }
  function updateTask(id, patch) {
    const d = load();
    const t = d.tasks.find((x) => x.id === id);
    if (!t) return;
    Object.assign(t, patch);
    t.updatedAt = MK.util.nowISO();
    save(d);
  }
  function toggleDone(id, done) {
    updateTask(id, done ? { status: "done", completedAt: MK.util.nowISO() } : { status: "next", completedAt: null });
  }
  function removeTask(id) { const d = load(); d.tasks = d.tasks.filter((t) => t.id !== id); save(d); }

  // プロジェクト名寄せ（マスタ解決はロジック側の責務）
  function projectNameOf(id) { if (!id) return ""; const p = MK.projects.get(id); return p ? p.name : ""; }
  function resolveProject(name) { return name && name.trim() ? MK.projects.resolveOrCreate(name) : null; }

  function exportData() { return load(); }
  function importData(data, mode) {
    if (mode === "merge") {
      const d = load();
      const byId = {};
      d.tasks.forEach((t) => (byId[t.id] = t));
      (data.tasks || []).forEach((t) => (byId[t.id] = t));
      d.tasks = Object.keys(byId).map((k) => byId[k]);
      save(d);
    } else {
      save({ version: 1, tasks: (data && data.tasks) || [] });
    }
  }
  function loadSample() {
    const now = MK.util.nowISO();
    const dayOffset = (n) => { const d = new Date(); d.setDate(d.getDate() + n); const p = (x) => String(x).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); };
    const pid = (name) => MK.projects.resolveOrCreate(name);
    const t = (title, status, opts) => Object.assign({ id: MK.util.uid("t"), title, notes: "", status, contexts: [], projectId: null, due: null, createdAt: now, updatedAt: now, completedAt: status === "done" ? now : null }, opts || {});
    save({ version: 1, tasks: [
      t("思いついたアイデアをメモ", "inbox"),
      t("競合サービスをざっと調べる", "inbox", { projectId: pid("新製品ローンチ") }),
      t("企画書のドラフトを書く", "next", { contexts: ["@pc"], projectId: pid("新製品ローンチ"), due: dayOffset(2) }),
      t("デザインレビューの日程調整", "next", { contexts: ["@mail"], projectId: pid("サイトリニューアル") }),
      t("発表スライドを準備", "next", { contexts: ["@pc"], projectId: pid("社内勉強会"), due: dayOffset(5) }),
      t("印刷会社からの見積もり", "waiting", { notes: "鈴木さん経由で依頼中", projectId: pid("新製品ローンチ") }),
      t("いつか英語の勉強を始める", "someday"),
      t("キックオフMTGを実施", "done", { projectId: pid("新製品ローンチ") }),
      t("要件ヒアリング", "done", { projectId: pid("サイトリニューアル") }),
    ] });
  }

  MK.logic = MK.logic || {};
  MK.logic.todo = {
    STATUSES, load, save, tasks, counts, filtered,
    addTask, updateTask, toggleDone, removeTask,
    projectNameOf, resolveProject,
    exportData, importData, loadSample,
  };
})();
