/* モジュール resource（リソース＝要員計画）— ロジック（PJ横断のアサイン集約・空き要員・月次供給）。DOM/UI に触れない。CONVENTIONS §1
   People を主語に Project 次元を横断集約する cross ビュー（spec §3.7.5）。旧 staffing を発展させたもの（Issue #52）。
   データ源は中立な共有マスタ MK.allocations（供給）。将来 MK.demands（需要）と対で月次ギャップを見る。
   自前の永続データは持たず、マスタを参照・編集する。各モジュールの内部データ（WBS の担当 assigneeId 等）は
   覗かない＝モジュール独立を維持する。旧 workload の task ベース負荷には依存しない。 */
(function () {
  "use strict";
  const MK = window.MK;

  // 総キャパシティ既定値(%)。メンバー個別キャパのマスタは持たない（YAGNI）。空き＝キャパ − 全器割当合計。
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

  /**
   * 指定メンバー×指定器×指定日の割当率を合算する純関数（アサイン表の1セル）。
   * 同一メンバー・同一器に期間の重なる複数アロケーションがあれば合算する。
   * @param {Object[]} allocations - 対象アロケーション一覧
   * @param {string} mid - メンバーID
   * @param {string} targetId - 器のID
   * @param {string} date - 対象日（YYYY-MM-DD）
   * @returns {number} 割当率(%)
   */
  function cellPercent(allocations, mid, targetId, date) {
    let s = 0;
    (allocations || []).forEach((a) => {
      if (a.memberId !== mid || a.targetId !== targetId) return;
      if (a.startDate && a.endDate && a.startDate <= date && date <= a.endDate) s += Number(a.percent) || 0;
    });
    return s;
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
   * 指定メンバー・指定日の空き要員(%)を返す純関数（= キャパ − 全器合計割当）。
   * 過剰アサインを可視化するため負値はクランプしない（100超の割当は負の空きとして表れる）。
   * @param {Object[]} allocations - 対象アロケーション一覧
   * @param {string} mid - メンバーID
   * @param {string} date - 対象日（YYYY-MM-DD）
   * @param {number} [capacity] - 総キャパシティ(%)（既定 100）
   * @returns {number} 空き(%)（過剰アサイン時は負値）
   */
  function freeOn(allocations, mid, date, capacity) {
    const cap = capacity == null ? DEFAULT_CAPACITY : capacity;
    return cap - totalPercent(allocations, mid, date);
  }
  /**
   * 期間軸（週の月曜サンプル）での空き系列を返す純関数（#27「期間軸で算出・表示」）。
   * @param {Object[]} allocations - 対象アロケーション一覧
   * @param {string} mid - メンバーID
   * @param {string[]} weeks - 週開始日（月曜）の配列
   * @param {number} [capacity] - 総キャパシティ(%)（既定 100）
   * @returns {number[]} 週ごとの空き(%)
   */
  function freeSeries(allocations, mid, weeks, capacity) {
    return (weeks || []).map((w) => freeOn(allocations, mid, w, capacity));
  }

  /**
   * 指定日時点の PJ×メンバー アサイン俯瞰を算出する純関数（横断ビューの中核）。
   * @param {Object[]} allocations - 対象アロケーション一覧
   * @param {Array<Object>} memberList - メンバー一覧（People レコード）
   * @param {Target[]} targetList - 器の一覧
   * @param {string} date - 対象日（YYYY-MM-DD）
   * @param {number} [capacity] - 総キャパシティ(%)（既定 100）
   * @returns {{
   *   date: string, capacity: number,
   *   rows: {target: Target, cells: {memberId: string, percent: number}[], total: number}[],
   *   memberSummary: {member: Object, assigned: number, free: number, over: boolean}[]
   * }} 器別の割当行と、メンバー別の割当合計・空き
   */
  function overviewOn(allocations, memberList, targetList, date, capacity) {
    const cap = capacity == null ? DEFAULT_CAPACITY : capacity;
    const rows = (targetList || []).map((t) => {
      const cells = (memberList || []).map((m) => ({ memberId: m.id, percent: cellPercent(allocations, m.id, t.id, date) }));
      const total = cells.reduce((s, c) => s + c.percent, 0);
      return { target: t, cells, total };
    });
    const memberSummary = (memberList || []).map((m) => {
      const assigned = totalPercent(allocations, m.id, date);
      return { member: m, assigned, free: cap - assigned, over: assigned > cap };
    });
    return { date, capacity: cap, rows, memberSummary };
  }

  // ---- 月次集計（要員確保のリードタイムに合わせた粗い時間軸。Issue #52）----
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

  /**
   * 月次の供給（割当）とキャパを算出する純関数。各月の代表日で全メンバーの割当合計を集計する。
   * 「供給がキャパを超える月＝オーバーコミット」「空きが尽きる月」を導ける（早期警告）。
   * @param {Object[]} allocations - 対象アロケーション一覧
   * @param {Array<Object>} memberList - メンバー一覧
   * @param {string[]} months - 対象月（月初日）の配列
   * @param {number} [capacity] - メンバー1人あたり総キャパ(%)（既定 100）
   * @returns {{month: string, assigned: number, cap: number, free: number, overCount: number}[]}
   *   月ごとの総割当・総キャパ・空き（負なら供給超過）・過剰アサイン人数
   */
  function supplyByMonth(allocations, memberList, months, capacity) {
    const cap = capacity == null ? DEFAULT_CAPACITY : capacity;
    const totalCap = (memberList || []).length * cap;
    return (months || []).map((mo) => {
      const date = monthSample(mo);
      let assigned = 0, overCount = 0;
      (memberList || []).forEach((m) => {
        const a = totalPercent(allocations, m.id, date);
        assigned += a;
        if (a > cap) overCount++;
      });
      return { month: mo, assigned, cap: totalCap, free: totalCap - assigned, overCount };
    });
  }

  // ---- 需要 × 供給ギャップ（いつまでに何人分の確保が必要か。Issue #68 / #52 Phase 2）----
  // 需要（demand）は共有マスタ MK.demands の必要%、供給（supply）は allocations の割当合計（＝約束済み供給）。

  /**
   * 指定日の全器合計必要率(%)を返す（共有マスタの集計純関数へ委譲＝DRY・未ロード時はフォールバック）。
   * @param {Object[]} demands - 対象需要一覧
   * @param {string} date - 対象日（YYYY-MM-DD）
   * @returns {number} 合計必要率(%)
   */
  function totalDemand(demands, date) {
    if (MK.demands && typeof MK.demands.totalDemandOn === "function") return MK.demands.totalDemandOn(demands, date);
    let s = 0; (demands || []).forEach((x) => { if (x.startDate && x.endDate && x.startDate <= date && date <= x.endDate) s += Number(x.requiredPercent) || 0; }); return s;
  }
  /**
   * 指定日の約束済み供給(%)＝期間内アロケーションの割当合計（メンバー非依存の総 FTE%）を返す純関数。
   * @param {Object[]} allocations - 対象アロケーション一覧
   * @param {string} date - 対象日（YYYY-MM-DD）
   * @returns {number} 約束済み供給(%)
   */
  function committedSupply(allocations, date) {
    let s = 0;
    (allocations || []).forEach((a) => { if (a.startDate && a.endDate && a.startDate <= date && date <= a.endDate) s += Number(a.percent) || 0; });
    return s;
  }
  /**
   * 月次の総需要を算出する純関数（各月の代表日で全器の必要%を合算）。
   * @param {Object[]} demands - 対象需要一覧
   * @param {string[]} months - 対象月（月初日）の配列
   * @returns {{month: string, demand: number}[]} 月ごとの総需要
   */
  function demandByMonth(demands, months) {
    return (months || []).map((mo) => ({ month: mo, demand: totalDemand(demands, monthSample(mo)) }));
  }
  /**
   * 月次の「需要 vs 供給」ギャップを算出する純関数。gap = 需要 − 約束済み供給。
   * gap > 0 の月は供給不足＝その月までに確保が必要（確保デッドライン）。
   * @param {Object[]} allocations - 対象アロケーション一覧（供給）
   * @param {Object[]} demands - 対象需要一覧
   * @param {string[]} months - 対象月（月初日）の配列
   * @returns {{month: string, demand: number, supply: number, gap: number, short: boolean}[]}
   *   月ごとの需要・供給・ギャップ（正なら不足）・不足フラグ
   */
  function gapByMonth(allocations, demands, months) {
    return (months || []).map((mo) => {
      const date = monthSample(mo);
      const demand = totalDemand(demands, date);
      const supply = committedSupply(allocations, date);
      const gap = demand - supply;
      return { month: mo, demand, supply, gap, short: gap > 0 };
    });
  }

  /**
   * HOME ダッシュボード用のサマリーを算出する（spec §3.6）。
   * 本日時点の各メンバーの空きをチーム平均し、過剰アサイン（割当 > キャパ）人数を数える。
   * データ源のアロケーションが皆無なら empty=true。
   * @returns {{empty: boolean, stats: {label: string, value: (string|number)}[]}}
   */
  function summary() {
    const list = alloc(), mem = members(), today = MK.util.todayISO(), cap = DEFAULT_CAPACITY;
    let freeSum = 0, over = 0;
    mem.forEach((m) => { const assigned = totalPercent(list, m.id, today); freeSum += cap - assigned; if (assigned > cap) over++; });
    const avgFree = mem.length ? Math.round(freeSum / mem.length) : 0;
    return { empty: !list.length, stats: [
      { label: "平均空き", value: avgFree + "%" },
      { label: "過剰アサイン", value: over },
    ] };
  }

  MK.logic = MK.logic || {};
  MK.logic.resource = { DEFAULT_CAPACITY, alloc, demandsAll, members, targets, capacityOf, cellPercent, totalPercent, freeOn, freeSeries, overviewOn, monthsInHorizon, monthSample, supplyByMonth, totalDemand, committedSupply, demandByMonth, gapByMonth, summary };
})();
