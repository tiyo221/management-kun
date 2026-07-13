/* 人の管理（People マスタ）spec §4.4 / §8 */
(function () {
  "use strict";
  const MK = window.MK;

  // CRUD 骨格・名寄せは共通ファクトリから供給し（Issue #185・spec §4.4.1）、CSV だけ足す。
  const people = MK.masters.define("people", {
    collKey: "members",
    prefix: "m",
    resolvable: true,
    defaults: { name: "", role: "", color: "", note: "", active: true },
  });

  Object.assign(people, {
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
  });

  MK.people = people;
})();
