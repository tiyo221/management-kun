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

  // ---- ロール（役割）計画（Issue #134）----
  // ロール = 自由文字列（People.role と同じ語彙。新マスタは作らない＝YAGNI）。需要に role（任意）を持たせ、
  // 「器 × ロール」で不足を出す。供給（アサイン）はメンバー基準のまま、供給のロールは member.role から
  // 導出する（allocation にロールは保存しない＝マスタを汚さない）。マッチングは正規化後の完全一致。

  /**
   * ロール名を照合用に正規化する純関数（前後空白除去＋小文字化）。自由文字列のため完全一致で照合する。
   * People.role「エンジニア」と需要「バックエンドエンジニア」は正規化しても別物＝別ロール扱い（Issue #134）。
   * @param {string} s - ロール名（未設定可）
   * @returns {string} 正規化済みロールキー（空＝役割を問わない）
   */
  function normRole(s) { return String(s == null ? "" : s).trim().toLowerCase(); }
  /**
   * メンバーID → 正規化ロールの対応表を作る純関数（供給のロールを member.role から導出するため）。
   * @param {Array<Object>} memberList - メンバー一覧
   * @returns {Object} memberId をキー・正規化ロールを値とするマップ
   */
  function buildRoleMap(memberList) {
    const map = {};
    (memberList || []).forEach((m) => { map[m.id] = normRole(m.role); });
    return map;
  }
  /**
   * 指定の器の需要で使われているロールを重複排除して返す純関数（正規化キーで一意化・原文ラベルを保持）。
   * 器×ロールの行を組み立てるための素材。ロール未設定（空）の需要は norm="" の1グループにまとまる。
   * @param {Object[]} demands - 対象需要一覧
   * @param {string} targetId - 器のID
   * @returns {{norm: string, label: string}[]} ロール一覧（norm＝照合キー、label＝表示名。空ロールは {norm:"",label:""}）
   */
  function rolesForTarget(demands, targetId) {
    const seen = {}, out = [];
    (demands || []).forEach((d) => {
      if (d.targetId !== targetId) return;
      const norm = normRole(d.role);
      if (Object.prototype.hasOwnProperty.call(seen, norm)) return;
      seen[norm] = 1;
      out.push({ norm, label: norm === "" ? "" : String(d.role).trim() });
    });
    return out;
  }
  /**
   * 指定の器・指定ロール・指定日の需要率(%)を合算する純関数。
   * @param {Object[]} demands - 対象需要一覧
   * @param {string} targetId - 器のID
   * @param {string} roleNorm - 正規化ロール（空＝役割を問わない需要）
   * @param {string} date - 対象日（YYYY-MM-DD）
   * @returns {number} 必要率(%)
   */
  function targetDemandByRole(demands, targetId, roleNorm, date) {
    let s = 0;
    (demands || []).forEach((x) => {
      if (x.targetId !== targetId || normRole(x.role) !== roleNorm) return;
      if (x.startDate && x.endDate && x.startDate <= date && date <= x.endDate) s += Number(x.requiredPercent) || 0;
    });
    return s;
  }
  /**
   * 指定の器・指定ロール・指定日の確保済み供給(%)を返す純関数。供給のロールは割り当てられたメンバーの
   * role から導出する（roleOf マップ）。ロール空（役割を問わない需要）はメンバーのロールを問わず器全体の供給。
   * @param {Object[]} allocations - 対象アロケーション一覧
   * @param {string} targetId - 器のID
   * @param {string} roleNorm - 正規化ロール（空＝器全体＝targetSupplyOn と等価）
   * @param {string} date - 対象日（YYYY-MM-DD）
   * @param {Object} roleOf - memberId → 正規化ロールのマップ
   * @returns {number} 確保済み供給(%)
   */
  function targetSupplyByRole(allocations, targetId, roleNorm, date, roleOf) {
    if (roleNorm === "") return targetSupplyOn(allocations, targetId, date);
    const map = roleOf || {};
    let s = 0;
    (allocations || []).forEach((a) => {
      if (a.targetId !== targetId || map[a.memberId] !== roleNorm) return;
      if (a.startDate && a.endDate && a.startDate <= date && date <= a.endDate) s += Number(a.percent) || 0;
    });
    return s;
  }

  /**
   * 器×ロール別×月別の不足（需要 − 確保済み供給）を一括算出する純関数（問い①の中核。Issue #71 / ロール対応 #134）。
   * 需要にロールがあれば「器 × ロール」の行に分割し、供給はそのロールに属するメンバー（member.role 由来）の
   * 割当のみで賄う。役割ミスマッチ（例: デザイナーを backend 枠に）は不足として残る。ロール未使用（空）の需要は
   * 器全体の供給で賄う従来挙動に縮退する（後方互換）。需要が1件も無い器も1行（demand=0）で表示する。
   * totals の不足合計は「不足している行の gap だけ」を足す（余剰で不足は相殺されない）。
   * @param {Object[]} allocations - 対象アロケーション一覧（供給）
   * @param {Object[]} demands - 対象需要一覧
   * @param {Target[]} targetList - 器の一覧
   * @param {string[]} months - 対象月（月初日）の配列
   * @param {Array<Object>} [memberList] - メンバー一覧（供給のロール導出用。省略時はロール空の需要のみ機能）
   * @returns {{
   *   rows: {target: Target, role: string, roleNorm: string, cells: {month: string, demand: number, supply: number, gap: number, short: boolean}[], anyShort: boolean}[],
   *   totals: {month: string, shortage: number, short: boolean}[]
   * }} 器×ロールごとの月次セル（gap = 需要 − 供給、正なら不足）と、月ごとの不足合計
   */
  function shortageMatrix(allocations, demands, targetList, months, memberList) {
    const roleOf = buildRoleMap(memberList);
    const rows = [];
    (targetList || []).forEach((t) => {
      let roles = rolesForTarget(demands, t.id);
      if (!roles.length) roles = [{ norm: "", label: "" }]; // 需要なしの器も器単位で1行表示（互換）
      roles.forEach((role) => {
        const cells = (months || []).map((mo) => {
          const date = monthSample(mo);
          const demand = targetDemandByRole(demands, t.id, role.norm, date);
          const supply = targetSupplyByRole(allocations, t.id, role.norm, date, roleOf);
          const gap = demand - supply;
          return { month: mo, demand, supply, gap, short: gap > 0 };
        });
        rows.push({ target: t, role: role.label, roleNorm: role.norm, cells, anyShort: cells.some((c) => c.short) });
      });
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
   * 指定ロールに属するメンバーだけの空き要員(%)合計を返す純関数（ロール別の外注判定の分母。Issue #134）。
   * 該当ロールのメンバーが1人も居なければ 0（＝外注前提のロールは内部で吸収できず外注候補として残る）。
   * @param {Object[]} allocations - 対象アロケーション一覧
   * @param {Array<Object>} memberList - メンバー一覧
   * @param {string} date - 対象日（YYYY-MM-DD）
   * @param {string} roleNorm - 正規化ロール（空＝全メンバー＝teamFreeOn と等価）
   * @param {number} [capacity] - メンバー1人あたり総キャパ(%)（既定 100）
   * @param {Object} [roleOf] - memberId → 正規化ロールのマップ（省略時は memberList から生成）
   * @returns {number} 該当ロールの空き(%)合計
   */
  function teamFreeByRole(allocations, memberList, date, roleNorm, capacity, roleOf) {
    if (roleNorm === "") return teamFreeOn(allocations, memberList, date, capacity);
    const cap = capacity == null ? DEFAULT_CAPACITY : capacity;
    const map = roleOf || buildRoleMap(memberList);
    let s = 0;
    (memberList || []).forEach((m) => { if (map[m.id] === roleNorm) s += Math.max(0, cap - totalPercent(allocations, m.id, date)); });
    return s;
  }
  /**
   * 月ごとの外注要否を判定する純関数（問い②の中核。ロール対応 #134）。「不足（①の合計）をチームの空き要員で
   * 吸収できるか」を月次で判定するが、吸収はロール別に行う＝そのロールの不足は同じロールのメンバーの空きでしか
   * 吸収できない（役割ミスマッチは吸収されない）。ロール空（役割を問わない不足）は全メンバーの空きで吸収する。
   * これにより外注前提のロール（内部に該当者なし）の不足は吸収されず外注候補として残る。
   * `internalFree` は表示用の総空き（teamFreeOn）。`outsource` はロール別吸収の残差の合算。
   * @param {Object[]} allocations - 対象アロケーション一覧（供給）
   * @param {Object[]} demands - 対象需要一覧
   * @param {Target[]} targetList - 器の一覧
   * @param {Array<Object>} memberList - メンバー一覧
   * @param {string[]} months - 対象月（月初日）の配列
   * @param {number} [capacity] - メンバー1人あたり総キャパ(%)（既定 100）
   * @returns {{month: string, shortage: number, internalFree: number, absorbed: number, outsource: number, needsOutsource: boolean}[]}
   *   月ごとの不足・チームの総空き・内部吸収分・外注候補（%）・外注要否フラグ
   */
  function outsourcingByMonth(allocations, demands, targetList, memberList, months, capacity) {
    const mx = shortageMatrix(allocations, demands, targetList, months, memberList);
    const roleOf = buildRoleMap(memberList);
    return (months || []).map((mo, i) => {
      const date = monthSample(mo);
      // 月内の不足をロール別に集約（不足している行の gap のみ）
      const shortageByRole = {};
      mx.rows.forEach((r) => { const gap = r.cells[i].gap; if (gap > 0) shortageByRole[r.roleNorm] = (shortageByRole[r.roleNorm] || 0) + gap; });
      const internalFree = teamFreeOn(allocations, memberList, date, capacity);
      // 吸収は単一の空きプールから消費する（同じメンバーの空きを複数バケットで二重計上しない。#134 レビュー）。
      // ロール指定の不足はそのロールのメンバーの空きでしか賄えない＝制約が強いので先に自ロールの空きから消費し、
      // 役割を問わない不足（ロール空）は「総空き − ロール指定で消費済み」の残余（＝誰でも良い枠）から吸収する。
      let shortage = 0, outsource = 0, roleConsumed = 0;
      Object.keys(shortageByRole).forEach((norm) => {
        if (norm === "") return;
        const sh = shortageByRole[norm];
        const absorbed = Math.min(sh, teamFreeByRole(allocations, memberList, date, norm, capacity, roleOf));
        shortage += sh; roleConsumed += absorbed; outsource += sh - absorbed;
      });
      if (Object.prototype.hasOwnProperty.call(shortageByRole, "")) {
        const sh = shortageByRole[""];
        const remaining = Math.max(0, internalFree - roleConsumed); // ロール指定で使い切った残りの空き（誰でも良い枠）
        shortage += sh; outsource += Math.max(0, sh - remaining);
      }
      const absorbed = shortage - outsource;
      return { month: mo, shortage, internalFree, absorbed, outsource, needsOutsource: outsource > 0 };
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
   * 本日時点のチームの空き要員（人）と、過負担（割当 > 1人分）のメンバー数を返す。過負担がいれば
   * attention（warn）で昇格し、HOME 要対応バーに「誰が過負荷か」を出す（#181）。
   * データ源のアロケーションが皆無なら empty=true。「今日」依存の判定は基準日を引数で受けて決定的にする（§3.6）。
   * @param {string} [baseDate] - 基準日（YYYY-MM-DD、既定 本日）。決定的テスト用の注入点。
   * @returns {{empty: boolean, stats: {label: string, value: (string|number)}[], attention?: {label: string, severity: string}[]}}
   */
  function summary(baseDate) {
    const list = alloc(), mem = members(), today = baseDate || MK.util.todayISO(), cap = DEFAULT_CAPACITY;
    const over = [];
    mem.forEach((m) => { const p = totalPercent(list, m.id, today); if (p > cap) over.push({ name: m.name || "(無名)", assigned: p }); });
    over.sort((a, b) => b.assigned - a.assigned); // 最も過負荷な人を代表にする
    const out = { empty: !list.length, stats: [
      { label: "空き要員", value: fteLabel(teamFreeOn(list, mem, today, cap)) },
      { label: "過負担", value: over.length + "人" },
    ] };
    if (over.length) out.attention = [{ label: overloadLabel(over), severity: "warn" }];
    return out;
  }

  /**
   * 過負荷メンバー一覧を要対応バー用の1行ラベルへ整形する（#181）。誰が過負荷かが分かる粒度にし、
   * 複数人ならバーが長くならないよう「代表 ほかN人」に畳む。呼び出し側で assigned 降順にソート済みを前提とする。
   * @param {{name: string, assigned: number}[]} over - 過負荷メンバー（assigned 降順・非空）
   * @returns {string} 例:「過負荷: 佐藤 (1.3人分)」/「過負荷: 佐藤 ほか2人」
   */
  function overloadLabel(over) {
    const top = over[0];
    return over.length === 1
      ? "過負荷: " + top.name + " (" + fteLabel(top.assigned) + "分)"
      : "過負荷: " + top.name + " ほか" + (over.length - 1) + "人";
  }

  /**
   * エンティティ単位の任意契約（spec §3.6.1）。人1人の本日時点のアサイン状況を返す。
   * 主表記は人（FTE。Issue #71）。割当が1人分（100%）を超える人は attention（warn）で申告する。
   * 対応するのは person のみ。その他のマスタ種別（project 等）は該当データ無し（empty）で応える
   * （§3.6.1・"project" 決め打ち分岐をしない。project 集約は dashboard #78 が担う）。
   * @param {string} entityType - マスタ種別（"person" のみ対応）
   * @param {string} id - エンティティID（person なら memberId）
   * @param {string} [baseDate] - 基準日（YYYY-MM-DD、既定 本日）。決定的テスト用の注入点。
   * @returns {{empty: boolean, stats: {label: string, value: (string|number)}[], attention?: {label: string, severity: string}[]}}
   */
  function summaryFor(entityType, id, baseDate) {
    if (entityType !== "person") return { empty: true, stats: [] };
    const list = alloc();
    const today = baseDate || MK.util.todayISO();
    const mine = list.filter((a) => a.memberId === id);
    const assigned = totalPercent(list, id, today);
    const active = mine.filter((a) => a.startDate && a.endDate && a.startDate <= today && today <= a.endDate).length;
    const out = { empty: mine.length === 0, stats: [
      { label: "現在の割当", value: fteLabel(assigned) },
      { label: "稼働中PJ", value: active + "件" },
    ] };
    if (assigned > DEFAULT_CAPACITY) out.attention = [{ label: "割当が1人分を超えています（" + fteLabel(assigned) + "）", severity: "warn" }];
    return out;
  }

  /**
   * ロール入力の候補語彙を返す純関数（datalist 用。Issue #134）。People.role の既出値 ∪ 既存の需要で
   * 使われた role を、正規化キーで重複排除して原文で返す（People 由来を先、需要由来を後）。自由入力も残す前提。
   * @param {Array<Object>} memberList - メンバー一覧（People）
   * @param {Object[]} demands - 需要一覧
   * @returns {string[]} ロール候補（原文・重複なし・空は含まない）
   */
  function roleVocabulary(memberList, demands) {
    const seen = {}, out = [];
    const add = (raw) => { const r = String(raw == null ? "" : raw).trim(); if (!r) return; const k = normRole(r); if (seen[k]) return; seen[k] = 1; out.push(r); };
    (memberList || []).forEach((m) => add(m.role));
    (demands || []).forEach((d) => add(d.role));
    return out;
  }

  MK.logic = MK.logic || {};
  MK.logic.resource = { DEFAULT_CAPACITY, alloc, demandsAll, members, targets, capacityOf, fteLabel, totalPercent, freeOn, monthsInHorizon, monthSample, targetDemandOn, targetSupplyOn, normRole, rolesForTarget, targetDemandByRole, targetSupplyByRole, shortageMatrix, teamFreeOn, teamFreeByRole, outsourcingByMonth, memberLoadByMonth, roleVocabulary, summary, summaryFor };
})();
