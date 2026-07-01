/* モジュール goals — ロジック（データ・計算・CRUD）。DOM/UI に触れない。CONVENTIONS §1 */
(function () {
  "use strict";
  const MK = window.MK;
  const store = MK.store.scope("module:goals");

  /**
   * 目標達成に向けたステップ1件。
   * @typedef {Object} GoalStep
   * @property {string} id - ステップID（"s" プレフィックス）
   * @property {string} title - ステップ名
   * @property {string} description - 説明
   * @property {"todo"|"done"} status - 状態
   * @property {string|null} completedAt - 完了日（YYYY-MM-DD、未完了なら null）
   * @property {string} review - 振り返りメモ
   */

  /**
   * 目標1件。steps を全て done にすると達成扱いになる。
   * @typedef {Object} Goal
   * @property {string} id - 目標ID（"g" プレフィックス）
   * @property {string} title - 目標名
   * @property {string} description - 説明
   * @property {string|null} deadline - 期限日（YYYY-MM-DD、未設定なら null）
   * @property {string} createdAt - 作成日（YYYY-MM-DD）
   * @property {string|null} achievedAt - 達成日（未達成なら null、recompute で自動設定）
   * @property {GoalStep[]} steps - ステップ一覧
   */

  /**
   * モジュールの永続データ全体。
   * @typedef {Object} GoalsData
   * @property {number} version - スキーマバージョン
   * @property {Goal[]} goals - 目標一覧
   */

  /**
   * ストアから目標データを読み込む。未保存・不正形式なら空の初期データを返す。
   * @returns {GoalsData} 読み込んだデータ（常に goals 配列を持つ）
   */
  function load() { const d = store.get(); if (!d || !Array.isArray(d.goals)) return { version: 1, goals: [] }; return d; }
  /**
   * 目標データをストアへ保存する。
   * @param {GoalsData} d - 保存するデータ
   * @returns {void}
   * ※ store（localStorage）へ書き込む副作用あり。
   */
  function save(d) { store.set(d); }
  /**
   * 全目標の配列を返す。
   * @returns {Goal[]} 目標一覧
   */
  function goals() { return load().goals; }
  /**
   * IDで目標を1件取得する。
   * @param {string} id - 目標ID
   * @returns {Goal|null} 該当目標（なければ null）
   */
  function getGoal(id) { return goals().find((g) => g.id === id) || null; }

  /**
   * 目標の進捗（完了ステップ数・割合）を算出する。
   * @param {Goal} g - 対象目標
   * @returns {{total: number, done: number, pct: number}} 総ステップ数・完了数・達成率(%)
   */
  function progress(g) { const total = g.steps.length; const done = g.steps.filter((s) => s.status === "done").length; return { total, done, pct: total ? Math.round((done / total) * 100) : 0 }; }
  /**
   * 目標が達成済み（ステップが1つ以上あり全て done）かを判定する。
   * @param {Goal} g - 対象目標
   * @returns {boolean} 達成済みなら true
   */
  function isAchieved(g) { return g.steps.length > 0 && g.steps.every((s) => s.status === "done"); }
  /**
   * 最初の未完了ステップのIDを返す（現在取り組み中のステップ）。
   * @param {Goal} g - 対象目標
   * @returns {string|null} 未完了ステップのID（全完了なら null）
   */
  function currentStepId(g) { const s = g.steps.find((x) => x.status !== "done"); return s ? s.id : null; }

  /**
   * 各目標の達成状態を再計算し achievedAt を整合させる（純粋にデータを書き換えるのみ、保存はしない）。
   * @param {GoalsData} d - 対象データ（破壊的に更新される）
   * @returns {void}
   */
  function recompute(d) {
    d.goals.forEach((g) => {
      const ach = g.steps.length > 0 && g.steps.every((s) => s.status === "done");
      if (ach && !g.achievedAt) g.achievedAt = MK.util.todayISO();
      if (!ach) g.achievedAt = null;
    });
  }
  /**
   * 達成状態を再計算したうえでストアへ保存する（各更新操作の共通末尾処理）。
   * @param {GoalsData} d - 保存するデータ
   * @returns {void}
   * ※ recompute で achievedAt を更新し store へ保存する副作用あり。描画は view の責務。
   */
  function commit(d) { recompute(d); save(d); } // 描画は view の責務（ここでは render しない）

  /**
   * 目標を1件追加して保存する。
   * @param {string} title - 目標名（前後空白は trim される）
   * @returns {string} 追加された目標のID
   * ※ commit 経由で store へ保存する副作用あり。
   */
  function addGoal(title) {
    const d = load();
    const g = { id: MK.util.uid("g"), title: title.trim(), description: "", deadline: null, createdAt: MK.util.todayISO(), achievedAt: null, steps: [] };
    d.goals.push(g); commit(d); return g.id;
  }
  /**
   * 指定目標を部分更新して保存する。該当なしなら何も変更しない。
   * @param {string} id - 対象目標ID
   * @param {Partial<Goal>} patch - 上書きするフィールド
   * @returns {void}
   * ※ commit 経由で store へ保存する副作用あり。
   */
  function updateGoal(id, patch) { const d = load(); const g = d.goals.find((x) => x.id === id); if (g) Object.assign(g, patch); commit(d); }
  /**
   * 指定目標を削除して保存する。
   * @param {string} id - 対象目標ID
   * @returns {void}
   * ※ commit 経由で store へ保存する副作用あり。
   */
  function removeGoal(id) { const d = load(); d.goals = d.goals.filter((g) => g.id !== id); commit(d); }

  /**
   * 指定目標にステップを1件追加して保存する。目標が存在しなければ何もしない。
   * @param {string} goalId - 対象目標ID
   * @param {string} title - ステップ名（前後空白は trim される）
   * @returns {void}
   * ※ commit 経由で store へ保存する副作用あり。
   */
  function addStep(goalId, title) {
    const d = load(); const g = d.goals.find((x) => x.id === goalId); if (!g) return;
    g.steps.push({ id: MK.util.uid("s"), title: title.trim(), description: "", status: "todo", completedAt: null, review: "" }); commit(d);
  }
  /**
   * 指定ステップを部分更新して保存する。該当なしなら何も変更しない。
   * @param {string} goalId - 対象目標ID
   * @param {string} stepId - 対象ステップID
   * @param {Partial<GoalStep>} patch - 上書きするフィールド
   * @returns {void}
   * ※ commit 経由で store へ保存する副作用あり。
   */
  function updateStep(goalId, stepId, patch) { const d = load(); const g = d.goals.find((x) => x.id === goalId); const s = g && g.steps.find((x) => x.id === stepId); if (s) Object.assign(s, patch); commit(d); }
  /**
   * ステップの完了状態を切り替える。
   * @param {string} goalId - 対象目標ID
   * @param {string} stepId - 対象ステップID
   * @param {boolean} done - true で完了（completedAt 設定）、false で未完了に戻す
   * @returns {void}
   * ※ updateStep 経由で store へ保存する副作用あり。
   */
  function toggleStep(goalId, stepId, done) { updateStep(goalId, stepId, done ? { status: "done", completedAt: MK.util.todayISO() } : { status: "todo", completedAt: null }); }
  /**
   * 指定ステップを削除して保存する。
   * @param {string} goalId - 対象目標ID
   * @param {string} stepId - 対象ステップID
   * @returns {void}
   * ※ commit 経由で store へ保存する副作用あり。
   */
  function removeStep(goalId, stepId) { const d = load(); const g = d.goals.find((x) => x.id === goalId); if (g) g.steps = g.steps.filter((s) => s.id !== stepId); commit(d); }
  /**
   * ステップの並び順を1つ上/下へ移動して保存する。範囲外になる移動は無視する。
   * @param {string} goalId - 対象目標ID
   * @param {string} stepId - 対象ステップID
   * @param {number} dir - 移動方向（-1 で上、+1 で下）
   * @returns {void}
   * ※ commit 経由で store へ保存する副作用あり。
   */
  function moveStep(goalId, stepId, dir) {
    const d = load(); const g = d.goals.find((x) => x.id === goalId); if (!g) return;
    const i = g.steps.findIndex((s) => s.id === stepId); const j = i + dir;
    if (i < 0 || j < 0 || j >= g.steps.length) return;
    const t = g.steps[i]; g.steps[i] = g.steps[j]; g.steps[j] = t; commit(d);
  }

  /**
   * ダッシュボード表示用の集計データを算出する。
   * @returns {{achieveRate: number, achieved: number, total: number, totalDone: number, chart: {label: string, value: number}[]}}
   *   達成率(%)・達成済み目標数・総目標数・完了ステップ総数・目標別の完了ステップ数チャート
   */
  function dashboardData() {
    const list = goals();
    const totalDone = list.reduce((n, g) => n + g.steps.filter((s) => s.status === "done").length, 0);
    const achieved = list.filter(isAchieved).length;
    return { achieveRate: list.length ? Math.round((achieved / list.length) * 100) : 0, achieved, total: list.length, totalDone, chart: list.map((g) => ({ label: g.title || "(無題)", value: g.steps.filter((s) => s.status === "done").length })) };
  }

  /**
   * エクスポート用に現在の全データを返す。
   * @returns {GoalsData} 現在の目標データ
   */
  function exportData() { return load(); }
  /**
   * 外部データを取り込む。merge は id 一致で上書きマージ、それ以外は全置換。
   * @param {GoalsData} data - 取り込むデータ
   * @param {"merge"|"replace"} mode - 取り込みモード（"merge" 以外は全置換扱い）
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function importData(data, mode) {
    if (mode === "merge") {
      const d = load(); const byId = {};
      d.goals.forEach((g) => (byId[g.id] = g));
      (data.goals || []).forEach((g) => (byId[g.id] = g));
      d.goals = Object.keys(byId).map((k) => byId[k]); save(d);
    } else { save({ version: 1, goals: (data && data.goals) || [] }); }
  }
  /**
   * サンプルデータを生成して保存する（既存データは全置換）。
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function loadSample() {
    const today = MK.util.todayISO();
    const mkStep = (title, done, review) => ({ id: MK.util.uid("s"), title, description: "", status: done ? "done" : "todo", completedAt: done ? today : null, review: review || "" });
    save({ version: 1, goals: [
      { id: MK.util.uid("g"), title: "基本情報技術者に合格する", description: "半年で合格を目指す", deadline: null, createdAt: today, achievedAt: null,
        steps: [mkStep("参考書を1周", true, "意外と量が多かった"), mkStep("過去問を3回分解く", true), mkStep("模試を受ける", false), mkStep("本試験", false)] },
      { id: MK.util.uid("g"), title: "ランニングを習慣化する", description: "", deadline: null, createdAt: today, achievedAt: null,
        steps: [mkStep("シューズを買う", true), mkStep("週2回30分走る", false)] },
    ] });
  }

  MK.logic = MK.logic || {};
  MK.logic.goals = { load, save, goals, getGoal, progress, isAchieved, currentStepId, addGoal, updateGoal, removeGoal, addStep, updateStep, toggleStep, removeStep, moveStep, dashboardData, exportData, importData, loadSample };
})();
