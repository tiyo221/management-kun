/* モジュール workload — ロジック（負荷計算・CRUD・計画）。DOM/UI に触れない。CONVENTIONS §1 */
(function () {
  "use strict";
  const MK = window.MK;
  const store = MK.store.scope("module:workload");

  const STATUS = [{ key: "todo", label: "未着手" }, { key: "in_progress", label: "進行中" }, { key: "done", label: "完了" }];
  const PERIODS = [{ key: 13, label: "四半期" }, { key: 26, label: "半年" }, { key: 52, label: "1年" }];
  const PALETTE = ["#5645d4", "#0075de", "#dd5b00", "#1aae39", "#ff64c8", "#2a9d99"];

  function load() { const d = store.get(); if (!d || !Array.isArray(d.tasks)) return { version: 1, tasks: [], baseline: null, memberSettings: {} }; if (!d.memberSettings) d.memberSettings = {}; return d; }
  function save(d) { store.set(d); }
  function tasks() { return load().tasks; }
  function members() { return MK.people.all(); }
  function warnOf(mid) { const s = load().memberSettings[mid] || {}; return { high: s.high != null ? s.high : 80, low: s.low != null ? s.low : 60 }; }
  function colorOf(m, i) { return (m && m.color) || PALETTE[i % PALETTE.length]; }

  function effEnd(t) { return (t.status === "done" && t.completedDate) ? t.completedDate : t.endDate; }
  function dailyLoad(list, mid, date) { let s = 0; list.forEach((t) => { if (t.memberId !== mid) return; const e = effEnd(t); if (t.startDate && e && t.startDate <= date && date <= e) s += Number(t.load) || 0; }); return s; }
  function weeklyLoad(list, mid, monday) { let s = 0; for (let i = 0; i < 7; i++) s += dailyLoad(list, mid, MK.util.addDays(monday, i)); return s / 7; }

  function weekMondays(period, offset) {
    const start = MK.util.addDays(MK.util.mondayOf(MK.util.todayISO()), (offset || 0) * 7);
    const arr = []; for (let i = 0; i < period; i++) arr.push(MK.util.addDays(start, i * 7));
    return arr;
  }
  function series(mid, weeks) { const list = tasks(); return weeks.map((w) => weeklyLoad(list, mid, w)); }
  function planSeries(mid, weeks) { const d = load(); return d.baseline ? weeks.map((w) => weeklyLoad(d.baseline.tasks, mid, w)) : null; }
  function stats(mid, weeks) {
    const vals = series(mid, weeks);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    const peak = vals.length ? Math.max.apply(null, vals) : 0;
    const w = warnOf(mid);
    const state = avg > w.high ? "over" : (avg < w.low ? "under" : "ok");
    return { vals, avg, peak, high: w.high, low: w.low, state };
  }

  function addTask(attrs) { const d = load(); d.tasks.push(Object.assign({ id: MK.util.uid("wt"), memberId: null, title: "", load: 30, startDate: "", endDate: "", status: "todo", completedDate: null, note: "" }, attrs || {})); save(d); }
  function updateTask(id, patch) { const d = load(); const t = d.tasks.find((x) => x.id === id); if (t) Object.assign(t, patch); save(d); }
  function removeTask(id) { const d = load(); d.tasks = d.tasks.filter((t) => t.id !== id); save(d); }
  function tasksOf(mid) { return tasks().filter((t) => t.memberId === mid); }

  function saveBaseline() { const d = load(); d.baseline = { savedAt: MK.util.todayISO(), tasks: JSON.parse(JSON.stringify(d.tasks)) }; save(d); }
  function clearBaseline() { const d = load(); d.baseline = null; save(d); }
  function hasBaseline() { return !!load().baseline; }

  function exportData() { return load(); }
  function importData(data, mode) {
    if (mode === "merge") {
      const d = load(); const byId = {}; d.tasks.forEach((t) => (byId[t.id] = t));
      (data.tasks || []).forEach((t) => (byId[t.id] = t));
      d.tasks = Object.keys(byId).map((k) => byId[k]);
      if (data.baseline) d.baseline = data.baseline;
      Object.assign(d.memberSettings, data.memberSettings || {}); save(d);
    } else { save({ version: 1, tasks: (data && data.tasks) || [], baseline: (data && data.baseline) || null, memberSettings: (data && data.memberSettings) || {} }); }
  }
  function loadSample() {
    const d = { version: 1, tasks: [], baseline: null, memberSettings: {} };
    const today = MK.util.todayISO();
    const sato = MK.people.resolveOrCreate("佐藤 花子"), suzuki = MK.people.resolveOrCreate("鈴木 一郎"), tanaka = MK.people.resolveOrCreate("田中 美咲");
    const t = (memberId, title, load, s, e, opts) => Object.assign({ id: MK.util.uid("wt"), memberId, title, load, startDate: s, endDate: e, status: "in_progress", completedDate: null, note: "" }, opts || {});
    d.tasks = [
      t(suzuki, "新製品の設計", 60, MK.util.addDays(today, -7), MK.util.addDays(today, 21)),
      t(suzuki, "障害対応", 50, today, MK.util.addDays(today, 14)),
      t(sato, "プロジェクト管理", 40, MK.util.addDays(today, -14), MK.util.addDays(today, 56)),
      t(tanaka, "UIデザイン", 70, today, MK.util.addDays(today, 28)),
      t(tanaka, "ロゴ制作", 30, MK.util.addDays(today, 7), MK.util.addDays(today, 21)),
    ];
    save(d);
  }

  MK.logic = MK.logic || {};
  MK.logic.workload = { STATUS, PERIODS, load, save, tasks, members, warnOf, colorOf, effEnd, weekMondays, series, planSeries, stats, addTask, updateTask, removeTask, tasksOf, saveBaseline, clearBaseline, hasBaseline, exportData, importData, loadSample };
})();
