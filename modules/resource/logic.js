/* モジュール resource（リソース＝要員計画）— ロジック（人単位×3つの意思決定）。DOM/UI に触れない。CONVENTIONS §1
   People を主語に Project 次元を横断集約する cross ビュー（spec §3.7.5）。旧 staffing を発展させたもの（Issue #52）。
   マネージャの3つの問い「① あと何人足りない？ ② 外注が要る？ ③ メンバーの負担は大丈夫？」に月次で答える（Issue #71）。
   主単位は人（FTE、1人＝100%）。データ源は中立な共有マスタ MK.allocations（供給）と MK.demands（需要）。
   自前の永続データは持たず、マスタを参照・編集する。各モジュールの内部データ（WBS の担当 assigneeId 等）は
   覗かない＝モジュール独立を維持する。旧 workload の task ベース負荷には依存しない。 */
(function () {
  "use strict";
  const MK = window.MK;

  // 総キャパシティ既定値(%)＝1人分。メンバー個別キャパのマスタは持たない（YAGNI）。
  const DEFAULT_CAPACITY = 100;

  /**
   * 器（Project 等）1件の表示情報。次元 config を回して集めるためコードで "project" を決め打ちしない（§3.7.6）。
   * @typedef {Object} Target
   * @property {string} id - 器のID（対象マスタの id）
   * @property {string} name - 表示名
   * @property {string} dim - 次元キー（既定 "project"・将来 "product"）
   */

  /**
   * データ源＝共有マスタ MK.allocations のアロケーション一覧を返す（横断ビューの唯一の読み取り入口。§3.7.5）。
   * マスタ未ロード時は空配列（HOME 等での安全なフォールバック）。
   * @returns {Object[]} アロケーション一覧（Allocation 形状）
   */
  function alloc() { return MK.allocations ? MK.allocations.all() : []; }
  /**
   * データ源＝共有マスタ MK.demands の需要一覧を返す（未ロード時は空配列）。
   * @returns {Object[]} 需要一覧（Demand 形状）
   */
  function demandsAll() { return MK.demands ? MK.demands.all() : []; }
  /**
   * 対象メンバー一覧を People マスタから返す（横断参照。scope で縛らない。§3.7.3）。
   * @returns {Array<Object>} メンバー一覧（MK.people のレコード）
   */
  function members() { return MK.people.all(); }
  /**
   * 全次元の器（Project 等）を平坦化して返す。次元 config（MK_CONFIG.dimensions）を回すため "project" 決め打ちしない。
   * @returns {Target[]} 器の一覧（対象マスタ 0 件なら空配列）
   */
  function targets() {
    const list = [];
    ((MK.scope && MK.scope.dims()) || []).forEach((dim) => {
      const master = MK.scope.master(dim);
      if (master && typeof master.all === "function") master.all().forEach((e) => list.push({ id: e.id, name: e.name || "(無題)", dim: dim.dim }));
    });
    return list;
  }
  /**
   * 総キャパシティ(%)を返す（現状は既定値の定数。将来メンバー個別化する場合の拡張点）。
   * @param {string} [mid] - メンバーID（現状未使用）
   * @returns {number} 総キャパシティ(%)
   */
  function capacityOf(mid) { return DEFAULT_CAPACITY; } // eslint-disable-line no-unused-vars

  // ---- 人単位換算（FTE。1人＝100%。Issue #71）----
  // 「需要200% / 供給110%」の頭の中の変換をツール側が肩代わりする。主表記は人、% は補助。

  /**
   * %を人数（FTE）へ換算した表示ラベルを返す純関数（小数1桁へ丸め）。例: 90 → "0.9人"、200 → "2.0人"。
   * @param {number} percent - 割当・需要などの率(%)。負値可（-20 → "-0.2人"）
   * @returns {string} 人数ラベル（例 "0.9人"）
   */
  function fteLabel(percent) {
    const tenths = Math.round((Number(percent) || 0) / 10); // 0.1人単位へ丸める（例 90% → 9、85% → 9）
    return (tenths / 10).toFixed(1) + "人";
  }

  /**
   * 指定メンバー・指定日の全器合計割当率を返す純関数（共有マスタの集計純関数へ委譲＝DRY）。
   * @param {Object[]} allocations - 対象アロケーション一覧
   * @param {string} mid - メンバーID
   * @param {string} date - 対象日（YYYY-MM-DD）
   * @returns {number} 合計割当率(%)
   */
  function totalPercent(allocations, mid, date) {
    if (MK.allocations && typeof MK.allocations.percentOn === "function") return MK.allocations.percentOn(allocations, mid, date);
    // フォールバック（マスタ未ロード時）: 全器を跨いで合算する
    let s = 0; (allocations || []).forEach((a) => { if (a.memberId !== mid) return; if (a.startDate && a.endDate && a.startDate <= date && date <= a.endDate) s += Number(a.percent) || 0; }); return s;
  }
  /**
   * 指定メンバー・指定日の空き(%)を返す純関数（= キャパ − 全器合計割当）。
   * 過負担を可視化するため負値はクランプしない（100超の割当は負の空きとして表れる）。
   * @param {Object[]} allocations - 対象アロケーション一覧
   * @param {string} mid - メンバーID
   * @param {string} date - 対象日（YYYY-MM-DD）
   * @param {number} [capacity] - 総キャパシティ(%)（既定 100）
   * @returns {number} 空き(%)（過負担時は負値）
   */
  function freeOn(allocations, mid, date, capacity) {
    const cap = capacity == null ? DEFAULT_CAPACITY : capacity;
    return cap - totalPercent(allocations, mid, date);
  }

  // ---- 月次の時間軸（要員確保のリードタイムに合わせた粗い時間軸。Issue #52）----
  // 週次は凸凹が細かすぎ「見えても確保が間に合わない」ため、月次×長ホライズンで先まで見せる。

  // 1ヶ月あたりの平均週数（365.25 / 12 / 7 ≒ 4.345）。ホライズンの週数を月数へ丸める係数。
  const WEEKS_PER_MONTH = 4.345;

  /**
   * 表示ホライズン（週数）を月次に丸め、対象月（各月1日）の配列を返す純関数。
   * 週数 period を約4.345週/月で月数へ変換し、基準月を起点に offset 月ずらす。
   * @param {number} period - ホライズンの週数（13/26/52 等）
   * @param {number} [offset] - 基準月からの月オフセット（既定 0）
   * @param {string} [baseDate] - 基準日（YYYY-MM-DD、既定 本日）。テストで固定するための注入点。
   * @returns {string[]} 各月の初日（YYYY-MM-01）の配列
   */
  function monthsInHorizon(period, offset, baseDate) {
    const count = Math.max(1, Math.round((period || 13) / WEEKS_PER_MONTH));
    const base = baseDate || MK.util.todayISO();
    const y = Number(base.slice(0, 4)), m = Number(base.slice(5, 7));
    const arr = [];
    for (let i = 0; i < count; i++) {
      // 年初からの 0-based 月インデックス。負 offset でも floor 除算で年へ桁上がり／桁下がりする。
      const idx = (m - 1) + (offset || 0) + i;
      const yy = y + Math.floor(idx / 12);
      const mm = ((idx % 12) + 12) % 12 + 1;               // 0..11 へ正規化してから 1..12 に戻す（負値対応）
      arr.push(yy + "-" + String(mm).padStart(2, "0") + "-01");
    }
    return arr;
  }
  /**
   * 指定月の代表サンプル日（15日）を返す。月次の在籍判定に用いる（月中に一点サンプル）。
   * @param {string} monthFirst - 月初日（YYYY-MM-01）
   * @returns {string} サンプル日（YYYY-MM-15）
   */
  function monthSample(monthFirst) { return monthFirst.slice(0, 8) + "15"; }

  // ---- ① あと何人足りない？（PJ別・月別の不足人数。Issue #71）----

  /**
   * 指定の器・指定日の必要率(%)を返す（共有マスタの集計純関数へ委譲＝DRY・未ロード時はフォールバック）。
   * @param {Object[]} demands - 対象需要一覧
   * @param {string} targetId - 器のID
   * @param {string} date - 対象日（YYYY-MM-DD）
   * @returns {number} 必要率(%)
   */
  function targetDemandOn(demands, targetId, date) {
    if (MK.demands && typeof MK.demands.demandOn === "function") return MK.demands.demandOn(demands, targetId, date);
    let s = 0; (demands || []).forEach((x) => { if (x.targetId !== targetId) return; if (x.startDate && x.endDate && x.startDate <= date && date <= x.endDate) s += Number(x.requiredPercent) || 0; }); return s;
  }
  /**
   * 指定の器・指定日の確保済み供給(%)＝その器への期間内アロケーション合計を返す純関数。
   * @param {Object[]} allocations - 対象アロケーション一覧
   * @param {string} targetId - 器のID
   * @param {string} date - 対象日（YYYY-MM-DD）
   * @returns {number} 確保済み供給(%)
   */
  function targetSupplyOn(allocations, targetId, date) {
    let s = 0;
    (allocations || []).forEach((a) => { if (a.targetId !== targetId) return; if (a.startDate && a.endDate && a.startDate <= date && date <= a.endDate) s += Number(a.percent) || 0; });
    return s;
  }
  /**
   * PJ別×月別の不足（需要 − 確保済み供給）を一括算出する純関数（問い①の中核）。
   * totals の不足合計は「不足している器の gap だけ」を足す（他 PJ の余剰で不足は相殺されない）。
   * @param {Object[]} allocations - 対象アロケーション一覧（供給）
   * @param {Object[]} demands - 対象需要一覧
   * @param {Target[]} targetList - 器の一覧
   * @param {string[]} months - 対象月（月初日）の配列
   * @returns {{
   *   rows: {target: Target, cells: {month: string, demand: number, supply: number, gap: number, short: boolean}[], anyShort: boolean}[],
   *   totals: {month: string, shortage: number, short: boolean}[]
   * }} 器ごとの月次セル（gap = 需要 − 供給、正なら不足）と、月ごとの不足合計
   */
  function shortageMatrix(allocations, demands, targetList, months) {
    const rows = (targetList || []).map((t) => {
      const cells = (months || []).map((mo) => {
        const date = monthSample(mo);
        const demand = targetDemandOn(demands, t.id, date);
        const supply = targetSupplyOn(allocations, t.id, date);
        const gap = demand - supply;
        return { month: mo, demand, supply, gap, short: gap > 0 };
      });
      return { target: t, cells, anyShort: cells.some((c) => c.short) };
    });
    const totals = (months || []).map((mo, i) => {
      const shortage = rows.reduce((s, r) => s + Math.max(0, r.cells[i].gap), 0);
      return { month: mo, shortage, short: shortage > 0 };
    });
    return { rows, totals };
  }

  // ---- ② 外注が要る？（不足をチームの空き要員で吸収できるか。Issue #71）----

  /**
   * 指定日のチームの空き要員(%)合計を返す純関数。メンバーごとの空きを 0 で下限クランプして合算する
   * （過負担メンバーの負の空きは、他の不足を埋める原資にならないため）。
   * @param {Object[]} allocations - 対象アロケーション一覧
   * @param {Array<Object>} memberList - メンバー一覧
   * @param {string} date - 対象日（YYYY-MM-DD）
   * @param {number} [capacity] - メンバー1人あたり総キャパ(%)（既定 100）
   * @returns {number} チームの空き(%)合計
   */
  function teamFreeOn(allocations, memberList, date, capacity) {
    const cap = capacity == null ? DEFAULT_CAPACITY : capacity;
    let s = 0;
    (memberList || []).forEach((m) => { s += Math.max(0, cap - totalPercent(allocations, m.id, date)); });
    return s;
  }
  /**
   * 月ごとの外注要否を判定する純関数（問い②の中核）。「不足（①の合計）をチームの空き要員で
   * 吸収できるか」を月次で判定し、吸収しきれない分＝外注候補として返す。
   * @param {Object[]} allocations - 対象アロケーション一覧（供給）
   * @param {Object[]} demands - 対象需要一覧
   * @param {Target[]} targetList - 器の一覧
   * @param {Array<Object>} memberList - メンバー一覧
   * @param {string[]} months - 対象月（月初日）の配列
   * @param {number} [capacity] - メンバー1人あたり総キャパ(%)（既定 100）
   * @returns {{month: string, shortage: number, internalFree: number, absorbed: number, outsource: number, needsOutsource: boolean}[]}
   *   月ごとの不足・チームの空き・内部吸収可能分・外注候補（%）・外注要否フラグ
   */
  function outsourcingByMonth(allocations, demands, targetList, memberList, months, capacity) {
    const totals = shortageMatrix(allocations, demands, targetList, months).totals;
    return totals.map((t) => {
      const internalFree = teamFreeOn(allocations, memberList, monthSample(t.month), capacity);
      const absorbed = Math.min(t.shortage, internalFree);
      const outsource = Math.max(0, t.shortage - internalFree);
      return { month: t.month, shortage: t.shortage, internalFree, absorbed, outsource, needsOutsource: outsource > 0 };
    });
  }

  // ---- ③ メンバーの負担は大丈夫？（割当が1人分を超えるメンバー。Issue #71）----

  /**
   * メンバー別×月別の負荷（全器合計割当）を一括算出する純関数（問い③の中核）。
   * 割当がキャパ（1人分＝100%）を超える月を over=true で返す。
   * @param {Object[]} allocations - 対象アロケーション一覧
   * @param {Array<Object>} memberList - メンバー一覧
   * @param {string[]} months - 対象月（月初日）の配列
   * @param {number} [capacity] - メンバー1人あたり総キャパ(%)（既定 100）
   * @returns {{member: Object, cells: {month: string, assigned: number, over: boolean, overBy: number}[], peak: number, anyOver: boolean}[]}
   *   メンバーごとの月次割当・超過フラグ・超過分(%)・ピーク割当
   */
  function memberLoadByMonth(allocations, memberList, months, capacity) {
    const cap = capacity == null ? DEFAULT_CAPACITY : capacity;
    return (memberList || []).map((m) => {
      const cells = (months || []).map((mo) => {
        const assigned = totalPercent(allocations, m.id, monthSample(mo));
        return { month: mo, assigned, over: assigned > cap, overBy: Math.max(0, assigned - cap) };
      });
      return { member: m, cells, peak: cells.reduce((s, c) => Math.max(s, c.assigned), 0), anyOver: cells.some((c) => c.over) };
    });
  }

  /**
   * HOME ダッシュボード用のサマリーを算出する（spec §3.6）。主表記は人（FTE。Issue #71）。
   * 本日時点のチームの空き要員（人）と、過負担（割当 > 1人分）のメンバー数を返す。
   * データ源のアロケーションが皆無なら empty=true。
   * @returns {{empty: boolean, stats: {label: string, value: (string|number)}[]}}
   */
  function summary() {
    const list = alloc(), mem = members(), today = MK.util.todayISO(), cap = DEFAULT_CAPACITY;
    let over = 0;
    mem.forEach((m) => { if (totalPercent(list, m.id, today) > cap) over++; });
    return { empty: !list.length, stats: [
      { label: "空き要員", value: fteLabel(teamFreeOn(list, mem, today, cap)) },
      { label: "過負担", value: over + "人" },
    ] };
  }

  MK.logic = MK.logic || {};
  MK.logic.resource = { DEFAULT_CAPACITY, alloc, demandsAll, members, targets, capacityOf, fteLabel, totalPercent, freeOn, monthsInHorizon, monthSample, targetDemandOn, targetSupplyOn, shortageMatrix, teamFreeOn, outsourcingByMonth, memberLoadByMonth, summary };
})();
