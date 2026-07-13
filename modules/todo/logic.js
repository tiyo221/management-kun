/* モジュール todo — ロジック（データ・計算・CRUD）。DOM/UI に触れない。CONVENTIONS §1 */
(function () {
  "use strict";
  const MK = window.MK;
  const col = MK.store.collection("module:todo", { key: "tasks", stamp: true });

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
  // ラベル解決 / 件数集計の定型は共有ヘルパへ集約（Issue #188）。正規化は CSV 専用の
  // statusFromCSV（key/ラベル両対応）を使うため normalize/fallback はここでは使わない。
  const statusSet = MK.util.statusSet(STATUSES);

  // load/save は共有ヘルパへ集約（Issue #139）。load＝store 読取→tasks 配列検証→既定返却、
  // save＝exportedAt 付与→store.set（返り値は保存成否）。仕様は MK.store.collection を参照。
  const { load, save } = col;
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
    return statusSet.counts(tasks(), (t) => t.status);
  }

  /**
   * 空文字を末尾に寄せる文字列比較。両方空は同順、片方空はそれを後ろへ、
   * それ以外はコードポイント順（プロジェクト名・コンテキストのグルーピング用）。
   * @param {string} x
   * @param {string} y
   * @returns {number} 負=x が先、正=y が先、0=同順
   */
  function cmpEmptyLast(x, y) {
    if (!x && !y) return 0;
    if (!x) return 1;
    if (!y) return -1;
    return x < y ? -1 : x > y ? 1 : 0;
  }

  /**
   * タスク配列を並び替えた新しい配列を返す（安定ソート。元配列は変更しない）。
   * @param {TodoTask[]} items - 並び替え対象
   * @param {"created"|"due"|"project"|"context"} [sort] - 並び順（既定 "created"＝追加日順＝挿入順のまま）
   * @returns {TodoTask[]} 並び替え後の配列
   */
  function sortTasks(items, sort) {
    if (!sort || sort === "created") return items; // 追加日順＝挿入順（unshift で新しい順）をそのまま
    const arr = items.slice();
    if (sort === "due") {
      // 締め切り昇順・未設定は末尾（ISO 日付は辞書順＝時系列順）
      arr.sort((a, b) => cmpEmptyLast(a.due || "", b.due || ""));
    } else if (sort === "project") {
      arr.sort((a, b) => cmpEmptyLast(projectNameOf(a.projectId), projectNameOf(b.projectId)));
    } else if (sort === "context") {
      arr.sort((a, b) => cmpEmptyLast((a.contexts || [])[0] || "", (b.contexts || [])[0] || ""));
    }
    return arr;
  }

  /**
   * ステータスと検索語でタスクを絞り込み、指定順に並べ替える。
   * @param {string} filter - 絞り込むステータスキー（"all" または未指定で全件）
   * @param {string} search - タイトル・メモを対象とする検索語（名寄せキーで部分一致）
   * @param {"created"|"due"|"project"|"context"} [sort] - 並び順（既定 "created"＝追加日順）
   * @returns {TodoTask[]} 条件に合致し並び替えられたタスク一覧
   */
  function filtered(filter, search, sort) {
    const q = MK.util.normalizeKey(search || "");
    let items = tasks();
    if (filter && filter !== "all") items = items.filter((t) => t.status === filter);
    if (q) items = items.filter((t) => MK.util.normalizeKey(t.title).includes(q) || MK.util.normalizeKey(t.notes).includes(q));
    return sortTasks(items, sort);
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

  // ---- CSV（整形・取込はロジック。ファイル選択/DLは view）spec §4.6.2 / spec/modules/todo.md ----
  /**
   * ステータス表記（key または日本語ラベル）を内部キーへ寄せる。不明・空は "inbox"。
   * @param {string} v - ステータス表記
   * @returns {string} ステータスキー（{@link STATUSES} の key）
   */
  function statusFromCSV(v) {
    const s = MK.util.normalizeKey(String(v == null ? "" : v));
    const hit = STATUSES.find((x) => MK.util.normalizeKey(x.key) === s || MK.util.normalizeKey(x.label) === s);
    return hit ? hit.key : "inbox";
  }
  /**
   * タスクを CSV 行データ（ヘッダ＋各行）に整形する。プロジェクトは名前で参照。
   * @returns {string[][]} 2次元配列の CSV 行データ
   */
  function buildCSVRows() {
    const label = statusSet.label;
    const rows = [["タイトル", "ステータス", "プロジェクト", "コンテキスト", "期限", "メモ"]];
    tasks().forEach((t) => rows.push([
      t.title, label(t.status), projectNameOf(t.projectId),
      (t.contexts || []).join(" "), t.due || "", t.notes || "",
    ]));
    return rows;
  }
  /**
   * CSV 行データからタスクを取り込み、全置換して保存する。タイトルが空の行はスキップする。
   * プロジェクトは名前で名寄せ（未登録は新規作成、空は未割当）。ステータスは key/ラベル両対応。
   * @param {string[][]} rows - CSV 行データ（1行目はヘッダ）
   * @returns {{ok: number, skip: number}} 取り込み件数・スキップ件数
   * ※ store へ保存する副作用あり（全置換）。未登録プロジェクト名は MK.projects へ作成する副作用あり。
   */
  function applyCSV(rows) {
    const now = MK.util.nowISO();
    let ok = 0, skip = 0;
    const list = [];
    rows.slice(1).forEach((r) => {
      const title = (r[0] || "").trim();
      if (!title) { skip++; return; }
      const status = statusFromCSV(r[1]);
      list.push({
        id: MK.util.uid("t"), title, notes: (r[5] || "").trim(), status,
        contexts: (r[3] || "").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
        projectId: resolveProject(r[2] || ""), due: (r[4] || "").trim() || null,
        createdAt: now, updatedAt: now, completedAt: status === "done" ? now : null,
      });
      ok++;
    });
    save({ version: 1, tasks: list });
    return { ok, skip };
  }

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
      d.tasks = MK.util.mergeById(d.tasks, data.tasks);
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
    const dayOffset = (n) => MK.util.addDays(MK.util.todayISO(), n);
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
   * 期限（due）ベースの要対応件数を集計する。完了（done）と期限未設定は対象外。
   * @param {string} [today] - 基準日（"YYYY-MM-DD"。省略時は本日）
   * @returns {{overdue: number, dueToday: number}} 期限切れ・今日期限の件数
   */
  function dueCounts(today) {
    const t = today || MK.util.todayISO();
    let overdue = 0, dueToday = 0;
    tasks().forEach((x) => {
      if (x.status === "done" || !x.due) return;
      if (x.due < t) overdue++; // ISO 日付（YYYY-MM-DD）は辞書順＝時系列順
      else if (x.due === t) dueToday++;
    });
    return { overdue, dueToday };
  }

  /**
   * HOME ダッシュボード用のサマリーを算出する（spec §3.6）。
   * @param {string} [today] - 基準日（"YYYY-MM-DD"。省略時は本日。テスト用）
   * @returns {{empty: boolean, stats: {label: string, value: (string|number)}[], attention: {label: string, severity: string}[]}}
   *   `empty` はデータ皆無（空状態表示）、`stats` は表示する指標、`attention` は要対応事項（HOME の帯・Issue #102）。
   */
  function summary(today) {
    const c = counts(); // counts() は全ステータスを 0 初期化するため c.done は常に数値
    const dc = dueCounts(today);
    const attention = [];
    if (dc.overdue > 0) attention.push({ label: "期限切れ " + dc.overdue + "件", severity: "error" });
    if (dc.dueToday > 0) attention.push({ label: "今日期限 " + dc.dueToday + "件", severity: "warn" });
    return { empty: c.all === 0, stats: [
      { label: "未完", value: c.all - c.done },
      { label: "全タスク", value: c.all },
    ], attention };
  }

  /**
   * グローバル検索（コマンドパレット）用のレコードを返す（任意契約 def.searchItems・spec §3.5）。
   * 完了済み（done）は除き、進行中のタスクだけを候補にする。label＝タイトル、sub＝ステータス＋PJ、
   * keywords にメモを含めて本文検索できるようにする。
   * @returns {{id: string, label: string, sub: string, keywords: string[]}[]}
   */
  function searchItems() {
    const label = statusSet.label;
    return tasks().filter((t) => t.status !== "done").map((t) => {
      const pj = projectNameOf(t.projectId);
      return { id: t.id, label: t.title,
        sub: [label(t.status), pj].filter(Boolean).join(" · "),
        keywords: [t.notes].filter(Boolean) };
    });
  }

  MK.logic = MK.logic || {};
  MK.logic.todo = {
    STATUSES, load, save, tasks, counts, filtered,
    addTask, updateTask, toggleDone, removeTask,
    projectNameOf, resolveProject, statusFromCSV, buildCSVRows, applyCSV, dueCounts, summary,
    searchItems, exportData, importData, loadSample,
  };
})();
