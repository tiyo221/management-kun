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
   * @property {"todo"|"manual"|"routine"} source - 由来（"todo"＝todo から引いた／"manual"＝手書き／"routine"＝ルーチン定義から自動投入）
   * @property {string|null} todoId - 由来 todo のタスクID（source="todo" のみ・完了同期に使う）
   * @property {string|null} [routineId] - 由来ルーチンID（source="routine" のみ・投入元をたどる。完了同期はしない）
   * @property {string|null} [at] - 開始時刻の固定（"HH:MM"）。値があれば時間割でその時刻に固定（ピン）、null なら従来どおり並び順に流動する
   * @property {string} createdAt - 作成日時（ISO 8601）
   * @property {string} updatedAt - 更新日時（ISO 8601）
   */

  /**
   * ルーチン定義1件（毎日決まった定型業務。該当曜日の日を開くと items へ自動投入される）。
   * 投入された項目は投入時スナップショットで独立するため、定義の変更・削除は投入済み項目へ遡及しない。
   * @typedef {Object} RoutineDef
   * @property {string} id - ルーチンID（"r" プレフィックス）
   * @property {string} title - タスク名
   * @property {number} minutes - 所要時間（分・正の整数）
   * @property {number[]} days - 適用曜日（0=日〜6=土。空・不正なら毎日扱い）
   * @property {string|null} [at] - 開始時刻の固定（"HH:MM"）。投入時に項目の at へスナップショットされる。null なら流動
   * @property {string} createdAt - 作成日時（ISO 8601）
   * @property {string} updatedAt - 更新日時（ISO 8601）
   */

  /**
   * モジュールの永続データ全体。
   * @typedef {Object} DailyData
   * @property {number} version - スキーマバージョン
   * @property {string} [startTime] - 時間割の開始起点（"HH:MM"・未設定なら DEFAULT_START）
   * @property {DailyItem[]} items - 全日ぶんの項目（date で日ごとに絞る）
   * @property {RoutineDef[]} [routines] - ルーチン定義（自動投入の元。無ければ空扱い）
   * @property {Object.<string, boolean>} [injected] - 投入済みの記録（キー "date|routineId"）。
   *   同一ルーチン×同一日に1回だけ投入し、✕で外しても同日には復活させないための台帳。
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
   * 適用曜日の配列を 0〜6（0=日〜6=土）の重複なし昇順へ正規化する。空・不正は「毎日」（全曜日）へ寄せる
   * （外部 JSON は手書き・AI 生成もありうるため寛容に受ける。曜日が壊れていても投入が止まらないようにする）。
   * @param {*} v - 適用曜日候補
   * @returns {number[]} 0〜6 の重複なし昇順（空なら全曜日）
   */
  function normDays(v) {
    if (!Array.isArray(v)) return [0, 1, 2, 3, 4, 5, 6];
    const out = [];
    v.forEach((x) => {
      const n = Math.trunc(Number(x));
      if (Number.isInteger(n) && n >= 0 && n <= 6 && out.indexOf(n) < 0) out.push(n);
    });
    out.sort((a, b) => a - b);
    return out.length ? out : [0, 1, 2, 3, 4, 5, 6];
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
  /**
   * 固定時刻（ピン）を正規化する。妥当な "HH:MM" は "09:05" 形式へ揃え、不正・空・欠落は null（流動）へ寄せる。
   * 所要時間（normMinutes）と違い、値が無いことに意味がある（＝ピンなし）ので既定へは寄せず null を返す。
   * @param {*} v - 固定時刻候補
   * @returns {string|null} "HH:MM" 形式のピン時刻、または null（流動）
   */
  function normAt(v) { return isValidTime(v) ? minToHHMM(hhmmToMin(v)) : null; }

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
    const t = todoOf(it);
    return t ? t.status === "done" : !!(it && it.done);
  }
  /**
   * 項目の由来 todo タスクを引く。todo 由来でない・todo 未搭載・実体が消えている場合は null。
   * @param {DailyItem} it - 対象項目
   * @returns {Object|null} 由来の todo タスク（無ければ null）
   */
  function todoOf(it) {
    if (!it || it.source !== "todo" || !it.todoId) return null;
    const todo = MK.logic && MK.logic.todo;
    if (!todo) return null;
    return todo.tasks().find((x) => x.id === it.todoId) || null;
  }
  /**
   * 項目1件を todo と揃えて解決する（保存はしない）。`done` と `title` の両方が対象＝
   * todo 由来項目は **todo が正**（ToDo 側でタスク名を変えたらデイリーの表示も追従する。
   * done だけ解決して title を据え置くと「実体は todo が持つ」の宣言と食い違うため）。
   * デイリーの `done` / `title` は todo 不在時のためのスナップショット。
   * @param {DailyItem} it - 対象項目
   * @returns {DailyItem} 解決後の項目（変化が無ければ同一参照）
   */
  function resolveItem(it) {
    const t = todoOf(it);
    if (!t) return it;
    const done = t.status === "done";
    return done === !!it.done && t.title === it.title ? it : Object.assign({}, it, { done, title: t.title });
  }
  /**
   * 項目配列を todo と揃えて解決した配列を返す（保存はしない）。
   * @param {DailyItem[]} list - 対象項目
   * @returns {DailyItem[]} 解決した項目一覧
   */
  function resolveAll(list) { return list.map(resolveItem); }
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
   * @param {string} [at] - 開始時刻の固定（"HH:MM"・不正/空なら流動）
   * @returns {string|null} 追加した項目ID（空タイトルなら null）
   * ※ store へ保存する副作用あり。
   */
  function addManual(date, title, minutes, at) {
    const t = String(title || "").trim();
    if (!t) return null;
    const d = load();
    const now = MK.util.nowISO();
    const id = MK.util.uid("d");
    d.items.push({ id, date, title: t, minutes: normMinutes(minutes), done: false, source: "manual", todoId: null, at: normAt(at), createdAt: now, updatedAt: now });
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
    const taken = Object.create(null); // プロトタイプ継承キー（"constructor" 等）を誤検出しない
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
   * **内部専用**（公開しない）。無検証の Object.assign なので id / date / source / todoId まで
   * 書き換えられてしまい、正規化を通す setMinutes / toggleDone と非対称になるため。
   * 外からの更新は用途別の setter（setMinutes / toggleDone）を使う。
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
   * 項目の開始時刻の固定（ピン）を設定・解除して保存する。妥当な "HH:MM" で固定、空・不正で解除（流動）。
   * @param {string} id - 対象項目ID
   * @param {string} at - "HH:MM" 形式の固定時刻（空・不正なら解除）
   * @returns {void}
   * ※ updateItem 経由で store へ保存する副作用あり。
   */
  function setAt(id, at) { updateItem(id, { at: normAt(at) }); }
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
   * 同じ日の中で項目を先頭（早い時刻）または末尾（遅い時刻）へ一括で移して保存する。
   * `↑ / ↓` を何度も押さずに狙った端へ一手で動かすためのショートカット（moveItem の粒度を補う）。
   * 端の付け替えは同日内に閉じ、他日の項目の相対順は保つ。既に端にある・該当なしなら何もしない。
   * @param {string} id - 対象項目ID
   * @param {number} dir - 向き（-1 で先頭＝朝イチ、+1 で末尾）
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function moveItemToEdge(id, dir) {
    const d = load();
    const idx = d.items.findIndex((x) => x.id === id);
    if (idx < 0) return;
    const date = d.items[idx].date;
    const sameDay = []; // 同日項目のマスタ配列上の位置（先頭・末尾の付け替え先を得る）
    d.items.forEach((x, i) => { if (x.date === date) sameDay.push(i); });
    if (sameDay.length <= 1) return; // 動かす余地がない
    const target = dir < 0 ? sameDay[0] : sameDay[sameDay.length - 1];
    if (idx === target) return; // 既にその端にある
    const [it] = d.items.splice(idx, 1);
    // 先頭は idx より前なので削除で位置がずれない。末尾は idx より後なので削除で1つ手前へ寄るが、
    // その要素の直後（＝元の末尾位置）へ挿すため splice のインデックスは target のままでよい。
    d.items.splice(target, 0, it);
    it.updatedAt = MK.util.nowISO(); // 並び順＝時刻の変更も更新（moveItem / updateItem と揃える）
    save(d);
  }
  /**
   * 項目を同日の先頭（朝イチ）へ一括で移す。
   * @param {string} id - 対象項目ID
   * @returns {void}
   * ※ moveItemToEdge 経由で store へ保存する副作用あり。
   */
  function moveItemToTop(id) { moveItemToEdge(id, -1); }
  /**
   * 項目を同日の末尾へ一括で移す。
   * @param {string} id - 対象項目ID
   * @returns {void}
   * ※ moveItemToEdge 経由で store へ保存する副作用あり。
   */
  function moveItemToEnd(id) { moveItemToEdge(id, 1); }

  // ---- ルーチン（定型業務の定義と自動投入） ----
  /**
   * ルーチン定義の一覧を返す。
   * @returns {RoutineDef[]} ルーチン定義一覧
   */
  function routines() { return load().routines || []; }
  /**
   * ルーチン定義を1件追加して保存する。
   * @param {string} title - タスク名（前後空白は trim・空なら追加しない）
   * @param {number} [minutes] - 所要時間（分・既定 30）
   * @param {number[]} [days] - 適用曜日（0=日〜6=土。空・不正なら毎日）
   * @param {string} [at] - 開始時刻の固定（"HH:MM"・不正/空なら流動。投入時に項目へスナップショット）
   * @returns {string|null} 追加したルーチンID（空タイトルなら null）
   * ※ store へ保存する副作用あり。
   */
  function addRoutine(title, minutes, days, at) {
    const t = String(title || "").trim();
    if (!t) return null;
    const d = load();
    if (!Array.isArray(d.routines)) d.routines = [];
    const now = MK.util.nowISO();
    const id = MK.util.uid("r");
    d.routines.push({ id, title: t, minutes: normMinutes(minutes), days: normDays(days), at: normAt(at), createdAt: now, updatedAt: now });
    save(d);
    return id;
  }
  /**
   * ルーチン定義を部分更新して保存する（title / minutes / days のみ・正規化を通す）。該当なしなら何もしない。
   * 定義変更は投入済み項目へ遡及しない（項目は投入時スナップショット）。
   * @param {string} id - 対象ルーチンID
   * @param {{title?: string, minutes?: number, days?: number[], at?: string|null}} patch - 上書きするフィールド
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function updateRoutine(id, patch) {
    const d = load();
    const r = (d.routines || []).find((x) => x.id === id);
    if (!r) return;
    const p = patch || {};
    if (p.title != null) { const t = String(p.title).trim(); if (t) r.title = t; } // 空へは上書きしない
    if (p.minutes != null) r.minutes = normMinutes(p.minutes);
    if (p.days != null) r.days = normDays(p.days);
    // at は null（空）が「ピン解除」の意味を持つので、undefined のときだけ据え置く（title 等の != null と非対称）。
    if (p.at !== undefined) r.at = normAt(p.at);
    r.updatedAt = MK.util.nowISO();
    save(d);
  }
  /**
   * ルーチン定義を削除して保存する（投入済み項目には手を触れない＝スナップショットとして残る）。
   * @param {string} id - 対象ルーチンID
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function removeRoutine(id) {
    const d = load();
    d.routines = (d.routines || []).filter((x) => x.id !== id);
    save(d);
  }
  /**
   * 指定日にその曜日のルーチンを自動投入する（その日を開いたときに呼ぶ・ボタン/確認なし）。
   * 冪等: 同一ルーチン×同一日は台帳（injected）で1回だけに絞り、✕で外しても同日には復活させない。
   * 過去日には投入しない（今日以降のみ）。開かなかった過去日をあとから閲覧したとき、未完了ルーチンが
   * 遡って湧いて「前日までの未処理」のノイズになるのを防ぐ。投入される項目は投入時スナップショット。
   * @param {string} date - 対象日（"YYYY-MM-DD"）
   * @returns {number} 新たに投入した件数
   * ※ store へ保存する副作用あり（投入があったときのみ）。
   */
  function ensureDayInjected(date) {
    const today = MK.util.todayISO();
    if (!isValidDate(date) || date < today) return 0; // 過去日には投入しない（今日以降のみ）
    const d = load();
    const routs = d.routines || [];
    if (!routs.length) return 0;
    const dow = new Date(date + "T00:00:00").getDay(); // 0=日〜6=土（normDays / view の WEEK と同じ並び）
    const injected = d.injected && typeof d.injected === "object" ? d.injected : (d.injected = {});
    const now = MK.util.nowISO();
    let added = 0;
    routs.forEach((r) => {
      if (!Array.isArray(r.days) || r.days.indexOf(dow) < 0) return;
      const key = date + "|" + r.id;
      if (injected[key]) return; // 投入済み（外した後も再投入しない）
      injected[key] = true;
      d.items.push({ id: MK.util.uid("d"), date, title: String(r.title == null ? "" : r.title), minutes: normMinutes(r.minutes), done: false, source: "routine", todoId: null, routineId: r.id, at: normAt(r.at), createdAt: now, updatedAt: now });
      added += 1;
    });
    if (added) save(d);
    return added;
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
    if (fromDate === toDate) return 0; // 同日への繰り越しは無意味（その日の未完了が末尾へ並び替わるだけ）
    return rolloverWhere((it) => it.date === fromDate, toDate);
  }
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
    // 締め（＝書き込み経路）でスナップショットを解決値へ治癒させる。読み取り時の解決は
    // 表示を揃えるだけで保存値は古いままなので、後から todo 実体が消えるとフォールバックが
    // 古い値を拾ってしまう（完了済み項目が未完了として復活する・旧タイトルへ戻る）。
    d.items.forEach((it) => {
      const t = todoOf(it);
      it.done = t ? t.status === "done" : !!it.done;
      if (t) it.title = t.title;
    });
    // ルーチン由来は繰り越さない。翌日は翌日ぶんが自動投入されるため、送ると同じ定型業務が二重に載る。
    // 未完了はその日に残して終わり（spec/modules/daily.md「繰り越し対象外」）。
    const pending = (it) => !it.done && it.source !== "routine" && matches(it);
    const moved = d.items.filter(pending);
    if (!moved.length) { save(d); return 0; } // 治癒結果は繰り越しが無くても残す
    d.items = d.items.filter((it) => !pending(it)); // いったん取り除いて
    moved.forEach((it) => { it.date = toDate; it.updatedAt = now; d.items.push(it); }); // 末尾へ付け直す
    save(d);
    return moved.length;
  }
  /**
   * 「取り残し」＝基準日より前に残った未完了、の判定（staleCount と summary で共有する。
   * 定義が2か所に散ると手動同期になるため）。完了状態は解決済みの項目を渡す前提。
   * @param {DailyItem} it - 解決済みの項目
   * @param {string} t - 基準日（"YYYY-MM-DD"）
   * @returns {boolean} 取り残しなら true
   */
  // ルーチン由来は繰り越し対象外なので「前日までの未処理」にも数えない（拾い直しできない未完了を
  // 警告に出しても行動につながらないノイズになる。rolloverStaleTo の除外と定義を揃える）。
  function isStale(it, t) { return it.date < t && !it.done && it.source !== "routine"; } // ISO 日付は辞書順＝時系列順
  /**
   * 指定日より前に取り残された未完了項目の件数を返す（HOME の要対応・まとめ繰り越しの導線表示用）。
   * @param {string} [today] - 基準日（"YYYY-MM-DD"・省略時は本日）
   * @returns {number} 取り残された未完了の件数
   */
  function staleCount(today) {
    const t = today || MK.util.todayISO();
    return resolvedItems().filter((it) => isStale(it, t)).length;
  }

  /**
   * 指定日の時間割（各項目の開始・終了時刻）を積み上げで算出する純関数。
   * 固定時刻（ピン＝`at`）は **下限アンカー**として効く（L1 方式）: 項目は並び順に積み上げるが、
   * ピン項目は開始を `max(積み上がり位置, at)` にする。前が余ればピン手前に空き時間（`gap`）ができ、
   * 前が押し込んでピン時刻を過ぎたら食い込み（`conflict`）として印を付ける（時刻は戻せないので積み上がり位置のまま置く）。
   * `totalMin` は空き時間を含めない所要合計、`endMin`/`endLabel` は空き時間を含む実際の終了。
   * @param {string} date - 対象日（"YYYY-MM-DD"）
   * @returns {{rows: {item: DailyItem, start: string, end: string, startMin: number, endMin: number,
   *             pinned: boolean, gap: boolean, conflict: boolean}[],
   *           totalMin: number, startMin: number, endMin: number, endLabel: string, overflow: boolean, hasConflict: boolean}}
   *   rows＝各項目の時刻付き（pinned/gap/conflict の印）、totalMin＝所要合計、endLabel＝終了時刻、
   *   overflow＝24時以降にはみ出すか、hasConflict＝いずれかの項目が固定時刻に食い込んだか
   */
  function schedule(date) {
    const start = hhmmToMin(startTime());
    let cur = start;
    let workMin = 0; // 空き時間を含めない所要の合計（ピンで生じるギャップは「合計」に数えない）
    const rows = dayItems(date).map((it) => {
      const pin = isValidTime(it.at) ? hhmmToMin(it.at) : null;
      let s = cur, gap = false, conflict = false;
      if (pin != null) {
        if (pin >= cur) { gap = pin > cur; s = pin; }  // 前が余ればピンまで空き（ちょうど一致ならギャップ無し）
        else { conflict = true; }                       // 前が押し込んでピン時刻を過ぎた＝食い込み（s=cur のまま）
      }
      const dur = normMinutes(it.minutes);
      const e = s + dur;
      workMin += dur;
      cur = e;
      return { item: it, start: minToHHMM(s), end: minToHHMM(e), startMin: s, endMin: e, pinned: pin != null, gap, conflict };
    });
    // ちょうど 24:00 で終わる場合は「またいで」いないので overflow ではない（超過のみ警告）。
    return { rows, totalMin: workMin, startMin: start, endMin: cur, endLabel: minToHHMM(cur), overflow: cur > 24 * 60, hasConflict: rows.some((r) => r.conflict) };
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
    const stale = all.filter((it) => isStale(it, t)).length; // 過去日で未処理＝まとめ繰り越し待ち（all を使い回す）
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
    // id の重複を検出して再採番する（下記）。素の {} だと "constructor" / "toString" 等の
    // プロトタイプ継承キーが真になり、重複でないのに再採番してしまう（外部 JSON は寛容に受ける前提）。
    const seen = Object.create(null);
    return (list || []).map((it) => {
      const src = it || {};
      // 既知の source（todo / routine）だけ通し、未知値は手書き扱い（todo/routine 実体を騙らせない）。
      const source = src.source === "todo" ? "todo" : src.source === "routine" ? "routine" : "manual";
      // id は欠落・重複・整数風のいずれも採番し直す。
      // - 重複を通すと、id 一致で引く moveItem/removeItem/toggleDone が先頭にしかヒットせず
      //   （2行目を編集すると1行目が変わる）、removeItem は両方消す。merge は mergeById が畳むので
      //   replace 経路にも同じ保証を与える。
      // - 整数風（"1" や 1）を通すと、mergeById が返す Object.keys が整数風キーを先頭に列挙する
      //   ため、merge 取込でその項目がその日の先頭＝朝イチへ黙って繰り上がる（配列順＝時刻のため）。
      //   文字列化しても "1" は整数風のままなので、採番し直すしかない（spec の id は d_<epoch>_<rand>）。
      const raw = src.id == null ? "" : String(src.id);
      const usable = raw && !seen[raw] && !/^(0|[1-9]\d*)$/.test(raw);
      const id = usable ? raw : MK.util.uid("d");
      seen[id] = true;
      return Object.assign({}, src, {
        id,
        date: isValidDate(src.date) ? src.date : today,
        title: String(src.title == null ? "" : src.title),
        minutes: normMinutes(src.minutes),
        done: !!src.done,
        source,
        todoId: source === "todo" && src.todoId ? src.todoId : null, // 手書き/ルーチンに todoId を残さない
        routineId: source === "routine" && src.routineId ? src.routineId : null, // 由来がルーチンのときだけ保持
        at: normAt(src.at), // 妥当な "HH:MM" だけ固定として通し、不正・欠落は null（流動）へ寄せる
        // typedef / spec が必須と宣言しているフィールドを欠落させない（取込時刻で補完する）。
        createdAt: src.createdAt || now,
        updatedAt: src.updatedAt || now,
      });
    });
  }
  /**
   * 取り込んだルーチン定義を正規化する（items と同じ寛容方針）。id 欠落・重複・整数風は採番し直し、
   * minutes は正の整数、days は不正・空なら毎日扱いへ寄せる。
   * @param {RoutineDef[]} list - 取り込むルーチン定義配列
   * @returns {RoutineDef[]} 正規化したルーチン定義配列
   */
  function normalizeRoutines(list) {
    const now = MK.util.nowISO();
    const seen = Object.create(null);
    return (list || []).map((r) => {
      const src = r || {};
      const raw = src.id == null ? "" : String(src.id);
      const usable = raw && !seen[raw] && !/^(0|[1-9]\d*)$/.test(raw); // items と同じ理由で整数風 id も採番し直す
      const id = usable ? raw : MK.util.uid("r");
      seen[id] = true;
      return {
        id,
        title: String(src.title == null ? "" : src.title),
        minutes: normMinutes(src.minutes),
        days: normDays(src.days),
        at: normAt(src.at), // 妥当な "HH:MM" だけ固定として通し、不正・欠落は null（流動）へ寄せる
        createdAt: src.createdAt || now,
        updatedAt: src.updatedAt || now,
      };
    });
  }
  /**
   * 外部データを取り込む。merge は id 一致で上書きマージ、それ以外は全置換。
   * startTime は取り込みデータにあれば採用する（merge 時は無ければ現状維持）。routines も同じ方式で寄せる。
   * 投入台帳（injected）は round-trip で失わないよう引き継ぐ（無ければ現状維持／空）。
   * @param {DailyData} data - 取り込むデータ
   * @param {"merge"|"replace"} mode - 取り込みモード（"merge" 以外は全置換扱い）
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function importData(data, mode) {
    const incoming = normalizeItems(data && data.items);
    const incomingRoutines = normalizeRoutines(data && data.routines);
    // 妥当な startTime のときだけ採用する（不正値で現在の設定を既定へ書き戻さない）。
    const start = data && isValidTime(data.startTime) ? minToHHMM(hhmmToMin(data.startTime)) : null;
    const incomingInjected = data && data.injected && typeof data.injected === "object" ? data.injected : null;
    if (mode === "merge") {
      const d = load();
      d.items = MK.util.mergeById(d.items, incoming);
      d.routines = MK.util.mergeById(d.routines || [], incomingRoutines);
      if (incomingInjected) d.injected = Object.assign(d.injected || {}, incomingInjected);
      if (start) d.startTime = start;
      save(d);
    } else {
      // replace が置き換えるのは項目（items）・ルーチン（routines）・投入台帳（injected）。
      // 開始起点は利用者の設定なので、取り込みデータに妥当な値が無ければ現状維持に倒す（merge と同じ非対称を作らない）。
      save({ version: 1, startTime: start || startTime(), items: incoming, routines: incomingRoutines, injected: incomingInjected || {} });
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
    const mk = (title, minutes, done, at) => ({ id: MK.util.uid("d"), date: today, title, minutes, done: !!done, source: "manual", todoId: null, at: at || null, createdAt: now, updatedAt: now });
    const rt = (title, minutes, days, at) => ({ id: MK.util.uid("r"), title, minutes, days, at: at || null, createdAt: now, updatedAt: now });
    // ルーチンは自動投入で items 末尾へ付くため、サンプルでは時刻を固定しない（手書き項目の後ろに
    // 付いた固定ルーチンが食い込み表示になり、初見でバグに見えるのを避ける）。固定時刻ピンは手書きの
    // 「設計レビュー」で見せる（手前に空き＋📌 の見え方を示す）。ルーチン側の固定は設定 UI で試せる。
    save({ version: 1, startTime: DEFAULT_START, routines: [
      rt("朝会", 15, [1, 2, 3, 4, 5]),   // 平日（月〜金）・時刻は流動
      rt("メールと通知をさばく", 30, [0, 1, 2, 3, 4, 5, 6]), // 毎日・時刻は流動
    ], injected: {}, items: [
      mk("企画書のドラフトを書く", 90, false),
      mk("チームの進捗を確認", 30, false),
      mk("設計レビュー", 60, false, "15:00"), // 15:00 に固定（午後の予定・手前に空きができる）
    ] });
  }

  MK.logic = MK.logic || {};
  // 公開するのは view / テストが実際に使うものだけ（YAGNI・CODING.md）。解決器（resolveItem 等）や
  // 時刻ヘルパ（hhmmToMin / minToHHMM）は内部専用に留める。load/save は他モジュールの慣例に合わせる。
  MK.logic.daily = {
    load, save, items, dayItems, startTime, setStartTime,
    addManual, pullableTodos, pullFromTodo,
    routines, addRoutine, updateRoutine, removeRoutine, ensureDayInjected,
    setMinutes, setAt, toggleDone, removeItem, moveItem, moveItemToTop, moveItemToEnd, rolloverTo, rolloverStaleTo, staleCount,
    schedule, summary, exportData, importData, loadSample,
  };
})();
