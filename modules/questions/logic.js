/* モジュール questions — ロジック（データ・計算・CRUD）。DOM/UI に触れない。CONVENTIONS §1 */
(function () {
  "use strict";
  const MK = window.MK;
  const store = MK.store.scope("module:questions");

  /**
   * ステータス定義（key＝内部値、label＝表示名）。表示順もこの配列順に従う。
   * @typedef {Object} QuestionStatus
   * @property {string} key - 内部キー（"open" | "investigating" | "resolved"）
   * @property {string} label - 画面表示名
   */

  /**
   * わからないこと1件のレコード。
   * @typedef {Object} QuestionItem
   * @property {string} id - アイテムID（"q" プレフィックス）
   * @property {string} title - わからないこと（必須）
   * @property {string} detail - 背景・メモ（任意）
   * @property {string} status - ステータスキー（{@link QuestionStatus} の key）
   * @property {string[]} tags - 自由タグ（任意）
   * @property {string} resolvedNote - 「わかった」内容（任意）
   * @property {string} createdAt - 作成日時（ISO 8601）
   * @property {string} updatedAt - 更新日時（ISO 8601）
   * @property {string|null} resolvedAt - 解決日時（未解決なら null）
   */

  /**
   * モジュールの永続データ全体。
   * @typedef {Object} QuestionsData
   * @property {number} version - スキーマバージョン
   * @property {QuestionItem[]} items - わからないこと一覧
   * @property {string} [exportedAt] - 最終保存日時（ISO 8601）
   */

  const STATUSES = [
    { key: "open", label: "未解決" },
    { key: "investigating", label: "調査中" },
    { key: "resolved", label: "わかった" },
  ];

  /**
   * ストアから questions データを読み込む。未保存・不正形式なら空の初期データを返す。
   * @returns {QuestionsData} 読み込んだデータ（常に items 配列を持つ）
   */
  function load() {
    const d = store.get();
    if (!d || !Array.isArray(d.items)) return { version: 1, items: [] };
    return d;
  }
  /**
   * questions データをストアへ保存する。exportedAt を現在時刻で更新する。
   * @param {QuestionsData} d - 保存するデータ
   * @returns {void}
   * ※ store（localStorage）へ書き込む副作用あり。
   */
  function save(d) { d.exportedAt = MK.util.nowISO(); store.set(d); }
  /**
   * 全アイテムの配列を返す。
   * @returns {QuestionItem[]} わからないこと一覧
   */
  function items() { return load().items; }

  /**
   * ステータス別および全体のアイテム件数を集計する。
   * @returns {Object.<string, number>} `all` と各ステータスキーをキーに持つ件数マップ
   */
  function counts() {
    const c = { all: 0 };
    STATUSES.forEach((s) => (c[s.key] = 0));
    items().forEach((it) => { c.all++; c[it.status] = (c[it.status] || 0) + 1; });
    return c;
  }

  /**
   * ステータスと検索語でアイテムを絞り込む。
   * @param {string} filter - 絞り込むステータスキー（"all" または未指定で全件）
   * @param {string} search - タイトル・詳細・タグを対象とする検索語（名寄せキーで部分一致）
   * @returns {QuestionItem[]} 条件に合致したアイテム一覧
   */
  function filtered(filter, search) {
    const q = MK.util.normalizeKey(search || "");
    let list = items();
    if (filter && filter !== "all") list = list.filter((it) => it.status === filter);
    if (q) list = list.filter((it) =>
      MK.util.normalizeKey(it.title).includes(q) ||
      MK.util.normalizeKey(it.detail).includes(q) ||
      (it.tags || []).some((t) => MK.util.normalizeKey(t).includes(q)));
    return list;
  }

  /**
   * わからないことを1件追加して保存する（先頭に挿入、status は "open"）。
   * @param {string} title - わからないこと（前後空白は trim される）
   * @returns {void}
   * ※ store へ保存する副作用あり。空タイトルは何もしない。
   */
  function addItem(title) {
    const t = (title || "").trim();
    if (!t) return;
    const d = load();
    const now = MK.util.nowISO();
    d.items.unshift({
      id: MK.util.uid("q"), title: t, detail: "", status: "open",
      tags: [], resolvedNote: "", createdAt: now, updatedAt: now, resolvedAt: null,
    });
    save(d);
  }
  /**
   * 指定アイテムを部分更新して保存する（updatedAt を現在時刻で更新）。該当なしなら何もしない。
   * status を "resolved" にする際は resolvedAt を設定し、resolved から戻す際は null にする。
   * @param {string} id - 対象アイテムID
   * @param {Partial<QuestionItem>} patch - 上書きするフィールド
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function updateItem(id, patch) {
    const d = load();
    const it = d.items.find((x) => x.id === id);
    if (!it) return;
    const now = MK.util.nowISO();
    Object.assign(it, patch);
    if (Object.prototype.hasOwnProperty.call(patch, "status")) {
      if (patch.status === "resolved") { if (!it.resolvedAt) it.resolvedAt = now; }
      else { it.resolvedAt = null; }
    }
    it.updatedAt = now;
    save(d);
  }
  /**
   * 指定アイテムを削除して保存する。
   * @param {string} id - 対象アイテムID
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function removeItem(id) { const d = load(); d.items = d.items.filter((it) => it.id !== id); save(d); }

  /**
   * 今週（月曜起点）以降に解決したアイテム件数を数える。
   * @returns {number} 今週わかった件数
   */
  function resolvedThisWeek() {
    const monday = MK.util.mondayOf(MK.util.todayISO());
    return items().filter((it) => it.status === "resolved" && it.resolvedAt && it.resolvedAt.slice(0, 10) >= monday).length;
  }

  /**
   * エクスポート用に現在の全データを返す。
   * @returns {QuestionsData} 現在の questions データ
   */
  function exportData() { return load(); }
  /**
   * 外部データを取り込む。merge は id 一致で上書きマージ、それ以外は全置換。
   * @param {QuestionsData} data - 取り込むデータ
   * @param {"merge"|"replace"} mode - 取り込みモード（"merge" 以外は全置換扱い）
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function importData(data, mode) {
    if (mode === "merge") {
      const d = load();
      const byId = {};
      d.items.forEach((it) => (byId[it.id] = it));
      (data.items || []).forEach((it) => (byId[it.id] = it));
      d.items = Object.keys(byId).map((k) => byId[k]);
      save(d);
    } else {
      save({ version: 1, items: (data && data.items) || [] });
    }
  }
  /**
   * サンプルデータを生成して保存する（既存データは全置換）。
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function loadSample() {
    const now = MK.util.nowISO();
    const daysAgo = (n) => MK.util.addDays(MK.util.todayISO(), -n) + "T09:00:00.000Z";
    const it = (title, status, opts) => Object.assign({
      id: MK.util.uid("q"), title, detail: "", status, tags: [], resolvedNote: "",
      createdAt: now, updatedAt: now, resolvedAt: status === "resolved" ? now : null,
    }, opts || {});
    save({ version: 1, items: [
      it("localStorage の容量上限はどれくらい？", "open", { tags: ["web"] }),
      it("CSS の :has() はどこまで使える？", "open", { detail: "親要素の選択に使えるらしい", tags: ["css"] }),
      it("結合テストと E2E の境界の引き方", "investigating", { detail: "チームで定義が揺れている", tags: ["test"] }),
      it("Git の rebase と merge の使い分け", "investigating", { tags: ["git"] }),
      it("Promise.all と allSettled の違い", "resolved", { resolvedNote: "all は1つ reject で即 reject、allSettled は全件の結果を待つ", tags: ["js"], resolvedAt: daysAgo(1) }),
      it("HTTP ステータス 401 と 403 の違い", "resolved", { resolvedNote: "401=未認証、403=認証済みだが権限なし", tags: ["web"], resolvedAt: daysAgo(2) }),
      it("debounce と throttle の違い", "resolved", { resolvedNote: "debounce=最後の1回、throttle=一定間隔で実行", tags: ["js"], resolvedAt: daysAgo(20) }),
    ] });
  }

  /**
   * HOME ダッシュボード用のサマリーを算出する（spec §3.6）。
   * @returns {{empty: boolean, stats: {label: string, value: (string|number)}[]}}
   *   `empty` はデータ皆無（空状態表示）、`stats` は表示する指標の配列。
   */
  function summary() {
    const c = counts();
    return { empty: c.all === 0, stats: [
      { label: "未解決", value: c.open },
      { label: "今週わかった", value: resolvedThisWeek() },
    ] };
  }

  MK.logic = MK.logic || {};
  MK.logic.questions = {
    STATUSES, load, save, items, counts, filtered,
    addItem, updateItem, removeItem, resolvedThisWeek, summary,
    exportData, importData, loadSample,
  };
})();
