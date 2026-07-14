/* モジュール daily（デイリー＝今日のタイムボクシング）— ロジック（データ・計算・CRUD）。
   DOM/UI に触れない。CONVENTIONS §1 / spec/modules/daily.md */
(function () {
  "use strict";
  const MK = window.MK;
  // 保存は「日付フィールドを持つフラットな items[] 配列」1本。日ごとの器は items を date で
  // 絞って表現する（別 namespace は作らない・global スコープ）。startTime は同じエンベロープに
  // 相乗りする単一の開始起点（記憶する）。store.collection の既定は { version, items:[] } を返し、
  // startTime 未設定時は startTime() が既定値へフォールバックする。
  const col = MK.store.collection("module:daily", { key: "items" });
  const { load, save } = col;

  const DEFAULT_START = "09:00"; // 時間割の既定の開始時刻（開始起点は記憶する・未設定時のみ使う）
  const DEFAULT_MIN = 30;        // 所要時間の既定（分）

  /**
   * デイリー項目1件（その日にやると決めた1タスク）。
   * @typedef {Object} DailyItem
   * @property {string} id - 項目ID（"d" プレフィックス）
   * @property {string} date - 所属する日（"YYYY-MM-DD"）
   * @property {string} title - タスク名
   * @property {number} minutes - 所要時間（分・正の整数）
   * @property {boolean} done - 完了フラグ
   * @property {"todo"|"manual"} source - 由来（"todo"＝todo から引いた／"manual"＝デイリー限定の手書き）
   * @property {string|null} todoId - 由来 todo のタスクID（source="todo" のみ・完了同期に使う）
   * @property {string} createdAt - 作成日時（ISO 8601）
   * @property {string} updatedAt - 更新日時（ISO 8601）
   */

  /**
   * モジュールの永続データ全体。
   * @typedef {Object} DailyData
   * @property {number} version - スキーマバージョン
   * @property {string} [startTime] - 時間割の開始起点（"HH:MM"・未設定なら DEFAULT_START）
   * @property {DailyItem[]} items - 全日ぶんの項目（date で日ごとに絞る）
   */

  // ---- 時刻ヘルパ（"HH:MM" ↔ 0時からの分。DOM 非依存の純関数） ----
  /**
   * "HH:MM" を 0 時からの分に変換する。不正な値は既定（9:00＝540）へ寄せる。
   * @param {string} hhmm - "HH:MM" 形式の時刻
   * @returns {number} 0 時からの分
   */
  function hhmmToMin(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
    if (!m) return hhmmToMin(DEFAULT_START);
    const h = Number(m[1]), mm = Number(m[2]);
    if (h > 23 || mm > 59) return hhmmToMin(DEFAULT_START);
    return h * 60 + mm;
  }
  /**
   * 0 時からの分を "HH:MM" に変換する。24 時以降（日をまたぐ溢れ）は "25:30" のように
   * 時が 24 以上のまま表示して、はみ出しを可視化する。
   * @param {number} min - 0 時からの分（非負）
   * @returns {string} "HH:MM" 形式の時刻
   */
  function minToHHMM(min) {
    const t = Math.max(0, Math.round(min));
    const h = Math.floor(t / 60), mm = t % 60;
    const p = (n) => String(n).padStart(2, "0");
    return p(h) + ":" + mm.toString().padStart(2, "0");
  }
  /**
   * 所要時間を正の整数（分）へ正規化する。不正・0 以下は既定へ寄せる。
   * @param {*} v - 所要時間候補
   * @returns {number} 正の整数（分）
   */
  function normMinutes(v) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_MIN;
  }

  // ---- 参照 ----
  /**
   * 全項目の配列を返す（全日ぶん）。
   * @returns {DailyItem[]} 項目一覧
   */
  function items() { return load().items; }
  /**
   * 開始起点（時間割を積み始める時刻）を返す。未設定なら既定（9:00）。
   * @returns {string} "HH:MM" 形式の開始時刻
   */
  function startTime() { const d = load(); return d.startTime || DEFAULT_START; }
  /**
   * 開始起点を設定して保存する（記憶する）。
   * @param {string} hhmm - "HH:MM" 形式の開始時刻
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function setStartTime(hhmm) { const d = load(); d.startTime = minToHHMM(hhmmToMin(hhmm)); save(d); }
  /**
   * 指定日の項目を配列順（＝時間割の積み上げ順）で返す。
   * @param {string} date - 対象日（"YYYY-MM-DD"）
   * @returns {DailyItem[]} その日の項目一覧
   */
  function dayItems(date) { return items().filter((it) => it.date === date); }

  // ---- CRUD ----
  /**
   * デイリー限定（todo 非連動）の手書き項目を1件、指定日の末尾に追加して保存する。
   * @param {string} date - 対象日（"YYYY-MM-DD"）
   * @param {string} title - タスク名（前後空白は trim・空なら追加しない）
   * @param {number} [minutes] - 所要時間（分・既定 30）
   * @returns {string|null} 追加した項目ID（空タイトルなら null）
   * ※ store へ保存する副作用あり。
   */
  function addManual(date, title, minutes) {
    const t = String(title || "").trim();
    if (!t) return null;
    const d = load();
    const now = MK.util.nowISO();
    const id = MK.util.uid("d");
    d.items.push({ id, date, title: t, minutes: normMinutes(minutes), done: false, source: "manual", todoId: null, createdAt: now, updatedAt: now });
    save(d);
    return id;
  }

  /**
   * todo から「今日の候補」に引ける next タスクの一覧を返す。指定日に既に引き込み済みの
   * todo は除外する。todo モジュール未搭載（配布サブセット等）なら空配列を返す。
   * @param {string} date - 対象日（"YYYY-MM-DD"）
   * @returns {{id: string, title: string, projectName: string}[]} 引き込める next タスク
   */
  function pullableTodos(date) {
    const todo = MK.logic && MK.logic.todo;
    if (!todo) return [];
    const taken = {};
    dayItems(date).forEach((it) => { if (it.source === "todo" && it.todoId) taken[it.todoId] = true; });
    return todo.tasks()
      .filter((t) => t.status === "next" && !taken[t.id])
      .map((t) => ({ id: t.id, title: t.title, projectName: todo.projectNameOf(t.projectId) }));
  }
  /**
   * todo の next タスクを「今日の候補」へ引き込み、指定日の末尾に追加して保存する。
   * 実体は todo が持ち、デイリーは todoId で参照しつつ表示用にタイトルをスナップショットする。
   * 既に同日へ引き込み済み・next でない・todo 未搭載・該当なしの場合は何もしない。
   * @param {string} date - 対象日（"YYYY-MM-DD"）
   * @param {string} todoId - 引き込む todo タスクのID
   * @param {number} [minutes] - 所要時間（分・既定 30）
   * @returns {string|null} 追加した項目ID（引き込めなければ null）
   * ※ store へ保存する副作用あり。
   */
  function pullFromTodo(date, todoId, minutes) {
    const todo = MK.logic && MK.logic.todo;
    if (!todo) return null;
    const t = todo.tasks().find((x) => x.id === todoId);
    if (!t || t.status !== "next") return null;
    if (dayItems(date).some((it) => it.source === "todo" && it.todoId === todoId)) return null;
    const d = load();
    const now = MK.util.nowISO();
    const id = MK.util.uid("d");
    d.items.push({ id, date, title: t.title, minutes: normMinutes(minutes), done: false, source: "todo", todoId: todoId, createdAt: now, updatedAt: now });
    save(d);
    return id;
  }

  /**
   * 指定項目を部分更新して保存する（updatedAt を現在時刻で更新）。該当なしなら何もしない。
   * @param {string} id - 対象項目ID
   * @param {Partial<DailyItem>} patch - 上書きするフィールド
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function updateItem(id, patch) {
    const d = load();
    const it = d.items.find((x) => x.id === id);
    if (!it) return;
    Object.assign(it, patch);
    it.updatedAt = MK.util.nowISO();
    save(d);
  }
  /**
   * 所要時間を更新して保存する（正の整数へ正規化）。
   * @param {string} id - 対象項目ID
   * @param {number} minutes - 所要時間（分）
   * @returns {void}
   * ※ updateItem 経由で store へ保存する副作用あり。
   */
  function setMinutes(id, minutes) { updateItem(id, { minutes: normMinutes(minutes) }); }
  /**
   * 項目の完了状態を切り替える。由来が todo の項目は todo 側の完了も同期する
   * （完了→done／解除→next。実体は todo が持つため・spec/modules/daily.md）。
   * @param {string} id - 対象項目ID
   * @param {boolean} done - true で完了、false で未完了に戻す
   * @returns {void}
   * ※ store へ保存する副作用あり。todo 由来なら MK.logic.todo へも書き込む副作用あり。
   */
  function toggleDone(id, done) {
    const it = items().find((x) => x.id === id);
    if (!it) return;
    updateItem(id, { done: !!done });
    const todo = MK.logic && MK.logic.todo;
    if (it.source === "todo" && it.todoId && todo) todo.toggleDone(it.todoId, !!done);
  }
  /**
   * 指定項目をデイリーから外して保存する（削除＝今日やらない。todo 実体には手を触れない）。
   * @param {string} id - 対象項目ID
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function removeItem(id) { const d = load(); d.items = d.items.filter((it) => it.id !== id); save(d); }
  /**
   * 同じ日の中で項目の並び順を1つ前/後ろへ動かして保存する（時間割の前後移動）。
   * 端で範囲外になる移動は無視する。
   * @param {string} id - 対象項目ID
   * @param {number} dir - 移動方向（-1 で前＝早い時刻、+1 で後ろ＝遅い時刻）
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function moveItem(id, dir) {
    const d = load();
    const it = d.items.find((x) => x.id === id);
    if (!it) return;
    const sameDay = d.items.filter((x) => x.date === it.date);
    const pos = sameDay.indexOf(it), target = pos + dir;
    if (pos < 0 || target < 0 || target >= sameDay.length) return;
    // 同日内の隣接項目とマスタ配列上の位置を入れ替える（他日の項目が挟まっても正しく動く）。
    const a = d.items.indexOf(sameDay[pos]), b = d.items.indexOf(sameDay[target]);
    const tmp = d.items[a]; d.items[a] = d.items[b]; d.items[b] = tmp;
    save(d);
  }

  /**
   * 指定日の未完了項目を翌日（toDate）の末尾へ繰り越して保存する（夕方の締め）。
   * 完了済みはその日に履歴として残す。移した項目は todoId 等の紐付けを保ったまま toDate に付く。
   * @param {string} fromDate - 繰り越し元の日（"YYYY-MM-DD"）
   * @param {string} toDate - 繰り越し先の日（"YYYY-MM-DD"）
   * @returns {number} 繰り越した件数
   * ※ store へ保存する副作用あり。
   */
  function rolloverTo(fromDate, toDate) {
    const d = load();
    const now = MK.util.nowISO();
    const moved = d.items.filter((it) => it.date === fromDate && !it.done);
    if (!moved.length) return 0;
    d.items = d.items.filter((it) => !(it.date === fromDate && !it.done)); // いったん取り除いて
    moved.forEach((it) => { it.date = toDate; it.updatedAt = now; d.items.push(it); }); // 末尾へ付け直す
    save(d);
    return moved.length;
  }

  /**
   * 指定日の時間割（各項目の開始・終了時刻）を積み上げで算出する純関数。
   * @param {string} date - 対象日（"YYYY-MM-DD"）
   * @param {string} [startOverride] - 開始起点の上書き（"HH:MM"・省略時は保存値）
   * @returns {{rows: {item: DailyItem, start: string, end: string, startMin: number, endMin: number}[],
   *           totalMin: number, startMin: number, endMin: number, endLabel: string, overflow: boolean}}
   *   rows＝各項目の時刻付き、totalMin＝所要合計、endLabel＝終了時刻、overflow＝24時以降にはみ出すか
   */
  function schedule(date, startOverride) {
    const start = hhmmToMin(startOverride || startTime());
    let cur = start;
    const rows = dayItems(date).map((it) => {
      const s = cur, e = cur + normMinutes(it.minutes);
      cur = e;
      return { item: it, start: minToHHMM(s), end: minToHHMM(e), startMin: s, endMin: e };
    });
    return { rows, totalMin: cur - start, startMin: start, endMin: cur, endLabel: minToHHMM(cur), overflow: cur >= 24 * 60 };
  }

  // ---- HOME サマリー（spec §3.6） ----
  /**
   * HOME ダッシュボード用のサマリーを算出する（spec §3.6・行動につながる指標 §3.6 方針）。
   * @param {string} [today] - 基準日（"YYYY-MM-DD"・省略時は本日。決定的テスト用）
   * @returns {{empty: boolean, stats: {label: string, value: (string|number)}[], attention: {label: string, severity: string}[]}}
   *   stats＝今日の残り／予定終了、attention＝前日までの未処理・日またぎ（いずれも要対応）
   */
  function summary(today) {
    const t = today || MK.util.todayISO();
    const all = items();
    const todays = all.filter((it) => it.date === t);
    const remaining = todays.filter((it) => !it.done).length;
    const stale = all.filter((it) => it.date < t && !it.done).length; // 過去日で未処理＝繰り越し/整理待ち
    const sched = schedule(t);
    const attention = [];
    if (stale > 0) attention.push({ label: "前日までの未処理 " + stale + "件", severity: "warn" });
    if (sched.overflow) attention.push({ label: "今日の予定が日をまたぎます", severity: "warn" });
    return { empty: all.length === 0, stats: [
      { label: "今日の残り", value: remaining },
      { label: "予定終了", value: todays.length ? sched.endLabel : "—" },
    ], attention };
  }

  // ---- JSON エクスポート/インポート（§3.5） ----
  /**
   * エクスポート用に現在の全データを返す。
   * @returns {DailyData} 現在のデイリーデータ
   */
  function exportData() { return load(); }
  /**
   * 外部データを取り込む。merge は id 一致で上書きマージ、それ以外は全置換。
   * startTime は取り込みデータにあれば採用する（merge 時は無ければ現状維持）。
   * @param {DailyData} data - 取り込むデータ
   * @param {"merge"|"replace"} mode - 取り込みモード（"merge" 以外は全置換扱い）
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function importData(data, mode) {
    if (mode === "merge") {
      const d = load();
      d.items = MK.util.mergeById(d.items, (data && data.items) || []);
      if (data && data.startTime) d.startTime = data.startTime;
      save(d);
    } else {
      save({ version: 1, startTime: (data && data.startTime) || DEFAULT_START, items: (data && data.items) || [] });
    }
  }
  /**
   * サンプルデータを生成して保存する（既存データは全置換）。
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function loadSample() {
    const today = MK.util.todayISO();
    const now = MK.util.nowISO();
    const mk = (title, minutes, done) => ({ id: MK.util.uid("d"), date: today, title, minutes, done: !!done, source: "manual", todoId: null, createdAt: now, updatedAt: now });
    save({ version: 1, startTime: DEFAULT_START, items: [
      mk("メールと通知をさばく", 30, true),
      mk("企画書のドラフトを書く", 90, false),
      mk("チームの進捗を確認", 30, false),
      mk("設計レビュー", 60, false),
    ] });
  }

  MK.logic = MK.logic || {};
  MK.logic.daily = {
    load, save, items, dayItems, startTime, setStartTime,
    addManual, pullableTodos, pullFromTodo,
    updateItem, setMinutes, toggleDone, removeItem, moveItem, rolloverTo,
    schedule, hhmmToMin, minToHHMM,
    summary, exportData, importData, loadSample,
  };
})();
