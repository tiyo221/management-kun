/* モジュール wbs — ロジック（階層計算・ロールアップ・依存・CRUD・CSV整形）。DOM/UI に触れない。CONVENTIONS §1 */
(function () {
  "use strict";
  const MK = window.MK;
  // 既定は従来の単一 namespace。scoped 化（§3.7.4）に伴い、シェルが mount 時に対象別 store
  // （mk:module:wbs:<projectId>:v1）を渡してくるので setStore で差し替える（表示中の PJ 文脈）。
  let store = MK.store.scope("module:wbs");
  function setStore(s) { if (s) store = s; }
  // 表示中の store（setStore で束ねた PJ）とは独立に、指定 PJ の対象別 store を引く。
  // export/import/サンプル投入が「現在表示中でない PJ」も扱えるようにするため（§3.7.4）。
  // targetId 未指定なら表示中の store を返す（global モジュール・テスト時の従来動作）。
  function storeFor(targetId) { return targetId != null ? MK.store.scope("module:wbs:" + targetId) : store; }

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
   * @param {{get:Function}} [s] - 読込元ストア（省略時は表示中の store）
   * @returns {WbsData} 読み込んだデータ（uid と各タスクの deps を保証）
   */
  function load(s) {
    const d = (s || store).get();
    const data = d && Array.isArray(d.tasks) ? d : { version: 1, uid: 1, tasks: [] };
    if (typeof data.uid !== "number") data.uid = data.tasks.reduce((m, t) => Math.max(m, (t.id || 0) + 1), 1);
    data.tasks.forEach((t) => { if (!Array.isArray(t.deps)) t.deps = []; });
    return data;
  }
  /**
   * WBSデータをストアへ保存する。
   * @param {WbsData} d - 保存するデータ
   * @param {{set:Function}} [s] - 保存先ストア（省略時は表示中の store）
   * @returns {void}
   * ※ store（localStorage）へ書き込む副作用あり。
   */
  function save(d, s) { (s || store).set(d); }
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
   * 日付が逆転している（開始・終了ともに設定済みで開始 > 終了）かを返す純関数。
   * 開始か終了のどちらかが未設定（空文字）なら対象外（false）。TESTING.md §1 の必須境界「日付逆転」を
   * 単一定義とし、update のガードと表示側で共有する（YYYY-MM-DD は文字列比較で日付順が一致する）。
   * @param {string} start - 開始日（YYYY-MM-DD、未設定なら空文字）
   * @param {string} end - 終了日（YYYY-MM-DD、未設定なら空文字）
   * @returns {boolean} 開始 > 終了 なら true
   */
  function datesInverted(start, end) { return !!(start && end && start > end); }
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
   * 指定インデックスのタスクを部分更新して保存する。start/end を含む patch を適用した結果が
   * 日付逆転（開始 > 終了）になる場合は不正入力として弾き、保存せず false を返す（TESTING.md §1）。
   * 日付は片方ずつ持ち込まれるため、範囲を広げる側（先に終了→開始 など）から編集すれば通る。
   * @param {number} idx - 対象タスクのインデックス
   * @param {Partial<WbsTask>} patch - 上書きするフィールド
   * @returns {boolean} 適用・保存したら true、日付逆転で拒否したら false
   * ※ 適用時 store へ保存する副作用あり。
   */
  function update(idx, patch) {
    const d = load(); const t = d.tasks[idx];
    if ("start" in patch || "end" in patch) {
      const nextStart = "start" in patch ? patch.start : t.start;
      const nextEnd = "end" in patch ? patch.end : t.end;
      if (datesInverted(nextStart, nextEnd)) return false;
    }
    Object.assign(t, patch); save(d); return true;
  }
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
   * エクスポート用にデータを返す。対象別 scope（§3.7.4）に対応し、targetId 指定時はその PJ のデータを返す。
   * @param {string} [targetId] - 対象（PJ）id。省略時は表示中の store
   * @returns {WbsData} 対象のWBSデータ
   */
  function exportData(targetId) { return load(storeFor(targetId)); }
  /**
   * 外部データを取り込む。merge は id 一致で上書きマージ（uid は最大値を採用）、それ以外は全置換。
   * @param {WbsData} data - 取り込むデータ
   * @param {"merge"|"replace"} mode - 取り込みモード（"merge" 以外は全置換扱い）
   * @param {string} [targetId] - 取り込み先の対象（PJ）id。省略時は表示中の store（§3.7.4）
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function importData(data, mode, targetId) {
    const s = storeFor(targetId);
    if (mode === "merge") {
      const d = load(s);
      d.tasks = MK.util.mergeById(d.tasks, data.tasks);
      d.uid = Math.max(d.uid || 1, data.uid || 1); save(d, s);
    } else { save({ version: 1, uid: data && data.uid ? data.uid : 1, tasks: (data && data.tasks) || [] }, s); }
  }
  /**
   * サンプルデータを生成して保存する（既存データは全置換）。依存関係付きのツリーを構築する。
   * @param {string} [targetId] - 投入先の対象（PJ）id。省略時は表示中の store（§3.7.4）
   * @returns {void}
   * ※ store へ保存し、参照メンバーを MK.people マスタへ作成する副作用あり。
   */
  function loadSample(targetId) {
    const s = storeFor(targetId);
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
    save(d, s);
  }

  /**
   * タスクが期限超過か（未完かつ終了日 < 基準日）を返す純関数。期限超過の判定は本関数を単一定義とし、
   * HOME サマリー（wbs.summary）と PJ 別集約（dashboard.wbsSummary）で共有する（二重定義を避ける・#181）。
   * 終了日未設定・基準日なしは対象外（false）。
   * @param {WbsTask} task - 判定対象タスク
   * @param {string} today - 基準日（YYYY-MM-DD）
   * @returns {boolean} 未完かつ終了日が基準日より前なら true
   */
  function isOverdue(task, today) {
    return !!(task && task.status !== "done" && task.end && today && task.end < today);
  }

  /**
   * 全プロジェクトを横断して葉タスクの HOME サマリー指標を集計する（#181）。母数は wbs.stats と同じく葉タスクのみ
   * （親のロールアップ行を二重に数えない）。期限超過の判定は isOverdue（dashboard と同一定義）を再利用する。
   * summary が消費する3指標（進行中・平均進捗・期限超過）を単一走査で数え、HOME での指標間スコープの食い違いを防ぐ。
   * @param {string} today - 基準日（YYYY-MM-DD）
   * @returns {{leaves: number, inprogress: number, overall: number, overdue: number}}
   *   全 PJ 合計の葉タスク数・進行中数・平均進捗率(%)・期限超過数
   */
  function crossProjectStats(today) {
    let leaves = 0, inprogress = 0, sum = 0, overdue = 0;
    eachProjectTasks().forEach((pj) => {
      pj.tasks.forEach((t, i) => {
        if (isParent(pj.tasks, i)) return;
        leaves++;
        if (t.status === "inprogress") inprogress++;
        sum += Number(t.progress) || 0;
        if (isOverdue(t, today)) overdue++;
      });
    });
    return { leaves, inprogress, overall: leaves ? Math.round(sum / leaves) : 0, overdue };
  }

  /**
   * HOME ダッシュボード用のサマリーを算出する（spec §3.6）。指標は全 PJ を横断して集計し（wbs は Project 次元の
   * scoped モジュールのため・§3.7.4）、進行中/進捗/期限超過のスコープを揃える。期限超過タスクがあれば attention
   * （error）で昇格し HOME 要対応バーに出す（#181）。「今日」依存の判定は基準日を引数で受けて決定的にする（§3.6）。
   * ※ モジュール自身のカード指標（表示中 PJ 単位）は stats() が担い、本 summary は HOME 横断表示専用。
   * @param {string} [baseDate] - 基準日（YYYY-MM-DD、既定 本日）。決定的テスト用の注入点。
   * @returns {{empty: boolean, stats: {label: string, value: (string|number)}[], attention?: {label: string, severity: string}[]}}
   */
  function summary(baseDate) {
    const today = baseDate || MK.util.todayISO();
    const s = crossProjectStats(today);
    const out = { empty: s.leaves === 0, stats: [
      { label: "進行中", value: s.inprogress },
      { label: "進捗", value: s.overall + "%" },
    ] };
    if (s.overdue > 0) out.attention = [{ label: "期限超過タスク " + s.overdue + "件", severity: "error" }];
    return out;
  }

  /**
   * 全プロジェクト（対象別 store）のタスクを横断して返す（横断集計の土台・§3.7.4）。
   * wbs は Project 次元の scoped モジュールで、データは PJ ごとの store に分かれて入るため、
   * 検索・人単位サマリーは表示中 PJ だけでなく全 PJ を走査する。PJ が1つも無い（＝従来の
   * 単一 namespace／テスト）場合は表示中の store をそのまま1件として返す。
   * @returns {{id: (string|null), name: string, tasks: WbsTask[]}[]}
   */
  function eachProjectTasks() {
    const projects = (MK.projects && typeof MK.projects.all === "function") ? MK.projects.all() : [];
    if (!projects.length) return [{ id: null, name: "", tasks: load(store).tasks }];
    return projects.map((p) => ({ id: p.id, name: p.name, tasks: load(storeFor(p.id)).tasks }));
  }

  /**
   * グローバル検索（コマンドパレット）用のレコードを返す（任意契約 def.searchItems・spec §3.5）。
   * 全 PJ を横断し、集計行の親タスクと完了タスクは除いて実作業（葉）を候補にする。
   * label＝タスク名、sub＝PJ 名＋ステータス、keywords に担当者名・備考を含めて本文検索できるようにする。
   * @returns {{id: string, label: string, sub: string, keywords: string[]}[]}
   */
  function searchItems() {
    const label = (key) => { const s = STATUS.find((x) => x.key === key); return s ? s.label : key; };
    const out = [];
    eachProjectTasks().forEach((pj) => {
      pj.tasks.forEach((t, i) => {
        if (isParent(pj.tasks, i) || t.status === "done" || !t.name) return;
        const assignee = t.assigneeId && MK.people.get(t.assigneeId) ? MK.people.get(t.assigneeId).name : "";
        out.push({ id: pj.id + ":" + t.id, label: t.name,
          sub: [pj.name, label(t.status)].filter(Boolean).join(" · "),
          keywords: [assignee, t.note].filter(Boolean) });
      });
    });
    return out;
  }

  /**
   * エンティティ単位の任意契約（spec §3.6.1）。人詳細の集約ビュー（#83）へ、その人が担当する
   * WBS タスクの概況を全 PJ 横断で返す。集計行の親は除き、葉タスクだけを担当として数える。
   * @param {string} entityType - マスタ種別（"person" のみ対応。他は該当なし empty）
   * @param {string} id - 対象 person の entityId
   * @returns {{empty: boolean, stats: {label: string, value: (string|number)}[]}}
   */
  function summaryFor(entityType, id) {
    if (entityType !== "person") return { empty: true, stats: [] };
    let total = 0, inprogress = 0, done = 0;
    eachProjectTasks().forEach((pj) => {
      pj.tasks.forEach((t, i) => {
        if (isParent(pj.tasks, i) || t.assigneeId !== id) return;
        total++;
        if (t.status === "inprogress") inprogress++;
        else if (t.status === "done") done++;
      });
    });
    return { empty: total === 0, stats: [
      { label: "担当タスク", value: total },
      { label: "進行中", value: inprogress },
      { label: "完了", value: done },
    ] };
  }

  MK.logic = MK.logic || {};
  MK.logic.wbs = { STATUS, load, save, setStore, tasks, childrenRange, subtreeEnd, isParent, isOverdue, wbsNumbers, summaryOf, hiddenFlags, datesInverted, depsCreatesCycle, addRoot, addChild, addSibling, indent, outdent, moveUp, moveDown, deleteTask, undoDelete, update, toggleCollapse, setAssignee, addDep, removeDep, stats, summary, searchItems, summaryFor, eachProjectTasks, buildCSVRows, exportData, importData, loadSample };
})();
