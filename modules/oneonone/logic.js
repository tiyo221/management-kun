/* モジュール oneonone（1on1メモ）— ロジック（データ・計算・CRUD）。DOM/UI に触れない。CONVENTIONS §1
   メンバーごとの 1on1 記録・ネクストアクションを管理する（spec/modules/oneonone.md / Issue #33）。
   People マスタを memberId で参照するが、マスタ本体は書き換えない（読み取りは view から MK.people 経由）。 */
(function () {
  "use strict";
  const MK = window.MK;
  const store = MK.store.scope("module:oneonone");

  /**
   * ネクストアクション1件。
   * @typedef {Object} OneOnOneAction
   * @property {string} id - アクションID（"a" プレフィックス）
   * @property {string} text - やること（必須）
   * @property {boolean} done - 完了フラグ
   * @property {string|null} due - 期限（"YYYY-MM-DD" または null）
   */

  /**
   * 1on1 エントリ1件。
   * @typedef {Object} OneOnOneEntry
   * @property {string} id - エントリID（"o" プレフィックス）
   * @property {string} memberId - People マスタ参照（必須）
   * @property {string} date - 実施日（"YYYY-MM-DD"）
   * @property {string} body - 話したこと（自由記述）
   * @property {OneOnOneAction[]} actions - ネクストアクション一覧
   * @property {("good"|"normal"|"bad"|null)} mood - 温度感（任意）
   * @property {string} createdAt - 作成日時（ISO 8601）
   * @property {string} updatedAt - 更新日時（ISO 8601）
   */

  /**
   * モジュールの永続データ全体。
   * @typedef {Object} OneOnOneData
   * @property {number} version - スキーマバージョン
   * @property {OneOnOneEntry[]} entries - 1on1 エントリ一覧
   * @property {string} [exportedAt] - 最終保存日時（ISO 8601）
   */

  const MOODS = [
    { key: "good", label: "😊 good" },
    { key: "normal", label: "😐 normal" },
    { key: "bad", label: "😟 bad" },
  ];

  /**
   * ストアから oneonone データを読み込む。未保存・不正形式なら空の初期データを返す。
   * @returns {OneOnOneData} 読み込んだデータ（常に entries 配列を持つ）
   */
  function load() {
    const d = store.get();
    if (!d || !Array.isArray(d.entries)) return { version: 1, entries: [] };
    return d;
  }
  /**
   * oneonone データをストアへ保存する。exportedAt を現在時刻で更新する。
   * @param {OneOnOneData} d - 保存するデータ
   * @returns {void} ※ store（localStorage）へ書き込む副作用あり。
   */
  function save(d) { d.exportedAt = MK.util.nowISO(); store.set(d); }
  /**
   * 全エントリの配列を返す（保存順のまま）。
   * @returns {OneOnOneEntry[]} エントリ一覧
   */
  function entries() { return load().entries; }

  /**
   * 指定メンバーのエントリを日付の新しい順（同日は作成の新しい順）に返す。
   * @param {string} memberId - 対象メンバーID
   * @returns {OneOnOneEntry[]} 並べ替え済みエントリ一覧
   */
  function entriesOf(memberId) {
    return entries()
      .filter((e) => e.memberId === memberId)
      .sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return (a.createdAt || "") < (b.createdAt || "") ? 1 : -1;
      });
  }

  /**
   * 指定メンバーの未完アクションを {entry, action} の組で返す（エントリは新しい順）。
   * @param {string} memberId - 対象メンバーID
   * @returns {{entry: OneOnOneEntry, action: OneOnOneAction}[]} 未完アクション一覧
   */
  function openActionsOf(memberId) {
    const out = [];
    entriesOf(memberId).forEach((e) => {
      (e.actions || []).forEach((a) => { if (!a.done) out.push({ entry: e, action: a }); });
    });
    return out;
  }

  /**
   * 未完アクションの総件数を数える（全メンバー合算）。
   * @returns {number} 未完アクション件数
   */
  function openActionCount() {
    let n = 0;
    entries().forEach((e) => (e.actions || []).forEach((a) => { if (!a.done) n++; }));
    return n;
  }

  /**
   * 指定メンバーの最終 1on1 日を返す（なければ null）。
   * @param {string} memberId - 対象メンバーID
   * @returns {string|null} 最終実施日（"YYYY-MM-DD"）または null
   */
  function lastDateOf(memberId) {
    const list = entriesOf(memberId);
    return list.length ? list[0].date : null;
  }

  /**
   * アクション配列を正規化する。text が空の要素は除外し、id が無ければ採番する。
   * 既存要素の id / done / due は渡された値をそのまま保持する（編集時に同一アクションを維持するため）。
   * @param {OneOnOneAction[]} actions - 元のアクション配列
   * @returns {OneOnOneAction[]} 検証済みアクション配列
   */
  function normalizeActions(actions) {
    return (actions || [])
      .filter((a) => a && (a.text || "").trim())
      .map((a) => ({
        id: a.id || MK.util.uid("a"),
        text: a.text.trim(),
        done: !!a.done,
        due: a.due || null,
      }));
  }

  /**
   * エントリを1件追加して保存する。memberId が空なら何もしない。
   * @param {Object} attrs - `{ memberId, date, body, actions, mood }`
   * @returns {OneOnOneEntry|null} 追加したエントリ（未追加時は null）
   * ※ store へ保存する副作用あり。
   */
  function addEntry(attrs) {
    const a = attrs || {};
    if (!a.memberId) return null;
    const d = load();
    const now = MK.util.nowISO();
    const entry = {
      id: MK.util.uid("o"),
      memberId: a.memberId,
      date: a.date || MK.util.todayISO(),
      body: a.body || "",
      actions: normalizeActions(a.actions),
      mood: a.mood || null,
      createdAt: now,
      updatedAt: now,
    };
    d.entries.unshift(entry);
    save(d);
    return entry;
  }

  /**
   * 指定エントリを部分更新して保存する（updatedAt を更新）。該当なしなら何もしない。
   * actions を渡した場合は normalizeActions で正規化する。
   * @param {string} id - 対象エントリID
   * @param {Partial<OneOnOneEntry>} patch - 上書きするフィールド
   * @returns {void} ※ store へ保存する副作用あり。
   */
  function updateEntry(id, patch) {
    const d = load();
    const e = d.entries.find((x) => x.id === id);
    if (!e) return;
    const p = Object.assign({}, patch);
    if (Object.prototype.hasOwnProperty.call(p, "actions")) p.actions = normalizeActions(p.actions);
    Object.assign(e, p);
    e.updatedAt = MK.util.nowISO();
    save(d);
  }

  /**
   * 指定エントリを削除して保存する。
   * @param {string} id - 対象エントリID
   * @returns {void} ※ store へ保存する副作用あり。
   */
  function removeEntry(id) { const d = load(); d.entries = d.entries.filter((e) => e.id !== id); save(d); }

  /**
   * 指定エントリ内アクションの done を切り替えて保存する。
   * @param {string} entryId - 対象エントリID
   * @param {string} actionId - 対象アクションID
   * @returns {void} ※ store へ保存する副作用あり。
   */
  function toggleAction(entryId, actionId) {
    const d = load();
    const e = d.entries.find((x) => x.id === entryId);
    if (!e) return;
    const a = (e.actions || []).find((x) => x.id === actionId);
    if (!a) return;
    a.done = !a.done;
    e.updatedAt = MK.util.nowISO();
    save(d);
  }

  // ---- CSV（整形・取込はロジック。ファイル選択/DLは view）spec §4.6.2 / spec/modules/oneonone.md ----
  /**
   * 日付を "YYYY-MM-DD" に正規化する。形式が違う・空なら "" を返す。
   * @param {string} v - 日付候補
   * @returns {string} 正規化した日付、または ""
   */
  function normalizeCSVDate(v) { const s = String(v == null ? "" : v).trim(); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ""; }
  /**
   * 温度感表記を内部キーへ寄せる。key（good/normal/bad）またはラベル（😊 good 等）を寛容解釈。
   * 空・不明は null（温度感は任意）。
   * @param {string} v - 温度感表記
   * @returns {("good"|"normal"|"bad"|null)} 温度感キー、または null
   */
  function moodFromCSV(v) {
    const s = String(v == null ? "" : v).trim().toLowerCase();
    if (!s) return null;
    const hit = MOODS.find((m) => s.indexOf(m.key) >= 0);
    return hit ? hit.key : null;
  }
  /**
   * アクション配列を1セル文字列へ整形する。1アクション＝1行、`状態|期限|やること` の順
   * （やることは最後尾なので `|` を含んでもよい）。状態は done/todo、期限は空可。
   * @param {OneOnOneAction[]} actions - アクション配列
   * @returns {string} セル文字列（改行区切り）
   */
  function actionsToCell(actions) {
    return (actions || [])
      .map((a) => (a.done ? "done" : "todo") + "|" + (a.due || "") + "|" + (a.text || ""))
      .join("\n");
  }
  /**
   * 1セル文字列をアクション配列へ復元する。1行＝1アクション、`状態|期限|やること`。
   * 区切りが1つ・0個でも寛容に解釈する（1個＝状態+やること、0個＝やることのみ）。
   * text が空の行は除外する（normalizeActions でも再度除外される）。
   * @param {string} cell - セル文字列
   * @returns {{text: string, done: boolean, due: (string|null)}[]} アクション配列（id は未採番）
   */
  function parseActionsCell(cell) {
    const s = String(cell == null ? "" : cell);
    if (!s.trim()) return [];
    return s.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const parts = line.split("|");
      let state = "", due = "", text = "";
      if (parts.length >= 3) { state = parts[0]; due = parts[1]; text = parts.slice(2).join("|"); }
      else if (parts.length === 2) { state = parts[0]; text = parts[1]; }
      else { text = parts[0]; }
      state = state.trim().toLowerCase();
      const d = normalizeCSVDate(due);
      return { text: text.trim(), done: state === "done" || state === "完了" || state === "x", due: d || null };
    }).filter((a) => a.text);
  }

  /**
   * 1on1 エントリを CSV 行データ（ヘッダ＋各行）に整形する。メンバーは名前で参照。
   * @returns {string[][]} 2次元配列の CSV 行データ
   */
  function buildCSVRows() {
    const nameOf = (mid) => { if (!mid) return ""; const m = MK.people.get(mid); return m ? m.name : ""; };
    const rows = [["メンバー", "実施日", "話したこと", "温度感", "アクション"]];
    entries().forEach((e) => rows.push([
      nameOf(e.memberId), e.date || "", e.body || "", e.mood || "", actionsToCell(e.actions),
    ]));
    return rows;
  }
  /**
   * CSV 行データから 1on1 エントリを取り込み、全置換して保存する。メンバー名が空の行はスキップする。
   * メンバーは名前で名寄せ（未登録は新規作成・spec §8.4）。温度感は key/ラベル両対応・不明は null。
   * 実施日は YYYY-MM-DD のみ採用し、不正・空は取込日。アクションは1セル複数行を復元する。
   * @param {string[][]} rows - CSV 行データ（1行目はヘッダ）
   * @returns {{ok: number, skip: number}} 取り込み件数・スキップ件数
   * ※ store へ保存する副作用あり（全置換）。未登録メンバー名は MK.people へ作成する副作用あり。
   */
  function applyCSV(rows) {
    const now = MK.util.nowISO();
    const today = MK.util.todayISO();
    let ok = 0, skip = 0;
    const list = [];
    rows.slice(1).forEach((r) => {
      const name = (r[0] || "").trim();
      if (!name) { skip++; return; } // メンバーは必須（名寄せ対象）
      list.push({
        id: MK.util.uid("o"), memberId: MK.people.resolveOrCreate(name),
        date: normalizeCSVDate(r[1]) || today, body: (r[2] || "").trim(),
        actions: normalizeActions(parseActionsCell(r[4])), mood: moodFromCSV(r[3]),
        createdAt: now, updatedAt: now,
      });
      ok++;
    });
    save({ version: 1, entries: list });
    return { ok, skip };
  }

  /**
   * エクスポート用に現在の全データを返す。
   * @returns {OneOnOneData} 現在の oneonone データ
   */
  function exportData() { return load(); }
  /**
   * 外部データを取り込む。merge は id 一致で上書きマージ、それ以外は全置換。
   * @param {OneOnOneData} data - 取り込むデータ
   * @param {"merge"|"replace"} mode - 取り込みモード（"merge" 以外は全置換扱い）
   * @returns {void} ※ store へ保存する副作用あり。
   */
  function importData(data, mode) {
    if (mode === "merge") {
      const d = load();
      const byId = {};
      d.entries.forEach((e) => (byId[e.id] = e));
      (data.entries || []).forEach((e) => (byId[e.id] = e));
      d.entries = Object.keys(byId).map((k) => byId[k]);
      save(d);
    } else {
      save({ version: 1, entries: (data && data.entries) || [] });
    }
  }

  /**
   * サンプルデータを生成して保存する（既存データは全置換）。
   * People マスタから先頭2名を借りる。メンバーが未登録なら空のまま保存する。
   * @returns {void} ※ store へ保存する副作用あり。
   */
  function loadSample() {
    const members = (MK.people && MK.people.all()) || [];
    if (!members.length) { save({ version: 1, entries: [] }); return; }
    const now = MK.util.nowISO();
    const dAgo = (n) => MK.util.addDays(MK.util.todayISO(), -n);
    const m0 = members[0].id;
    const m1 = (members[1] || members[0]).id;
    const mk = (memberId, date, body, actions, mood) => ({
      id: MK.util.uid("o"), memberId, date, body,
      actions: normalizeActions(actions), mood: mood || null,
      createdAt: now, updatedAt: now,
    });
    save({ version: 1, entries: [
      mk(m0, dAgo(2), "最近の稼働と体調感を確認。新機能のオーナーをやりたいとのこと。", [
        { text: "次スプリントで機能Aのリードを任せる", done: false, due: dAgo(-7) },
        { text: "1on1 頻度を隔週に変更する", done: true, due: null },
      ], "good"),
      mk(m0, dAgo(16), "レビュー負荷が高いと相談あり。ペア作業で分散する方針を合意。", [
        { text: "レビュー当番表を作る", done: true, due: null },
      ], "normal"),
      mk(m1, dAgo(5), "キャリアの方向性について。マネジメントより専門性を伸ばしたい。", [
        { text: "スキルマップで伸ばす領域を一緒に整理する", done: false, due: dAgo(-3) },
      ], "good"),
    ] });
  }

  /**
   * HOME ダッシュボード用のサマリーを算出する（spec §3.6）。
   * @returns {{empty: boolean, stats: {label: string, value: (string|number)}[]}}
   *   `empty` はデータ皆無（空状態表示）、`stats` は表示する指標の配列。
   */
  function summary() {
    const all = entries();
    return { empty: all.length === 0, stats: [
      { label: "未完アクション", value: openActionCount() },
      { label: "記録数", value: all.length },
    ] };
  }

  /**
   * エンティティ単位の任意契約（spec §3.6.1）。人1人の 1on1 概況を返す。
   * 対応するのは person のみ。その他のマスタ種別（project 等）は該当データ無し（empty）で応える
   * （§3.6.1・"project" 決め打ち分岐をしない）。集約ビュー（#83）は MK.readEntitySummary 経由で読む。
   * @param {string} entityType - マスタ種別（"person" のみ対応）
   * @param {string} id - エンティティID（person なら memberId）
   * @returns {{empty: boolean, stats: {label: string, value: (string|number)}[]}}
   */
  function summaryFor(entityType, id) {
    if (entityType !== "person") return { empty: true, stats: [] };
    const list = entriesOf(id);
    return { empty: list.length === 0, stats: [
      { label: "記録数", value: list.length },
      { label: "最終実施", value: lastDateOf(id) || "-" },
      { label: "未完アクション", value: openActionsOf(id).length },
    ] };
  }

  MK.logic = MK.logic || {};
  MK.logic.oneonone = {
    MOODS, load, save, entries, entriesOf, openActionsOf, openActionCount, lastDateOf,
    normalizeActions, addEntry, updateEntry, removeEntry, toggleAction,
    moodFromCSV, actionsToCell, parseActionsCell, buildCSVRows, applyCSV,
    summary, summaryFor, exportData, importData, loadSample,
  };
})();
