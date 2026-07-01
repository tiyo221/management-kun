/* モジュール todo — ロジック（データ・計算・CRUD）。DOM/UI に触れない。CONVENTIONS §1 */
(function () {
  "use strict";
  const MK = window.MK;
  const store = MK.store.scope("module:todo");

  /**
   * ステータス定義（key＝内部値、label＝表示名）。表示順もこの配列順に従う。
   * @typedef {Object} TodoStatus
   * @property {string} key - 内部キー（"inbox" | "next" | "waiting" | "someday" | "done"）
   * @property {string} label - 画面表示名
   */

  /**
   * todo タスク1件のレコード。
   * @typedef {Object} TodoTask
   * @property {string} id - タスクID（"t" プレフィックス）
   * @property {string} title - タスク名
   * @property {string} notes - メモ
   * @property {string} status - ステータスキー（{@link TodoStatus} の key）
   * @property {string[]} contexts - コンテキストタグ（例 "@pc"）
   * @property {string|null} projectId - 紐づくプロジェクトID（未割当なら null）
   * @property {string|null} due - 期限日（YYYY-MM-DD、未設定なら null）
   * @property {string} createdAt - 作成日時（ISO 8601）
   * @property {string} updatedAt - 更新日時（ISO 8601）
   * @property {string|null} completedAt - 完了日時（未完了なら null）
   */

  /**
   * モジュールの永続データ全体。
   * @typedef {Object} TodoData
   * @property {number} version - スキーマバージョン
   * @property {TodoTask[]} tasks - タスク一覧
   * @property {string} [exportedAt] - 最終保存日時（ISO 8601）
   */

  const STATUSES = [
    { key: "inbox", label: "Inbox" },
    { key: "next", label: "Next" },
    { key: "waiting", label: "Waiting" },
    { key: "someday", label: "Someday" },
    { key: "done", label: "Done" },
  ];

  /**
   * ストアから todo データを読み込む。未保存・不正形式なら空の初期データを返す。
   * @returns {TodoData} 読み込んだデータ（常に tasks 配列を持つ）
   */
  function load() {
    const d = store.get();
    if (!d || !Array.isArray(d.tasks)) return { version: 1, tasks: [] };
    return d;
  }
  /**
   * todo データをストアへ保存する。exportedAt を現在時刻で更新する。
   * @param {TodoData} d - 保存するデータ
   * @returns {void}
   * ※ store（localStorage）へ書き込む副作用あり。
   */
  function save(d) { d.exportedAt = MK.util.nowISO(); store.set(d); }
  /**
   * 全タスクの配列を返す。
   * @returns {TodoTask[]} タスク一覧
   */
  function tasks() { return load().tasks; }

  /**
   * ステータス別および全体のタスク件数を集計する。
   * @returns {Object.<string, number>} `all` と各ステータスキーをキーに持つ件数マップ
   */
  function counts() {
    const c = { all: 0 };
    STATUSES.forEach((s) => (c[s.key] = 0));
    tasks().forEach((t) => { c.all++; c[t.status] = (c[t.status] || 0) + 1; });
    return c;
  }

  /**
   * ステータスと検索語でタスクを絞り込む。
   * @param {string} filter - 絞り込むステータスキー（"all" または未指定で全件）
   * @param {string} search - タイトル・メモを対象とする検索語（名寄せキーで部分一致）
   * @returns {TodoTask[]} 条件に合致したタスク一覧
   */
  function filtered(filter, search) {
    const q = MK.util.normalizeKey(search || "");
    let items = tasks();
    if (filter && filter !== "all") items = items.filter((t) => t.status === filter);
    if (q) items = items.filter((t) => MK.util.normalizeKey(t.title).includes(q) || MK.util.normalizeKey(t.notes).includes(q));
    return items;
  }

  /**
   * タスクを1件追加して保存する（先頭に挿入、status は "inbox"）。
   * @param {string} title - タスク名（前後空白は trim される）
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function addTask(title) {
    const d = load();
    const now = MK.util.nowISO();
    d.tasks.unshift({
      id: MK.util.uid("t"), title: title.trim(), notes: "", status: "inbox",
      contexts: [], projectId: null, due: null, createdAt: now, updatedAt: now, completedAt: null,
    });
    save(d);
  }
  /**
   * 指定タスクを部分更新して保存する（updatedAt を現在時刻で更新）。該当なしなら何もしない。
   * @param {string} id - 対象タスクID
   * @param {Partial<TodoTask>} patch - 上書きするフィールド
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function updateTask(id, patch) {
    const d = load();
    const t = d.tasks.find((x) => x.id === id);
    if (!t) return;
    Object.assign(t, patch);
    t.updatedAt = MK.util.nowISO();
    save(d);
  }
  /**
   * タスクの完了状態を切り替える。完了なら status="done"／completedAt を設定、解除なら status="next" に戻す。
   * @param {string} id - 対象タスクID
   * @param {boolean} done - true で完了、false で未完了に戻す
   * @returns {void}
   * ※ updateTask 経由で store へ保存する副作用あり。
   */
  function toggleDone(id, done) {
    updateTask(id, done ? { status: "done", completedAt: MK.util.nowISO() } : { status: "next", completedAt: null });
  }
  /**
   * 指定タスクを削除して保存する。
   * @param {string} id - 対象タスクID
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function removeTask(id) { const d = load(); d.tasks = d.tasks.filter((t) => t.id !== id); save(d); }

  // プロジェクト名寄せ（マスタ解決はロジック側の責務）
  /**
   * プロジェクトIDから表示名を解決する。
   * @param {string|null} id - プロジェクトID
   * @returns {string} プロジェクト名（未指定・未登録なら空文字）
   */
  function projectNameOf(id) { if (!id) return ""; const p = MK.projects.get(id); return p ? p.name : ""; }
  /**
   * プロジェクト名からIDを解決する。未登録ならマスタへ新規作成する（名寄せ）。
   * @param {string} name - プロジェクト名
   * @returns {string|null} 解決/作成されたプロジェクトID（空名なら null）
   * ※ 未登録名の場合 MK.projects マスタへ追加する副作用あり。
   */
  function resolveProject(name) { return name && name.trim() ? MK.projects.resolveOrCreate(name) : null; }

  /**
   * エクスポート用に現在の全データを返す。
   * @returns {TodoData} 現在の todo データ
   */
  function exportData() { return load(); }
  /**
   * 外部データを取り込む。merge は id 一致で上書きマージ、それ以外は全置換。
   * @param {TodoData} data - 取り込むデータ
   * @param {"merge"|"replace"} mode - 取り込みモード（"merge" 以外は全置換扱い）
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function importData(data, mode) {
    if (mode === "merge") {
      const d = load();
      const byId = {};
      d.tasks.forEach((t) => (byId[t.id] = t));
      (data.tasks || []).forEach((t) => (byId[t.id] = t));
      d.tasks = Object.keys(byId).map((k) => byId[k]);
      save(d);
    } else {
      save({ version: 1, tasks: (data && data.tasks) || [] });
    }
  }
  /**
   * サンプルデータを生成して保存する（既存データは全置換）。
   * @returns {void}
   * ※ store へ保存し、参照プロジェクトを MK.projects マスタへ作成する副作用あり。
   */
  function loadSample() {
    const now = MK.util.nowISO();
    const dayOffset = (n) => { const d = new Date(); d.setDate(d.getDate() + n); const p = (x) => String(x).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); };
    const pid = (name) => MK.projects.resolveOrCreate(name);
    const t = (title, status, opts) => Object.assign({ id: MK.util.uid("t"), title, notes: "", status, contexts: [], projectId: null, due: null, createdAt: now, updatedAt: now, completedAt: status === "done" ? now : null }, opts || {});
    save({ version: 1, tasks: [
      t("思いついたアイデアをメモ", "inbox"),
      t("競合サービスをざっと調べる", "inbox", { projectId: pid("新製品ローンチ") }),
      t("企画書のドラフトを書く", "next", { contexts: ["@pc"], projectId: pid("新製品ローンチ"), due: dayOffset(2) }),
      t("デザインレビューの日程調整", "next", { contexts: ["@mail"], projectId: pid("サイトリニューアル") }),
      t("発表スライドを準備", "next", { contexts: ["@pc"], projectId: pid("社内勉強会"), due: dayOffset(5) }),
      t("印刷会社からの見積もり", "waiting", { notes: "鈴木さん経由で依頼中", projectId: pid("新製品ローンチ") }),
      t("いつか英語の勉強を始める", "someday"),
      t("キックオフMTGを実施", "done", { projectId: pid("新製品ローンチ") }),
      t("要件ヒアリング", "done", { projectId: pid("サイトリニューアル") }),
    ] });
  }

  /**
   * HOME ダッシュボード用のサマリーを算出する（spec §3.6）。
   * @returns {{empty: boolean, stats: {label: string, value: (string|number)}[]}}
   *   `empty` はデータ皆無（空状態表示）、`stats` は表示する指標の配列。
   */
  function summary() {
    const c = counts(); // counts() は全ステータスを 0 初期化するため c.done は常に数値
    return { empty: c.all === 0, stats: [
      { label: "未完", value: c.all - c.done },
      { label: "全タスク", value: c.all },
    ] };
  }

  MK.logic = MK.logic || {};
  MK.logic.todo = {
    STATUSES, load, save, tasks, counts, filtered,
    addTask, updateTask, toggleDone, removeTask,
    projectNameOf, resolveProject, summary,
    exportData, importData, loadSample,
  };
})();
