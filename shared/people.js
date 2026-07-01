/* 人の管理（People マスタ）spec §4.4 / §8 */
(function () {
  "use strict";
  const MK = window.MK;
  const NS = "people";

  function data() {
    const d = MK.store.read(NS);
    if (!d || !Array.isArray(d.members)) return { version: 1, members: [] };
    return d;
  }
  function persist(d) {
    MK.store.write(NS, d);
    MK.bus.emit("masters:changed", { domain: "people" });
  }

  const people = {
    all() { return data().members.slice(); },
    get(id) { return data().members.find((m) => m.id === id) || null; },

    create(attrs) {
      const d = data();
      const m = Object.assign(
        { id: MK.util.uid("m"), name: "", role: "", color: "", note: "", active: true },
        attrs || {}
      );
      if (!m.id) m.id = MK.util.uid("m");
      d.members.push(m);
      persist(d);
      return m;
    },

    update(id, patch) {
      const d = data();
      const m = d.members.find((x) => x.id === id);
      if (!m) return null;
      Object.assign(m, patch);
      persist(d);
      return m;
    },

    remove(id) {
      const d = data();
      d.members = d.members.filter((m) => m.id !== id);
      persist(d);
    },

    // 名寄せ: 照合キー完全一致の既存メンバーを返す（spec §8.3）
    resolve(name) {
      const key = MK.util.normalizeKey(name);
      if (!key) return null;
      return data().members.find((m) => MK.util.normalizeKey(m.name) === key) || null;
    },

    // MVP: 完全一致がなければ新規作成して id を返す（spec §8.4 自動作成）
    resolveOrCreate(name) {
      const found = this.resolve(name);
      if (found) return found.id;
      return this.create({ name: String(name).trim() }).id;
    },

    replaceAll(members) {
      persist({ version: 1, members: Array.isArray(members) ? members : [] });
    },
  };

  MK.people = people;
})();
