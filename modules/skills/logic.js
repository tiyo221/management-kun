/* モジュール skills — ロジック（データ・計算・CSV整形/取込）。DOM/UI に触れない。CONVENTIONS §1 */
(function () {
  "use strict";
  const MK = window.MK;
  const store = MK.store.scope("module:skills");

  function load() { const d = store.get(); if (!d || !Array.isArray(d.skills)) return { version: 1, skills: [], ratings: {} }; if (!d.ratings) d.ratings = {}; return d; }
  function save(d) { store.set(d); }
  function skills() { return load().skills; }
  function visibleSkills() { return skills().filter((s) => s.visible !== false); }
  function members() { return MK.people.all(); }

  function rating(mid, sid) { const v = load().ratings[mid + ":" + sid]; return v == null ? "" : v; }
  function setRating(mid, sid, val) { const d = load(); if (val === "" || val == null) delete d.ratings[mid + ":" + sid]; else d.ratings[mid + ":" + sid] = val; save(d); }

  function domainsOrder(list) { const seen = []; list.forEach((s) => { if (seen.indexOf(s.domain) < 0) seen.push(s.domain); }); return seen; }
  function numericRatings(sid) { return members().map((m) => rating(m.id, sid)).filter((v) => v && v !== "-").map(Number); }
  function avgLevel(sid) { const a = numericRatings(sid); return a.length ? (a.reduce((x, y) => x + y, 0) / a.length) : 0; }
  function countAtLeast(sid, th) { return numericRatings(sid).filter((v) => v >= th).length; }
  function gapOf(s) {
    if (s.targetLevel == null || s.requiredCount == null) return { state: "unset" };
    const sufficient = members().map((m) => rating(m.id, s.id)).filter((v) => v && v !== "-").map(Number).filter((v) => v >= s.targetLevel).length;
    const shortage = Math.max(0, s.requiredCount - sufficient);
    return { state: shortage > 0 ? "short" : "ok", sufficient, shortage, required: s.requiredCount, target: s.targetLevel };
  }
  function clampLv(v) { let n = parseInt(v, 10); if (isNaN(n)) n = 1; return Math.max(1, Math.min(5, n)); }

  function addSkill(attrs) { const d = load(); d.skills.push(Object.assign({ id: MK.util.uid("sk"), domain: "", item: "", description: "", visible: true, core: false, targetLevel: null, requiredCount: null }, attrs || {})); save(d); }
  function updateSkill(id, patch) { const d = load(); const s = d.skills.find((x) => x.id === id); if (s) Object.assign(s, patch); save(d); }
  function removeSkill(id) { const d = load(); d.skills = d.skills.filter((s) => s.id !== id); Object.keys(d.ratings).forEach((k) => { if (k.split(":")[1] === id) delete d.ratings[k]; }); save(d); }

  // ---- CSV（整形・取込はロジック。ファイル選択/DLは view）----
  function buildSkillsCSVRows() {
    const rows = [["大分類", "中分類", "小分類", "コア", "目標レベル", "必要人数", "表示"]];
    skills().forEach((s) => rows.push([s.domain, s.item, s.description, s.core ? "true" : "false", s.targetLevel != null ? s.targetLevel : "", s.requiredCount != null ? s.requiredCount : "", s.visible !== false ? "true" : "false"]));
    return rows;
  }
  function applySkillsCSV(rows) {
    const truthy = (v) => /^(true|1|○|コア|表示|yes)$/i.test(String(v).trim());
    const body = rows.slice(1).filter((r) => r.length >= 2 && (r[0] || r[1]));
    const d = load();
    d.skills = body.map((r) => ({
      id: MK.util.uid("sk"), domain: (r[0] || "").trim(), item: (r[1] || "").trim(), description: (r[2] || "").trim(),
      core: truthy(r[3]), targetLevel: r[4] !== "" && r[4] != null ? clampLv(r[4]) : null,
      requiredCount: r[5] !== "" && r[5] != null ? Math.max(0, parseInt(r[5], 10) || 0) : null,
      visible: r[6] == null || r[6] === "" ? true : truthy(r[6]),
    }));
    d.ratings = {}; // スキル置換に伴い評価は孤児化
    save(d);
    return body.length;
  }
  function buildRatingsCSVRows() {
    const rows = [["メンバー名", "大分類", "中分類", "値"]];
    const d = load();
    members().forEach((m) => skills().forEach((s) => { const v = d.ratings[m.id + ":" + s.id]; if (v && v !== "") rows.push([m.name, s.domain, s.item, v]); }));
    return rows;
  }
  function applyRatingsCSV(rows) {
    const d = load(); let ok = 0, skip = 0;
    rows.slice(1).forEach((r) => {
      if (r.length < 4) return;
      const m = MK.people.resolve(r[0]);
      const s = d.skills.find((x) => MK.util.normalizeKey(x.domain) === MK.util.normalizeKey(r[1]) && MK.util.normalizeKey(x.item) === MK.util.normalizeKey(r[2]));
      const val = String(r[3]).trim();
      if (!m || !s || (val !== "-" && !/^[1-5]$/.test(val))) { skip++; return; }
      d.ratings[m.id + ":" + s.id] = val; ok++;
    });
    save(d);
    return { ok, skip };
  }

  function exportData() { return load(); }
  function importData(data, mode) {
    if (mode === "merge") {
      const d = load(); const byId = {}; d.skills.forEach((s) => (byId[s.id] = s));
      (data.skills || []).forEach((s) => (byId[s.id] = s));
      d.skills = Object.keys(byId).map((k) => byId[k]);
      Object.assign(d.ratings, data.ratings || {}); save(d);
    } else { save({ version: 1, skills: (data && data.skills) || [], ratings: (data && data.ratings) || {} }); }
  }
  function loadSample() {
    const d = { version: 1, skills: [], ratings: {} };
    const mk = (domain, item, description, opts) => Object.assign({ id: MK.util.uid("sk"), domain, item, description, visible: true, core: false, targetLevel: null, requiredCount: null }, opts || {});
    const s1 = mk("Web/アプリ", "バックエンド実装・設計", "サーバーサイドの設計・実装", { core: true, targetLevel: 3, requiredCount: 2 });
    const s2 = mk("Web/アプリ", "フロントエンド実装", "画面側の実装", { core: true, targetLevel: 3, requiredCount: 2 });
    const s3 = mk("Web/アプリ", "UI/UXデザイン", "画面設計・デザイン");
    const s4 = mk("マネジメント", "プロジェクト管理", "進行・調整", { core: true, targetLevel: 4, requiredCount: 1 });
    const s5 = mk("マネジメント", "メンバー育成", "1on1・コーチング");
    d.skills = [s1, s2, s3, s4, s5];
    const sato = MK.people.resolveOrCreate("佐藤 花子"), suzuki = MK.people.resolveOrCreate("鈴木 一郎"), tanaka = MK.people.resolveOrCreate("田中 美咲"), taka = MK.people.resolveOrCreate("高橋 健");
    const set = (mid, sid, v) => { d.ratings[mid + ":" + sid] = v; };
    set(suzuki, s1.id, "4"); set(taka, s1.id, "3"); set(sato, s1.id, "2");
    set(taka, s2.id, "4"); set(suzuki, s2.id, "3"); set(tanaka, s2.id, "2");
    set(tanaka, s3.id, "5"); set(sato, s3.id, "2");
    set(sato, s4.id, "4"); set(suzuki, s4.id, "2");
    set(sato, s5.id, "3"); set(tanaka, s5.id, "-");
    save(d);
  }

  MK.logic = MK.logic || {};
  MK.logic.skills = { load, save, skills, visibleSkills, members, rating, setRating, domainsOrder, avgLevel, countAtLeast, gapOf, clampLv, addSkill, updateSkill, removeSkill, buildSkillsCSVRows, applySkillsCSV, buildRatingsCSVRows, applyRatingsCSV, exportData, importData, loadSample };
})();
