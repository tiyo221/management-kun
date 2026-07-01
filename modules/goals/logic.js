/* モジュール goals — ロジック（データ・計算・CRUD）。DOM/UI に触れない。CONVENTIONS §1 */
(function () {
  "use strict";
  const MK = window.MK;
  const store = MK.store.scope("module:goals");

  function load() { const d = store.get(); if (!d || !Array.isArray(d.goals)) return { version: 1, goals: [] }; return d; }
  function save(d) { store.set(d); }
  function goals() { return load().goals; }
  function getGoal(id) { return goals().find((g) => g.id === id) || null; }

  function progress(g) { const total = g.steps.length; const done = g.steps.filter((s) => s.status === "done").length; return { total, done, pct: total ? Math.round((done / total) * 100) : 0 }; }
  function isAchieved(g) { return g.steps.length > 0 && g.steps.every((s) => s.status === "done"); }
  function currentStepId(g) { const s = g.steps.find((x) => x.status !== "done"); return s ? s.id : null; }

  function recompute(d) {
    d.goals.forEach((g) => {
      const ach = g.steps.length > 0 && g.steps.every((s) => s.status === "done");
      if (ach && !g.achievedAt) g.achievedAt = MK.util.todayISO();
      if (!ach) g.achievedAt = null;
    });
  }
  function commit(d) { recompute(d); save(d); } // 描画は view の責務（ここでは render しない）

  function addGoal(title) {
    const d = load();
    const g = { id: MK.util.uid("g"), title: title.trim(), description: "", deadline: null, createdAt: MK.util.todayISO(), achievedAt: null, steps: [] };
    d.goals.push(g); commit(d); return g.id;
  }
  function updateGoal(id, patch) { const d = load(); const g = d.goals.find((x) => x.id === id); if (g) Object.assign(g, patch); commit(d); }
  function removeGoal(id) { const d = load(); d.goals = d.goals.filter((g) => g.id !== id); commit(d); }

  function addStep(goalId, title) {
    const d = load(); const g = d.goals.find((x) => x.id === goalId); if (!g) return;
    g.steps.push({ id: MK.util.uid("s"), title: title.trim(), description: "", status: "todo", completedAt: null, review: "" }); commit(d);
  }
  function updateStep(goalId, stepId, patch) { const d = load(); const g = d.goals.find((x) => x.id === goalId); const s = g && g.steps.find((x) => x.id === stepId); if (s) Object.assign(s, patch); commit(d); }
  function toggleStep(goalId, stepId, done) { updateStep(goalId, stepId, done ? { status: "done", completedAt: MK.util.todayISO() } : { status: "todo", completedAt: null }); }
  function removeStep(goalId, stepId) { const d = load(); const g = d.goals.find((x) => x.id === goalId); if (g) g.steps = g.steps.filter((s) => s.id !== stepId); commit(d); }
  function moveStep(goalId, stepId, dir) {
    const d = load(); const g = d.goals.find((x) => x.id === goalId); if (!g) return;
    const i = g.steps.findIndex((s) => s.id === stepId); const j = i + dir;
    if (i < 0 || j < 0 || j >= g.steps.length) return;
    const t = g.steps[i]; g.steps[i] = g.steps[j]; g.steps[j] = t; commit(d);
  }

  function dashboardData() {
    const list = goals();
    const totalDone = list.reduce((n, g) => n + g.steps.filter((s) => s.status === "done").length, 0);
    const achieved = list.filter(isAchieved).length;
    return { achieveRate: list.length ? Math.round((achieved / list.length) * 100) : 0, achieved, total: list.length, totalDone, chart: list.map((g) => ({ label: g.title || "(無題)", value: g.steps.filter((s) => s.status === "done").length })) };
  }

  function exportData() { return load(); }
  function importData(data, mode) {
    if (mode === "merge") {
      const d = load(); const byId = {};
      d.goals.forEach((g) => (byId[g.id] = g));
      (data.goals || []).forEach((g) => (byId[g.id] = g));
      d.goals = Object.keys(byId).map((k) => byId[k]); save(d);
    } else { save({ version: 1, goals: (data && data.goals) || [] }); }
  }
  function loadSample() {
    const today = MK.util.todayISO();
    const mkStep = (title, done, review) => ({ id: MK.util.uid("s"), title, description: "", status: done ? "done" : "todo", completedAt: done ? today : null, review: review || "" });
    save({ version: 1, goals: [
      { id: MK.util.uid("g"), title: "基本情報技術者に合格する", description: "半年で合格を目指す", deadline: null, createdAt: today, achievedAt: null,
        steps: [mkStep("参考書を1周", true, "意外と量が多かった"), mkStep("過去問を3回分解く", true), mkStep("模試を受ける", false), mkStep("本試験", false)] },
      { id: MK.util.uid("g"), title: "ランニングを習慣化する", description: "", deadline: null, createdAt: today, achievedAt: null,
        steps: [mkStep("シューズを買う", true), mkStep("週2回30分走る", false)] },
    ] });
  }

  MK.logic = MK.logic || {};
  MK.logic.goals = { load, save, goals, getGoal, progress, isAchieved, currentStepId, addGoal, updateGoal, removeGoal, addStep, updateStep, toggleStep, removeStep, moveStep, dashboardData, exportData, importData, loadSample };
})();
