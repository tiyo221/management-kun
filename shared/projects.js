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

    // ---- CSV（DOM 非依存の純整形/取込。ファイル選択・DL はシェルの view 側）----
    /**
     * プロジェクトをCSV行データ（ヘッダ＋各行）に整形する。列は spec §4.6.1（プロジェクト）に対応。
     * @returns {string[][]} 2次元配列のCSV行データ
     */
    buildCSVRows() {
      const rows = [["プロジェクト名", "表示色", "状態", "備考"]];
      this.all().forEach((p) => rows.push([
        p.name, p.color || "", p.status === "archived" ? "archived" : "active", p.note || "",
      ]));
      return rows;
    },
    /**
     * CSV行データからプロジェクトを取り込み、全置換して保存する。プロジェクト名が空の行はスキップする。
     * 「状態」は archived / アーカイブ を archived、それ以外は active（既定）に正規化する。
     * @param {string[][]} rows - CSV行データ（1行目はヘッダ）
     * @returns {number} 取り込んだ件数
     * ※ store へ保存する副作用あり（全置換）。
     */
    applyCSV(rows) {
      const statusFromCSV = (v) => {
        const s = String(v == null ? "" : v).trim().toLowerCase();
        return (s === "archived" || s === "アーカイブ") ? "archived" : "active";
      };
      const body = rows.slice(1).filter((r) => r.length >= 1 && (r[0] || "").trim());
      const list = body.map((r) => ({
        id: MK.util.uid("p"), name: (r[0] || "").trim(), color: (r[1] || "").trim(),
        status: statusFromCSV(r[2]), note: (r[3] || "").trim(),
      }));
      this.replaceAll(list);
      return list.length;
    },
  };

  MK.projects = projects;
})();
