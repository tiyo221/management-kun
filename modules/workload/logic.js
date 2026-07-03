/* モジュール workload — ロジック（負荷計算・CRUD・計画）。DOM/UI に触れない。CONVENTIONS §1 */
(function () {
  "use strict";
  const MK = window.MK;
  const store = MK.store.scope("module:workload");

  /**
   * 稼働タスク1件。負荷(load)を稼働率(%)として日次・週次に集計する。
   * @typedef {Object} WorkloadTask
   * @property {string} id - タスクID（"wt" プレフィックス）
   * @property {string|null} memberId - 担当メンバーID（未割当なら null）
   * @property {string} title - タスク名
   * @property {number} load - 稼働率(%)
   * @property {string} startDate - 開始日（YYYY-MM-DD、未設定なら空文字）
   * @property {string} endDate - 終了予定日（YYYY-MM-DD、未設定なら空文字）
   * @property {"todo"|"in_progress"|"done"} status - 状態
   * @property {string|null} completedDate - 完了日（YYYY-MM-DD、未完了なら null）
   * @property {string} note - 備考
   */

  /**
   * メンバー個別の警告しきい値設定。
   * @typedef {Object} MemberSetting
   * @property {number} [high] - 過負荷とみなす平均稼働率(%)（既定 80）
   * @property {number} [low] - 余裕とみなす平均稼働率(%)（既定 60）
   */

  /**
   * モジュールの永続データ全体。負荷（タスク）に専念し、計画（アロケーション）は持たない。
   * アロケーションは共有マスタ `MK.allocations`（mk:allocations）へ昇格した（Issue #45）。
   * @typedef {Object} WorkloadData
   * @property {number} version - スキーマバージョン
   * @property {WorkloadTask[]} tasks - タスク一覧（実行の細かい事実。負荷計算の源）
   * @property {{savedAt: string, tasks: WorkloadTask[]}|null} baseline - 計画スナップショット（未保存なら null）
   * @property {Object.<string, MemberSetting>} memberSettings - メンバーIDごとの警告しきい値
   */

  const STATUS = [{ key: "todo", label: "未着手" }, { key: "in_progress", label: "進行中" }, { key: "done", label: "完了" }];
  const PERIODS = [{ key: 13, label: "四半期" }, { key: 26, label: "半年" }, { key: 52, label: "1年" }];
  const PALETTE = ["#5645d4", "#0075de", "#dd5b00", "#1aae39", "#ff64c8", "#2a9d99"];

  /**
   * ストアから稼働データを読み込む。未保存・不正形式なら空の初期データを返し、memberSettings 欠落も補う。
   * @returns {WorkloadData} 読み込んだデータ
   */
  function load() { const d = store.get(); if (!d || !Array.isArray(d.tasks)) return { version: 1, tasks: [], baseline: null, memberSettings: {} }; if (!d.memberSettings) d.memberSettings = {}; return d; }
  /**
   * 稼働データをストアへ保存する。
   * @param {WorkloadData} d - 保存するデータ
   * @returns {void}
   * ※ store（localStorage）へ書き込む副作用あり。
   */
  function save(d) { store.set(d); }
  /**
   * 全タスクの配列を返す。
   * @returns {WorkloadTask[]} タスク一覧
   */
  function tasks() { return load().tasks; }
  /**
   * 対象メンバー一覧を人マスタから返す。
   * @returns {Array<Object>} メンバー一覧（MK.people のレコード）
   */
  function members() { return MK.people.all(); }
  /**
   * 指定メンバーの警告しきい値を返す（未設定は既定値 high=80 / low=60）。
   * @param {string} mid - メンバーID
   * @returns {{high: number, low: number}} 過負荷/余裕のしきい値(%)
   */
  function warnOf(mid) { const s = load().memberSettings[mid] || {}; return { high: s.high != null ? s.high : 80, low: s.low != null ? s.low : 60 }; }
  /**
   * メンバーの表示色を返す（メンバー固有色があれば優先、なければパレットを循環使用）。
   * @param {Object|null} m - メンバーレコード
   * @param {number} i - 一覧内のインデックス
   * @returns {string} 色（CSSカラー文字列）
   */
  function colorOf(m, i) { return (m && m.color) || PALETTE[i % PALETTE.length]; }

  /**
   * タスクの実効終了日を返す（完了かつ完了日ありなら完了日、そうでなければ終了予定日）。
   * @param {WorkloadTask} t - 対象タスク
   * @returns {string} 実効終了日（YYYY-MM-DD）
   */
  function effEnd(t) { return (t.status === "done" && t.completedDate) ? t.completedDate : t.endDate; }
  /**
   * 指定メンバー・指定日の合計稼働率を算出する（期間内タスクの load を合算）。
   * @param {WorkloadTask[]} list - 対象タスク一覧
   * @param {string} mid - メンバーID
   * @param {string} date - 対象日（YYYY-MM-DD）
   * @returns {number} 合計稼働率(%)
   */
  function dailyLoad(list, mid, date) { let s = 0; list.forEach((t) => { if (t.memberId !== mid) return; const e = effEnd(t); if (t.startDate && e && t.startDate <= date && date <= e) s += Number(t.load) || 0; }); return s; }
  /**
   * 指定メンバー・指定週（月曜起点7日間）の平均稼働率を算出する。
   * @param {WorkloadTask[]} list - 対象タスク一覧
   * @param {string} mid - メンバーID
   * @param {string} monday - 週の起点となる月曜日（YYYY-MM-DD）
   * @returns {number} 週平均稼働率(%)
   */
  function weeklyLoad(list, mid, monday) { let s = 0; for (let i = 0; i < 7; i++) s += dailyLoad(list, mid, MK.util.addDays(monday, i)); return s / 7; }

  /**
   * 表示期間分の週開始日（月曜）の配列を生成する。
   * @param {number} period - 週数
   * @param {number} [offset] - 今週を基準としたオフセット週数（既定 0）
   * @returns {string[]} 各週の月曜日（YYYY-MM-DD）の配列
   */
  function weekMondays(period, offset) {
    const start = MK.util.addDays(MK.util.mondayOf(MK.util.todayISO()), (offset || 0) * 7);
    const arr = []; for (let i = 0; i < period; i++) arr.push(MK.util.addDays(start, i * 7));
    return arr;
  }
  /**
   * 指定メンバーの実績（現行タスク）週次稼働率系列を返す。
   * @param {string} mid - メンバーID
   * @param {string[]} weeks - 週開始日（月曜）の配列
   * @returns {number[]} 週ごとの平均稼働率(%)
   */
  function series(mid, weeks) { const list = tasks(); return weeks.map((w) => weeklyLoad(list, mid, w)); }
  /**
   * 指定メンバーの計画（baseline）週次稼働率系列を返す。baseline 未保存なら null。
   * @param {string} mid - メンバーID
   * @param {string[]} weeks - 週開始日（月曜）の配列
   * @returns {number[]|null} 週ごとの平均稼働率(%)、または null
   */
  function planSeries(mid, weeks) { const d = load(); return d.baseline ? weeks.map((w) => weeklyLoad(d.baseline.tasks, mid, w)) : null; }
  /**
   * 指定メンバーの稼働統計（系列・平均・ピーク・しきい値・状態）を算出する。
   * @param {string} mid - メンバーID
   * @param {string[]} weeks - 週開始日（月曜）の配列
   * @returns {{vals: number[], avg: number, peak: number, high: number, low: number, state: "over"|"under"|"ok"}}
   *   週次系列・平均・ピーク・過負荷/余裕しきい値・平均に基づく状態
   */
  function stats(mid, weeks) {
    const vals = series(mid, weeks);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    const peak = vals.length ? Math.max.apply(null, vals) : 0;
    const w = warnOf(mid);
    const state = avg > w.high ? "over" : (avg < w.low ? "under" : "ok");
    return { vals, avg, peak, high: w.high, low: w.low, state };
  }

  /**
   * タスクを1件追加して保存する（未指定フィールドは既定値で補完）。
   * @param {Partial<WorkloadTask>} attrs - 初期属性
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function addTask(attrs) { const d = load(); d.tasks.push(Object.assign({ id: MK.util.uid("wt"), memberId: null, title: "", load: 30, startDate: "", endDate: "", status: "todo", completedDate: null, note: "" }, attrs || {})); save(d); }
  /**
   * 指定タスクを部分更新して保存する。該当なしなら何も変更しない。
   * @param {string} id - 対象タスクID
   * @param {Partial<WorkloadTask>} patch - 上書きするフィールド
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function updateTask(id, patch) { const d = load(); const t = d.tasks.find((x) => x.id === id); if (t) Object.assign(t, patch); save(d); }
  /**
   * 指定タスクを削除して保存する。
   * @param {string} id - 対象タスクID
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function removeTask(id) { const d = load(); d.tasks = d.tasks.filter((t) => t.id !== id); save(d); }
  /**
   * 指定メンバーが担当するタスク一覧を返す。
   * @param {string} mid - メンバーID
   * @returns {WorkloadTask[]} 担当タスク一覧
   */
  function tasksOf(mid) { return tasks().filter((t) => t.memberId === mid); }

  /**
   * 現在のタスクを計画（baseline）としてスナップショット保存する（ディープコピー）。
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function saveBaseline() { const d = load(); d.baseline = { savedAt: MK.util.todayISO(), tasks: JSON.parse(JSON.stringify(d.tasks)) }; save(d); }
  /**
   * 計画（baseline）を破棄して保存する。
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function clearBaseline() { const d = load(); d.baseline = null; save(d); }
  /**
   * 計画（baseline）が保存済みかを返す。
   * @returns {boolean} 保存済みなら true
   */
  function hasBaseline() { return !!load().baseline; }

  /**
   * エクスポート用に現在の全データを返す。
   * @returns {WorkloadData} 現在の稼働データ
   */
  function exportData() { return load(); }
  /**
   * 外部データを取り込む。merge は id 一致で上書きマージ（baseline/memberSettings も統合）、それ以外は全置換。
   * @param {WorkloadData} data - 取り込むデータ
   * @param {"merge"|"replace"} mode - 取り込みモード（"merge" 以外は全置換扱い）
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function importData(data, mode) {
    if (mode === "merge") {
      const d = load(); const byId = {}; d.tasks.forEach((t) => (byId[t.id] = t));
      (data.tasks || []).forEach((t) => (byId[t.id] = t));
      d.tasks = Object.keys(byId).map((k) => byId[k]);
      if (data.baseline) d.baseline = data.baseline;
      Object.assign(d.memberSettings, data.memberSettings || {}); save(d);
    } else { save({ version: 1, tasks: (data && data.tasks) || [], baseline: (data && data.baseline) || null, memberSettings: (data && data.memberSettings) || {} }); }
  }
  /**
   * サンプルデータを生成して保存する（既存データは全置換）。
   * @returns {void}
   * ※ store へ保存し、参照メンバーを MK.people マスタへ作成する副作用あり。
   */
  function loadSample() {
    const d = { version: 1, tasks: [], baseline: null, memberSettings: {} };
    const today = MK.util.todayISO();
    const sato = MK.people.resolveOrCreate("佐藤 花子"), suzuki = MK.people.resolveOrCreate("鈴木 一郎"), tanaka = MK.people.resolveOrCreate("田中 美咲");
    const t = (memberId, title, load, s, e, opts) => Object.assign({ id: MK.util.uid("wt"), memberId, title, load, startDate: s, endDate: e, status: "in_progress", completedDate: null, note: "" }, opts || {});
    d.tasks = [
      t(suzuki, "新製品の設計", 60, MK.util.addDays(today, -7), MK.util.addDays(today, 21)),
      t(suzuki, "障害対応", 50, today, MK.util.addDays(today, 14)),
      t(sato, "プロジェクト管理", 40, MK.util.addDays(today, -14), MK.util.addDays(today, 56)),
      t(tanaka, "UIデザイン", 70, today, MK.util.addDays(today, 28)),
      t(tanaka, "ロゴ制作", 30, MK.util.addDays(today, 7), MK.util.addDays(today, 21)),
    ];
    save(d);
    // 計画（アロケーション）は共有マスタ側のサンプルとして staffing.loadSample が投入する（Issue #45）。
  }

  /**
   * HOME ダッシュボード用のサマリーを算出する（spec §3.6）。
   * 直近4週の各メンバー平均稼働率をチーム平均し、過負荷（state==="over"）人数を数える。
   * @returns {{empty: boolean, stats: {label: string, value: (string|number)}[]}}
   */
  function summary() {
    const mem = members(), hasTasks = tasks().length > 0;
    const weeks = weekMondays(4, 0);
    let sum = 0, over = 0;
    mem.forEach((m) => { const st = stats(m.id, weeks); sum += st.avg; if (st.state === "over") over++; });
    const avg = mem.length ? Math.round(sum / mem.length) : 0;
    return { empty: !hasTasks, stats: [
      { label: "平均稼働", value: avg + "%" },
      { label: "過負荷", value: over },
    ] };
  }

  MK.logic = MK.logic || {};
  MK.logic.workload = { STATUS, PERIODS, load, save, tasks, members, warnOf, colorOf, effEnd, weekMondays, series, planSeries, stats, summary, addTask, updateTask, removeTask, tasksOf, saveBaseline, clearBaseline, hasBaseline, exportData, importData, loadSample };
})();
