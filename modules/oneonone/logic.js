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

  MK.logic = MK.logic || {};
  MK.logic.oneonone = {
    MOODS, load, save, entries, entriesOf, openActionsOf, openActionCount, lastDateOf,
    normalizeActions, addEntry, updateEntry, removeEntry, toggleAction,
    summary, exportData, importData, loadSample,
  };
})();
