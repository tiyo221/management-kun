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

    // ---- CSV（DOM 非依存の純整形/取込。ファイル選択・DL はシェルの view 側）----
    /**
     * メンバーをCSV行データ（ヘッダ＋各行）に整形する。列は spec §4.6.1（人）に対応。
     * @returns {string[][]} 2次元配列のCSV行データ
     */
    buildCSVRows() {
      const rows = [["氏名", "役割", "表示色", "備考", "有効"]];
      this.all().forEach((m) => rows.push([
        m.name, m.role || "", m.color || "", m.note || "", m.active === false ? "false" : "true",
      ]));
      return rows;
    },
    /**
     * CSV行データからメンバーを取り込み、全置換して保存する。氏名が空の行はスキップする。
     * 「有効」は空/未指定は true、false/0/no/無効 を false と解釈する。
     * @param {string[][]} rows - CSV行データ（1行目はヘッダ）
     * @returns {number} 取り込んだ件数
     * ※ store へ保存する副作用あり（全置換）。
     */
    applyCSV(rows) {
      const FALSE = ["false", "0", "no", "無効"];
      const activeFromCSV = (v) => {
        const s = String(v == null ? "" : v).trim().toLowerCase();
        return s === "" ? true : FALSE.indexOf(s) < 0;
      };
      const body = rows.slice(1).filter((r) => r.length >= 1 && (r[0] || "").trim());
      const list = body.map((r) => ({
        id: MK.util.uid("m"), name: (r[0] || "").trim(), role: (r[1] || "").trim(),
        color: (r[2] || "").trim(), note: (r[3] || "").trim(), active: activeFromCSV(r[4]),
      }));
      this.replaceAll(list);
      return list.length;
    },
  };

  MK.people = people;
})();
