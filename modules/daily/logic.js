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
    const p = (n) => String(n).padStart(2, "0");
    return p(Math.floor(t / 60)) + ":" + p(t % 60);
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
  /**
   * "YYYY-MM-DD" として実在する日付かを判定する。書式だけでなく暦としての妥当性も見る
   * （"2026-02-31" のような日は addDays が生成せず、どの日の器からも到達できない項目になるため）。
   * @param {*} v - 日付候補
   * @returns {boolean} 実在する日付なら true
   */
  function isValidDate(v) {
    const s = String(v == null ? "" : v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(s + "T00:00:00");
    return !isNaN(d.getTime()) && MK.util.fmtDate(d) === s; // 繰り上がった日付は元の文字列と一致しない
  }
  /**
   * "HH:MM" として妥当な時刻かを判定する（不正なら呼び出し側が既定へ寄せる／現状維持にする）。
   * @param {*} v - 時刻候補
   * @returns {boolean} 妥当なら true
   */
  function isValidTime(v) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(v == null ? "" : v).trim());
    return !!m && Number(m[1]) <= 23 && Number(m[2]) <= 59;
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
   * 項目の完了状態を解決する。`source:"todo"` の項目は **todo の状態が正**（実体は todo が持ち、
   * デイリーの `done` は表示用スナップショット）。これにより ToDo 画面側で完了しても
   * デイリーへ反映され、「今日の残り」に居座って毎日繰り越され続ける不整合を防ぐ。
   * todo 未搭載（配布サブセット）・todo 実体が消えている場合はスナップショットへフォールバックする。
   * @param {DailyItem} it - 対象項目
   * @returns {boolean} 解決後の完了状態
   */
  function resolveDone(it) {
    if (!it || it.source !== "todo" || !it.todoId) return !!(it && it.done);
    const todo = MK.logic && MK.logic.todo;
    if (!todo) return !!it.done;
    const t = todo.tasks().find((x) => x.id === it.todoId);
    return t ? t.status === "done" : !!it.done;
  }
  /**
   * 項目配列の完了状態を todo と揃えて解決した配列を返す（保存はしない）。
   * @param {DailyItem[]} list - 対象項目
   * @returns {DailyItem[]} 完了状態を解決した項目一覧
   */
  function resolveAll(list) {
    return list.map((it) => {
      const done = resolveDone(it);
      return done === !!it.done ? it : Object.assign({}, it, { done });
    });
  }
  /**
   * 完了状態を todo と揃えた全項目を返す（読み取り用。保存はしない）。
   * @returns {DailyItem[]} 完了状態を解決した項目一覧
   */
  function resolvedItems() { return resolveAll(items()); }
  /**
   * 指定日の項目を配列順（＝時間割の積み上げ順）で返す。完了状態は todo と揃えて解決する。
   * 解決は todo の走査を伴うため、先に date で絞ってからその日ぶんだけ解決する。
   * @param {string} date - 対象日（"YYYY-MM-DD"）
   * @returns {DailyItem[]} その日の項目一覧
   */
  function dayItems(date) { return resolveAll(items().filter((it) => it.date === date)); }

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
   * 未完了のまま**いずれかの日に載っている** todo の id 集合を返す（重複引き込みの防止）。
   * 実体（todo）は1つなので、同じ todo が複数の日に載ると同じ仕事を二重に計上することになる
   * （両日で時間を確保し、両日の「残り」に数えられる）。日を移すのは繰り越し＝rolloverTo が
   * 正規の経路。なお完了状態自体は resolveDone が todo から解決するので表示は食い違わない。
   * @returns {Object.<string, boolean>} todoId をキーに持つ集合
   */
  function activeTodoIds() {
    const taken = {};
    resolvedItems().forEach((it) => { if (it.source === "todo" && it.todoId && !it.done) taken[it.todoId] = true; });
    return taken;
  }
  /**
   * todo から「今日の候補」に引ける next タスクの一覧を返す。未完了のまま既にどこかの日へ
   * 引き込み済みの todo は除外する。todo モジュール未搭載（配布サブセット等）なら空配列を返す。
   * @returns {{id: string, title: string, projectName: string}[]} 引き込める next タスク
   */
  function pullableTodos() {
    const todo = MK.logic && MK.logic.todo;
    if (!todo) return [];
    const taken = activeTodoIds();
    return todo.tasks()
      .filter((t) => t.status === "next" && !taken[t.id])
      .map((t) => ({ id: t.id, title: t.title, projectName: todo.projectNameOf(t.projectId) }));
  }
  /**
   * todo の next タスクを「今日の候補」へ引き込み、指定日の末尾に追加して保存する。
   * 実体は todo が持ち、デイリーは todoId で参照しつつ表示用にタイトルをスナップショットする。
   * 未完了のまま既にいずれかの日へ引き込み済み・next でない・todo 未搭載・該当なしの場合は何もしない。
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
    if (activeTodoIds()[todoId]) return null; // 日をまたいだ重複引き込みも許さない
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
    const now = MK.util.nowISO(); // 並び順＝時刻の変更も更新（updateItem / rolloverTo と揃える）
    d.items[a].updatedAt = now; d.items[b].updatedAt = now;
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
  function rolloverTo(fromDate, toDate) { return rolloverWhere((it) => it.date === fromDate, toDate); }
  /**
   * 指定日より前に取り残された未完了項目を、まとめて toDate の末尾へ繰り越して保存する。
   * 夜の締めを数日忘れても、日を遡って1日ずつ繰り越し直さずに拾い直せるようにするための動線
   * （HOME の要対応「前日までの未処理 N件」の解消手段）。
   * @param {string} toDate - 繰り越し先の日（"YYYY-MM-DD"。通常は本日）
   * @returns {number} 繰り越した件数
   * ※ store へ保存する副作用あり。
   */
  function rolloverStaleTo(toDate) { return rolloverWhere((it) => it.date < toDate, toDate); }
  /**
   * 繰り越しの共通実装。`matches` に合う未完了項目を toDate の末尾へ移して件数を返す。
   * 併せてスナップショットを解決値へ治癒させる（書き込み経路のため。resolveDone の項参照）。
   * @param {function(DailyItem): boolean} matches - 繰り越し対象の判定
   * @param {string} toDate - 繰り越し先の日（"YYYY-MM-DD"）
   * @returns {number} 繰り越した件数
   * ※ store へ保存する副作用あり。
   */
  function rolloverWhere(matches, toDate) {
    const d = load();
    const now = MK.util.nowISO();
    // 締め（＝書き込み経路）でスナップショットを解決値へ治癒させる。読み取り時の resolveDone は
    // 表示を揃えるだけで保存値は古いままなので、後から todo 実体が消えるとフォールバックが
    // 古い false を拾って完了済み項目が未完了として復活してしまう。
    d.items.forEach((it) => { it.done = resolveDone(it); });
    const pending = (it) => !it.done && matches(it);
    const moved = d.items.filter(pending);
    if (!moved.length) { save(d); return 0; } // 治癒結果は繰り越しが無くても残す
    d.items = d.items.filter((it) => !pending(it)); // いったん取り除いて
    moved.forEach((it) => { it.date = toDate; it.updatedAt = now; d.items.push(it); }); // 末尾へ付け直す
    save(d);
    return moved.length;
  }
  /**
   * 指定日より前に取り残された未完了項目の件数を返す（HOME の要対応・まとめ繰り越しの導線表示用）。
   * @param {string} [today] - 基準日（"YYYY-MM-DD"・省略時は本日）
   * @returns {number} 取り残された未完了の件数
   */
  function staleCount(today) {
    const t = today || MK.util.todayISO();
    return resolvedItems().filter((it) => it.date < t && !it.done).length;
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
    // ちょうど 24:00 で終わる場合は「またいで」いないので overflow ではない（超過のみ警告）。
    return { rows, totalMin: cur - start, startMin: start, endMin: cur, endLabel: minToHHMM(cur), overflow: cur > 24 * 60 };
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
    const all = resolvedItems(); // 完了は todo と揃えた解決値で数える
    const todays = all.filter((it) => it.date === t);
    const remaining = todays.filter((it) => !it.done).length;
    const stale = all.filter((it) => it.date < t && !it.done).length; // 過去日で未処理＝まとめ繰り越し待ち
    const sched = schedule(t);
    const attention = [];
    if (stale > 0) attention.push({ label: "前日までの未処理 " + stale + "件", severity: "warn" });
    // はみ出しは「まだやることが残っている」ときだけ警告する。時間割の合計・終了時刻は1日の
    // 計画として完了分も含むが、全部終わった夜まで警告し続けるのは行動につながらないノイズ。
    if (sched.overflow && remaining > 0) attention.push({ label: "今日の予定が日をまたぎます", severity: "warn" });
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
   * 取り込んだ項目を正規化する（外部 JSON は手書き・AI 生成もありうるため寛容に受けて寄せる）。
   * id 欠落は採番（mergeById が byId[undefined] へ集約して取りこぼすため、また id 一致で引く
   * moveItem/removeItem/toggleDone が別項目へ誤ヒットするため）。date は不正・欠落なら当日へ寄せる
   * （どの日にも属さないと画面から到達できない項目になるため）。minutes は正の整数、done は真偽値へ。
   * @param {DailyItem[]} list - 取り込む項目配列
   * @returns {DailyItem[]} 正規化した項目配列
   */
  function normalizeItems(list) {
    const today = MK.util.todayISO();
    const now = MK.util.nowISO();
    const seen = {}; // id の重複を検出して再採番する（下記）
    return (list || []).map((it) => {
      const src = it || {};
      const source = src.source === "todo" ? "todo" : "manual"; // 未知値は手書き扱い（todo 実体を騙らせない）
      // id は欠落だけでなく**重複**も潰す。重複したまま通すと、id 一致で引く
      // moveItem/removeItem/toggleDone が先頭にしかヒットせず（2行目を編集すると1行目が変わる）、
      // removeItem は両方消す。merge は mergeById が畳むので、replace 経路にも同じ保証を与える。
      const id = src.id && !seen[src.id] ? src.id : MK.util.uid("d");
      seen[id] = true;
      return Object.assign({}, src, {
        id,
        date: isValidDate(src.date) ? src.date : today,
        title: String(src.title == null ? "" : src.title),
        minutes: normMinutes(src.minutes),
        done: !!src.done,
        source,
        todoId: source === "todo" && src.todoId ? src.todoId : null, // 手書きに todoId を残さない
        // typedef / spec が必須と宣言しているフィールドを欠落させない（取込時刻で補完する）。
        createdAt: src.createdAt || now,
        updatedAt: src.updatedAt || now,
      });
    });
  }
  /**
   * 外部データを取り込む。merge は id 一致で上書きマージ、それ以外は全置換。
   * startTime は取り込みデータにあれば採用する（merge 時は無ければ現状維持）。
   * @param {DailyData} data - 取り込むデータ
   * @param {"merge"|"replace"} mode - 取り込みモード（"merge" 以外は全置換扱い）
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function importData(data, mode) {
    const incoming = normalizeItems(data && data.items);
    // 妥当な startTime のときだけ採用する（不正値で現在の設定を既定へ書き戻さない）。
    const start = data && isValidTime(data.startTime) ? minToHHMM(hhmmToMin(data.startTime)) : null;
    if (mode === "merge") {
      const d = load();
      d.items = MK.util.mergeById(d.items, incoming);
      if (start) d.startTime = start;
      save(d);
    } else {
      // replace が置き換えるのは項目（items）。開始起点は利用者の設定なので、取り込みデータに
      // 妥当な値が無ければ現状維持に倒す（merge と同じ非対称を作らない）。
      save({ version: 1, startTime: start || startTime(), items: incoming });
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
    load, save, items, resolvedItems, resolveDone, dayItems, startTime, setStartTime,
    addManual, pullableTodos, pullFromTodo,
    updateItem, setMinutes, toggleDone, removeItem, moveItem, rolloverTo, rolloverStaleTo, staleCount,
    schedule, hhmmToMin, minToHHMM,
    summary, exportData, importData, loadSample,
  };
})();
