/* 需要（demand）管理（共有マスタ）spec §3.7.5 / §4.4
   `器（Project/将来 Product）× 期間 × 必要%` の需要事実を、モジュールに属さない中立な共有マスタ
   として保持する。People / Projects / Allocations と同格（別ストア mk:demands、ctx.demands 経由で
   参照・編集）。アロケーション（供給）と対の**需要**で、リソース（resource）が編集・俯瞰し
   「需要 vs 供給」の月次ギャップ＝いつまでに何人分確保が必要かを示す（Issue #68 / #52 Phase 2）。
   将来 wbs 見積り等から自動生成する場合も、生成器が本マスタへ**書き込む**方式にしモジュール独立を保つ。 */
(function () {
  "use strict";
  const MK = window.MK;
  const NS = "demands";

  /**
   * 共有需要1件。マネージャがトップダウンで見積もる粗い需要事実（§3.7.5）。
   * アロケーション（供給）や WBS のタスクとは**別レコード**で、片方から導出しない。
   * メンバー非依存（「この器がこの期間に何%＝何人分必要か」）。
   * @typedef {Object} Demand
   * @property {string} id - 需要ID（"d" プレフィックス）
   * @property {string|null} targetId - 器のID（現状 Project マスタの id。次元は dim で識別）
   * @property {string} dim - 次元キー（器の種類。既定 "project"。将来 "product"。§3.7.6 の config 由来）
   * @property {string} startDate - 需要開始日（YYYY-MM-DD、未設定なら空文字）
   * @property {string} endDate - 需要終了日（YYYY-MM-DD、未設定なら空文字）
   * @property {number} requiredPercent - 必要率(%)。100超可（複数人分の需要）
   * @property {string} note - 備考
   */

  function data() {
    const d = MK.store.read(NS);
    if (!d || !Array.isArray(d.demands)) return { version: 1, demands: [] };
    return d;
  }
  function persist(d) {
    MK.store.write(NS, d);
    MK.bus.emit("masters:changed", { domain: "demands" });
  }

  const demands = {
    all() { return data().demands.slice(); },
    get(id) { return data().demands.find((x) => x.id === id) || null; },
    /** 指定の器（Project 等）に紐づく需要一覧。 */
    forTarget(targetId) { return data().demands.filter((x) => x.targetId === targetId); },

    create(attrs) {
      const d = data();
      const x = Object.assign(
        { id: MK.util.uid("d"), targetId: null, dim: "project", startDate: "", endDate: "", requiredPercent: 100, note: "" },
        attrs || {}
      );
      if (!x.id) x.id = MK.util.uid("d");
      d.demands.push(x);
      persist(d);
      return x;
    },

    update(id, patch) {
      const d = data();
      const x = d.demands.find((y) => y.id === id);
      if (!x) return null;
      Object.assign(x, patch);
      persist(d);
      return x;
    },

    remove(id) {
      const d = data();
      d.demands = d.demands.filter((x) => x.id !== id);
      persist(d);
    },

    replaceAll(list) {
      persist({ version: 1, demands: Array.isArray(list) ? list : [] });
    },

    /**
     * 指定の器・指定日の必要率を合算する純関数（同一器に期間の重なる複数需要があれば合算）。
     * @param {Demand[]} list - 対象需要一覧
     * @param {string} targetId - 器のID
     * @param {string} date - 対象日（YYYY-MM-DD）
     * @returns {number} 必要率(%)
     */
    demandOn(list, targetId, date) {
      let s = 0;
      (list || []).forEach((x) => {
        if (x.targetId !== targetId) return;
        if (x.startDate && x.endDate && x.startDate <= date && date <= x.endDate) s += Number(x.requiredPercent) || 0;
      });
      return s;
    },

    /**
     * 指定日の全器合計必要率を返す純関数（器を跨いで requiredPercent を合算）。
     * 「需要 vs 供給」ギャップのチーム総需要の集計元。
     * @param {Demand[]} list - 対象需要一覧
     * @param {string} date - 対象日（YYYY-MM-DD）
     * @returns {number} 合計必要率(%)
     */
    totalDemandOn(list, date) {
      let s = 0;
      (list || []).forEach((x) => {
        if (x.startDate && x.endDate && x.startDate <= date && date <= x.endDate) s += Number(x.requiredPercent) || 0;
      });
      return s;
    },
  };

  MK.demands = demands;
})();
