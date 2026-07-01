/* プロジェクト管理（Project マスタ）spec §4.4 / §8 */
(function () {
  "use strict";
  const MK = window.MK;
  const NS = "projects";

  function data() {
    const d = MK.store.read(NS);
    if (!d || !Array.isArray(d.projects)) return { version: 1, projects: [] };
    return d;
  }
  function persist(d) {
    MK.store.write(NS, d);
    MK.bus.emit("masters:changed", { domain: "projects" });
  }

  const projects = {
    all() { return data().projects.slice(); },
    get(id) { return data().projects.find((p) => p.id === id) || null; },

    create(attrs) {
      const d = data();
      const p = Object.assign(
        { id: MK.util.uid("p"), name: "", color: "", status: "active", note: "" },
        attrs || {}
      );
      if (!p.id) p.id = MK.util.uid("p");
      d.projects.push(p);
      persist(d);
      return p;
    },

    update(id, patch) {
      const d = data();
      const p = d.projects.find((x) => x.id === id);
      if (!p) return null;
      Object.assign(p, patch);
      persist(d);
      return p;
    },

    remove(id) {
      const d = data();
      d.projects = d.projects.filter((p) => p.id !== id);
      persist(d);
    },

    // 名寄せ（spec §8.3）
    resolve(name) {
      const key = MK.util.normalizeKey(name);
      if (!key) return null;
      return data().projects.find((p) => MK.util.normalizeKey(p.name) === key) || null;
    },

    // MVP: 完全一致がなければ新規作成して id を返す（spec §8.4）
    resolveOrCreate(name) {
      if (!name || !String(name).trim()) return null;
      const found = this.resolve(name);
      if (found) return found.id;
      return this.create({ name: String(name).trim() }).id;
    },

    replaceAll(list) {
      persist({ version: 1, projects: Array.isArray(list) ? list : [] });
    },
  };

  MK.projects = projects;
})();
