/* モジュール wbs — ロジック（階層計算・ロールアップ・依存・CRUD・CSV整形）。DOM/UI に触れない。CONVENTIONS §1 */
(function () {
  "use strict";
  const MK = window.MK;
  const store = MK.store.scope("module:wbs");

  /**
   * WBS タスク1件。フラット配列で保持し、level で階層を表現する。
   * @typedef {Object} WbsTask
   * @property {number} id - タスクID（数値、data.uid で採番）
   * @property {number} level - 階層の深さ（0=ルート）
   * @property {string} name - タスク名
   * @property {string|null} assigneeId - 担当メンバーID（未割当なら null）
   * @property {string} start - 開始日（YYYY-MM-DD、未設定なら空文字）
   * @property {string} end - 終了日（YYYY-MM-DD、未設定なら空文字）
   * @property {number} progress - 進捗率(0-100)
   * @property {"notstarted"|"inprogress"|"done"|"hold"} status - ステータスキー
   * @property {string} note - 備考
   * @property {number[]} deps - 先行タスクのID配列
   * @property {boolean} collapsed - 子を折りたたみ表示するか
   */

  /**
   * モジュールの永続データ全体。タスクは表示順のフラット配列で保持する。
   * @typedef {Object} WbsData
   * @property {number} version - スキーマバージョン
   * @property {number} uid - 次に採番するタスクID
   * @property {WbsTask[]} tasks - タスク一覧（表示順のフラット配列）
   */

  const STATUS = [
    { key: "notstarted", label: "未着手", color: "var(--color-hairline-strong)" },
    { key: "inprogress", label: "進行中", color: "var(--color-primary)" },
    { key: "done", label: "完了", color: "var(--color-success)" },
    { key: "hold", label: "保留", color: "var(--color-warning)" },
  ];

  /** @type {{index: number, block: WbsTask[]}|null} 直近に削除したサブツリー（undoDelete 用） */
  let lastDeleted = null;

  /**
   * ストアからWBSデータを読み込む。不正形式なら初期データを返し、uid 欠落と deps 未初期化を補正する。
   * @returns {WbsData} 読み込んだデータ（uid と各タスクの deps を保証）
   */
  function load() {
    const d = store.get();
    const data = d && Array.isArray(d.tasks) ? d : { version: 1, uid: 1, tasks: [] };
    if (typeof data.uid !== "number") data.uid = data.tasks.reduce((m, t) => Math.max(m, (t.id || 0) + 1), 1);
    data.tasks.forEach((t) => { if (!Array.isArray(t.deps)) t.deps = []; });
    return data;
  }
  /**
   * WBSデータをストアへ保存する。
   * @param {WbsData} d - 保存するデータ
   * @returns {void}
   * ※ store（localStorage）へ書き込む副作用あり。
   */
  function save(d) { store.set(d); }
  /**
   * 全タスクの配列（表示順のフラット配列）を返す。
   * @returns {WbsTask[]} タスク一覧
   */
  function tasks() { return load().tasks; }
  /**
   * 次のタスクIDを採番して uid を進める。
   * @param {WbsData} d - 対象データ（uid が破壊的に増加する）
   * @returns {number} 採番したID
   */
  function nextId(d) { return d.uid++; }

  // 階層ユーティリティ（純粋）
  /**
   * 指定タスクの子孫が占めるインデックス範囲 [開始, 終了) を返す（純粋関数）。
   * @param {WbsTask[]} tasks - タスク配列
   * @param {number} idx - 親タスクのインデックス
   * @returns {[number, number]} 子孫の [開始インデックス, 終端インデックス（排他）]
   */
  function childrenRange(tasks, idx) { const lvl = tasks[idx].level; let end = idx + 1; while (end < tasks.length && tasks[end].level > lvl) end++; return [idx + 1, end]; }
  /**
   * 指定タスクのサブツリー終端インデックス（排他）を返す（純粋関数）。
   * @param {WbsTask[]} tasks - タスク配列
   * @param {number} idx - 対象タスクのインデックス
   * @returns {number} サブツリー終端インデックス（自身＋全子孫の次）
   */
  function subtreeEnd(tasks, idx) { return childrenRange(tasks, idx)[1]; }
  /**
   * 指定タスクが子を持つ（親である）かを返す（純粋関数）。
   * @param {WbsTask[]} tasks - タスク配列
   * @param {number} idx - 対象タスクのインデックス
   * @returns {boolean} 子があれば true
   */
  function isParent(tasks, idx) { const r = childrenRange(tasks, idx); return r[1] > r[0]; }
  /**
   * 各タスクの WBS 番号（"1.2.3" 形式）を階層に基づき算出する（純粋関数）。
   * @param {WbsTask[]} tasks - タスク配列（表示順）
   * @returns {string[]} タスクと同じ並びの WBS 番号配列
   */
  function wbsNumbers(tasks) { const c = []; return tasks.map((t) => { const L = t.level; c[L] = (c[L] || 0) + 1; c.length = L + 1; return c.slice(0, L + 1).join("."); }); }
  /**
   * 親タスクの集計値（子孫の葉から算出した開始/終了/進捗）を返す（ロールアップ、純粋関数）。
   * @param {WbsTask[]} tasks - タスク配列
   * @param {number} idx - 親タスクのインデックス
   * @returns {{start: string|null, end: string|null, progress: number}} 最小開始日・最大終了日・平均進捗率
   */
  function summaryOf(tasks, idx) {
    const [s, e] = childrenRange(tasks, idx);
    let minStart = null, maxEnd = null, sum = 0, cnt = 0;
    for (let k = s; k < e; k++) { if (isParent(tasks, k)) continue; const t = tasks[k]; if (t.start && (!minStart || t.start < minStart)) minStart = t.start; if (t.end && (!maxEnd || t.end > maxEnd)) maxEnd = t.end; sum += Number(t.progress) || 0; cnt++; }
    return { start: minStart, end: maxEnd, progress: cnt ? Math.round(sum / cnt) : 0 };
  }
  /**
   * 折りたたみ状態から、各タスクが非表示かどうかのフラグ配列を返す（純粋関数）。
   * @param {WbsTask[]} tasks - タスク配列
   * @returns {boolean[]} タスクと同じ並びの非表示フラグ（折りたたまれた親の子孫が true）
   */
  function hiddenFlags(tasks) { const hidden = new Array(tasks.length).fill(false); tasks.forEach((t, i) => { if (t.collapsed) { const [s, e] = childrenRange(tasks, i); for (let k = s; k < e; k++) hidden[k] = true; } }); return hidden; }
  /**
   * 依存関係の追加が循環を生むかを判定する（純粋関数）。
   * @param {WbsTask[]} tasks - タスク配列
   * @param {number} currentId - 依存を追加する側（後続）のタスクID
   * @param {number} predId - 先行として追加しようとするタスクID
   * @returns {boolean} 循環が生じるなら true
   */
  function depsCreatesCycle(tasks, currentId, predId) {
    if (currentId === predId) return true;
    const map = {}; tasks.forEach((t) => (map[t.id] = t));
    const seen = {};
    const visit = (id) => { if (id === currentId) return true; if (seen[id]) return false; seen[id] = true; const t = map[id]; return !!(t && t.deps.some(visit)); };
    return visit(predId);
  }

  // 操作（save のみ・描画は view）
  /**
   * 新規タスク1件の初期オブジェクトを生成する（ID を採番、保存はしない）。
   * @param {WbsData} d - 対象データ（uid を採番のため使用）
   * @param {number} level - 階層レベル
   * @returns {WbsTask} 新規タスク
   */
  function blank(d, level) { return { id: nextId(d), level, name: "新規タスク", assigneeId: null, start: "", end: "", progress: 0, status: "notstarted", note: "", deps: [], collapsed: false }; }
  /**
   * ルート（level 0）タスクを末尾に追加して保存する。
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function addRoot() { const d = load(); d.tasks.push(blank(d, 0)); save(d); }
  /**
   * 指定タスクの直下に子タスクを追加して保存する（親の折りたたみは解除）。
   * @param {number} idx - 親タスクのインデックス
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function addChild(idx) { const d = load(); const t = blank(d, d.tasks[idx].level + 1); d.tasks.splice(idx + 1, 0, t); d.tasks[idx].collapsed = false; save(d); }
  /**
   * 指定タスクのサブツリー直後に同階層の兄弟タスクを追加して保存する。
   * @param {number} idx - 基準タスクのインデックス
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function addSibling(idx) { const d = load(); const t = blank(d, d.tasks[idx].level); d.tasks.splice(subtreeEnd(d.tasks, idx), 0, t); save(d); }
  /**
   * 指定タスク（とサブツリー）を1段深くインデントして保存する。直前タスクより深い場合は何もしない。
   * @param {number} idx - 対象タスクのインデックス
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function indent(idx) { const d = load(); if (idx === 0 || d.tasks[idx].level > d.tasks[idx - 1].level) return; const e = subtreeEnd(d.tasks, idx); for (let k = idx; k < e; k++) d.tasks[k].level++; save(d); }
  /**
   * 指定タスク（とサブツリー）を1段浅くアウトデントして保存する。ルート階層なら何もしない。
   * @param {number} idx - 対象タスクのインデックス
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function outdent(idx) { const d = load(); if (d.tasks[idx].level === 0) return; const e = subtreeEnd(d.tasks, idx); for (let k = idx; k < e; k++) d.tasks[k].level--; save(d); }
  /**
   * 指定タスク（とサブツリー）を同階層の1つ前へ移動して保存する。移動先がなければ何もしない。
   * @param {number} idx - 対象タスクのインデックス
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function moveUp(idx) { const d = load(); const tk = d.tasks; const lvl = tk[idx].level; let p = idx - 1; while (p >= 0 && tk[p].level > lvl) p--; if (p < 0 || tk[p].level < lvl) return; const block = tk.splice(idx, subtreeEnd(tk, idx) - idx); tk.splice(p, 0, ...block); save(d); }
  /**
   * 指定タスク（とサブツリー）を同階層の1つ後ろへ移動して保存する。移動先がなければ何もしない。
   * @param {number} idx - 対象タスクのインデックス
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function moveDown(idx) { const d = load(); const tk = d.tasks; const lvl = tk[idx].level; const e = subtreeEnd(tk, idx); if (e >= tk.length || tk[e].level < lvl) return; const nextEnd = subtreeEnd(tk, e); const block = tk.splice(idx, e - idx); tk.splice(idx + (nextEnd - e), 0, ...block); save(d); }
  /**
   * 指定タスクとサブツリーを削除して保存する。削除に伴い他タスクの依存参照も除去し、undo 用に退避する。
   * @param {number} idx - 対象タスクのインデックス
   * @returns {void}
   * ※ store へ保存し、lastDeleted を更新する副作用あり。
   */
  function deleteTask(idx) {
    const d = load(); const e = subtreeEnd(d.tasks, idx);
    const removed = d.tasks.splice(idx, e - idx);
    const removedIds = removed.map((t) => t.id);
    d.tasks.forEach((t) => { t.deps = t.deps.filter((id) => removedIds.indexOf(id) < 0); });
    lastDeleted = { index: idx, block: removed };
    save(d);
  }
  /**
   * 直近の deleteTask を取り消し、退避したサブツリーを元位置へ復元して保存する。退避がなければ何もしない。
   * @returns {void}
   * ※ store へ保存し、lastDeleted をクリアする副作用あり（除去済みの依存参照は復元されない）。
   */
  function undoDelete() { if (!lastDeleted) return; const d = load(); d.tasks.splice(lastDeleted.index, 0, ...lastDeleted.block); lastDeleted = null; save(d); }
  /**
   * 指定インデックスのタスクを部分更新して保存する。
   * @param {number} idx - 対象タスクのインデックス
   * @param {Partial<WbsTask>} patch - 上書きするフィールド
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function update(idx, patch) { const d = load(); Object.assign(d.tasks[idx], patch); save(d); }
  /**
   * 指定タスクの折りたたみ状態を反転して保存する。
   * @param {number} idx - 対象タスクのインデックス
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function toggleCollapse(idx) { const d = load(); d.tasks[idx].collapsed = !d.tasks[idx].collapsed; save(d); }
  /**
   * 指定タスクの担当者を名前から解決して設定・保存する。未登録名はマスタへ新規作成する（名寄せ）。空名なら null。
   * @param {number} idx - 対象タスクのインデックス
   * @param {string} name - 担当者名
   * @returns {void}
   * ※ store へ保存し、未登録名は MK.people マスタへ追加する副作用あり。
   */
  function setAssignee(idx, name) { const d = load(); d.tasks[idx].assigneeId = name && name.trim() ? MK.people.resolveOrCreate(name) : null; save(d); }
  /**
   * 指定タスクに先行タスクを追加して保存する。循環を生む場合は追加しない。
   * @param {number} idx - 後続タスクのインデックス
   * @param {number} predId - 先行タスクのID
   * @returns {boolean} 追加した（または既存で循環なし）なら true、循環のため拒否したら false
   * ※ 追加時 store へ保存する副作用あり。
   */
  function addDep(idx, predId) { const d = load(); if (depsCreatesCycle(d.tasks, d.tasks[idx].id, predId)) return false; if (d.tasks[idx].deps.indexOf(predId) < 0) d.tasks[idx].deps.push(predId); save(d); return true; }
  /**
   * 指定タスクから先行タスクの依存を除去して保存する。
   * @param {number} idx - 後続タスクのインデックス
   * @param {number} predId - 除去する先行タスクのID
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function removeDep(idx, predId) { const d = load(); d.tasks[idx].deps = d.tasks[idx].deps.filter((id) => id !== predId); save(d); }

  /**
   * 葉タスク（子を持たないタスク）を対象に全体進捗・件数を集計する。
   * @returns {{overall: number, leaves: number, done: number, inprogress: number}}
   *   全体進捗率(%)・葉タスク数・完了数・進行中数
   */
  function stats() {
    const t = tasks(); const leaves = t.filter((x, i) => !isParent(t, i));
    const cnt = { notstarted: 0, inprogress: 0, done: 0, hold: 0 }; let sum = 0;
    leaves.forEach((x) => { cnt[x.status] = (cnt[x.status] || 0) + 1; sum += Number(x.progress) || 0; });
    return { overall: leaves.length ? Math.round(sum / leaves.length) : 0, leaves: leaves.length, done: cnt.done, inprogress: cnt.inprogress };
  }

  /**
   * 全タスクをCSV行データ（ヘッダ＋各行）に整形する。親行は集計値、先行は WBS 番号で表現する。
   * @returns {string[][]} 2次元配列のCSV行データ
   */
  function buildCSVRows() {
    const t = tasks(); const nums = wbsNumbers(t);
    const rows = [["WBS番号", "タスク名", "担当者", "開始", "終了", "進捗", "ステータス", "先行", "備考"]];
    t.forEach((task, i) => {
      const r = isParent(t, i) ? summaryOf(t, i) : task;
      const assignee = task.assigneeId && MK.people.get(task.assigneeId) ? MK.people.get(task.assigneeId).name : "";
      const preds = task.deps.map((pid) => { const pi = t.findIndex((x) => x.id === pid); return pi >= 0 ? nums[pi] : ""; }).filter(Boolean).join(" ");
      const label = (STATUS.find((s) => s.key === task.status) || {}).label || task.status;
      rows.push([nums[i], task.name, assignee, r.start || "", r.end || "", String(r.progress != null ? r.progress : task.progress), label, preds, task.note || ""]);
    });
    return rows;
  }

  /**
   * エクスポート用に現在の全データを返す。
   * @returns {WbsData} 現在のWBSデータ
   */
  function exportData() { return load(); }
  /**
   * 外部データを取り込む。merge は id 一致で上書きマージ（uid は最大値を採用）、それ以外は全置換。
   * @param {WbsData} data - 取り込むデータ
   * @param {"merge"|"replace"} mode - 取り込みモード（"merge" 以外は全置換扱い）
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function importData(data, mode) {
    if (mode === "merge") {
      const d = load(); const byId = {}; d.tasks.forEach((t) => (byId[t.id] = t));
      (data.tasks || []).forEach((t) => (byId[t.id] = t));
      d.tasks = Object.keys(byId).map((k) => byId[k]);
      d.uid = Math.max(d.uid || 1, data.uid || 1); save(d);
    } else { save({ version: 1, uid: data && data.uid ? data.uid : 1, tasks: (data && data.tasks) || [] }); }
  }
  /**
   * サンプルデータを生成して保存する（既存データは全置換）。依存関係付きのツリーを構築する。
   * @returns {void}
   * ※ store へ保存し、参照メンバーを MK.people マスタへ作成する副作用あり。
   */
  function loadSample() {
    const d = { version: 1, uid: 1, tasks: [] };
    const today = MK.util.todayISO();
    const mk = (level, name, opts) => Object.assign({ id: d.uid++, level, name, assigneeId: null, start: "", end: "", progress: 0, status: "notstarted", note: "", deps: [], collapsed: false }, opts || {});
    const sato = MK.people.resolveOrCreate("佐藤 花子"), suzuki = MK.people.resolveOrCreate("鈴木 一郎"), tanaka = MK.people.resolveOrCreate("田中 美咲");
    const t1 = mk(0, "新製品ローンチ");
    const t2 = mk(1, "要件定義", { assigneeId: sato, start: today, end: MK.util.addDays(today, 4), progress: 100, status: "done" });
    const t3 = mk(1, "設計", { assigneeId: suzuki, start: MK.util.addDays(today, 5), end: MK.util.addDays(today, 9), progress: 60, status: "inprogress" });
    const t4 = mk(1, "デザイン", { assigneeId: tanaka, start: MK.util.addDays(today, 5), end: MK.util.addDays(today, 12), progress: 20, status: "inprogress" });
    const t5 = mk(1, "リリース", { start: MK.util.addDays(today, 13), end: MK.util.addDays(today, 13), status: "notstarted" });
    d.tasks = [t1, t2, t3, t4, t5];
    t3.deps = [t2.id]; t4.deps = [t2.id]; t5.deps = [t3.id, t4.id];
    save(d);
  }

  MK.logic = MK.logic || {};
  MK.logic.wbs = { STATUS, load, save, tasks, childrenRange, subtreeEnd, isParent, wbsNumbers, summaryOf, hiddenFlags, depsCreatesCycle, addRoot, addChild, addSibling, indent, outdent, moveUp, moveDown, deleteTask, undoDelete, update, toggleCollapse, setAssignee, addDep, removeDep, stats, buildCSVRows, exportData, importData, loadSample };
})();
