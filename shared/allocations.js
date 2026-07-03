/* アロケーション管理（共有マスタ）spec §3.7.5 / §4.4
   `人 × 器（Project/将来 Product）× 期間 × 割当%` の計画事実を、モジュールに属さない
   中立な共有マスタとして保持する。People / Projects と同格（別ストア mk:allocations、
   ctx.allocations 経由で参照・編集）。リソース（resource・旧 staffing）が編集・俯瞰し、workload には
   依存しない（Issue #45 で workload 内部データから昇格）。 */
(function () {
  "use strict";
  const MK = window.MK;
  const NS = "allocations";

  /**
   * 共有アロケーション1件。マネージャがトップダウンで planning する粗い計画事実（spec §3.7.5）。
   * WBS の担当（assigneeId）や workload のタスクとは**別レコード**で、片方から導出しない・
   * 片方を変えても他方に影響しない。
   * @typedef {Object} Allocation
   * @property {string} id - アロケーションID（"a" プレフィックス。旧 workload 由来は "wa")
   * @property {string|null} memberId - 対象メンバーID（People マスタ参照）
   * @property {string|null} targetId - 器のID（現状 Project マスタの id。次元は dim で識別）
   * @property {string} dim - 次元キー（器の種類。既定 "project"。将来 "product"。§3.7.6 の config 由来）
   * @property {string} startDate - 割当開始日（YYYY-MM-DD、未設定なら空文字）
   * @property {string} endDate - 割当終了日（YYYY-MM-DD、未設定なら空文字）
   * @property {number} percent - 割当率(%)
   * @property {string} note - 備考
   */

  function data() {
    const d = MK.store.read(NS);
    if (!d || !Array.isArray(d.allocations)) return { version: 1, allocations: [] };
    return d;
  }
  function persist(d) {
    MK.store.write(NS, d);
    MK.bus.emit("masters:changed", { domain: "allocations" });
  }

  const allocations = {
    all() { return data().allocations.slice(); },
    get(id) { return data().allocations.find((a) => a.id === id) || null; },
    /** 指定メンバーのアロケーション一覧。 */
    of(mid) { return data().allocations.filter((a) => a.memberId === mid); },
    /** 指定の器（Project 等）に紐づくアロケーション一覧。 */
    forTarget(targetId) { return data().allocations.filter((a) => a.targetId === targetId); },

    create(attrs) {
      const d = data();
      const a = Object.assign(
        { id: MK.util.uid("a"), memberId: null, targetId: null, dim: "project", startDate: "", endDate: "", percent: 50, note: "" },
        attrs || {}
      );
      if (!a.id) a.id = MK.util.uid("a");
      d.allocations.push(a);
      persist(d);
      return a;
    },

    update(id, patch) {
      const d = data();
      const a = d.allocations.find((x) => x.id === id);
      if (!a) return null;
      Object.assign(a, patch);
      persist(d);
      return a;
    },

    remove(id) {
      const d = data();
      d.allocations = d.allocations.filter((a) => a.id !== id);
      persist(d);
    },

    replaceAll(list) {
      persist({ version: 1, allocations: Array.isArray(list) ? list : [] });
    },

    /**
     * 指定メンバー・指定日の合計割当率を算出する純関数（器を跨いで percent を合算）。
     * 「空き要員 = 総キャパ − 全器へのアロケーション合計」の集計元（横断ビューが再利用）。
     * @param {Allocation[]} list - 対象アロケーション一覧
     * @param {string} mid - メンバーID
     * @param {string} date - 対象日（YYYY-MM-DD）
     * @returns {number} 合計割当率(%)
     */
    percentOn(list, mid, date) {
      let s = 0;
      (list || []).forEach((a) => {
        if (a.memberId !== mid) return;
        if (a.startDate && a.endDate && a.startDate <= date && date <= a.endDate) s += Number(a.percent) || 0;
      });
      return s;
    },

    /**
     * 旧 workload 内部データ（`mk:module:workload:v1`.allocations[]）を共有マスタへ一度だけ
     * 移設する（Issue #45 の昇格移行）。加算的・非破壊: 既存 id は上書きしない。移設後は
     * workload 側の allocations を除去して二重管理を避ける（冪等）。旧データが無ければ何もしない。
     * @returns {number} 移設した件数
     */
    migrateFromWorkload() {
      const w = MK.store.read("module:workload");
      if (!w || !Array.isArray(w.allocations) || !w.allocations.length) return 0;
      const d = data();
      const existing = {}; d.allocations.forEach((a) => (existing[a.id] = true));
      let moved = 0;
      w.allocations.forEach((a) => { if (a && a.id && !existing[a.id]) { d.allocations.push(a); moved++; } });
      persist(d);
      // 二重管理を避けるため、workload からアロケーションを取り除いて保存し直す（冪等化）。
      const cleaned = Object.assign({}, w); delete cleaned.allocations;
      MK.store.write("module:workload", cleaned);
      return moved;
    },
  };

  MK.allocations = allocations;
})();
