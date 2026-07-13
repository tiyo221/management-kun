/* プロジェクト管理（Project マスタ）spec §4.4 / §8 */
(function () {
  "use strict";
  const MK = window.MK;

  /**
   * プロジェクトの状態（ステータス）定義。key＝内部値、label＝表示名。表示順もこの配列順に従う。
   * shell.js（マスタ編集・一覧）／dashboard（基本情報カード）はこの公開定義を参照する（単一ソース。Issue #105）。
   * @typedef {Object} Status
   * @property {string} key - 内部キー（"active" | "archived"）
   * @property {string} label - 画面表示名
   */
  const STATUSES = [
    { key: "active", label: "進行中" },
    { key: "archived", label: "アーカイブ" },
  ];

  /**
   * status キーを表示ラベルへ変換する純関数（未知・空はキーをそのまま返す）。
   * @param {string} key - ステータスキー
   * @returns {string} 表示ラベル
   */
  function statusLabel(key) {
    const s = STATUSES.find((x) => x.key === key);
    return s ? s.label : (key || "");
  }

  // CRUD 骨格・名寄せは共通ファクトリから供給し（Issue #185・spec §4.4.1）、STATUSES と CSV だけ足す。
  const projects = MK.masters.define("projects", {
    collKey: "projects",
    prefix: "p",
    resolvable: true,
    defaults: { name: "", color: "", status: "active", note: "" },
  });

  Object.assign(projects, {
    STATUSES,
    statusLabel,

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
  });

  MK.projects = projects;
})();
