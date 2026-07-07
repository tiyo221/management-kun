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
  const STATUS_KEYS = STATUSES.map((s) => s.key);

  /**
   * ステータスを正規化する（未知・未指定は "open" に寄せる）。key（open 等）または
   * 日本語ラベル（未解決 / 調査中 / わかった）を寛容に解釈する。
   * @param {string} status - ステータス候補
   * @returns {string} 正規化したステータスキー
   */
  function normalizeStatus(status) {
    const s = String(status == null ? "" : status).trim();
    const byLabel = { "未解決": "open", "調査中": "investigating", "わかった": "resolved" };
    if (byLabel[s]) return byLabel[s];
    const k = s.toLowerCase();
    return STATUS_KEYS.indexOf(k) >= 0 ? k : "open";
  }

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
   * アイテムがナレッジ（再利用できる資産）かを判定する。
   * ナレッジの条件は「解決済み（resolved）かつ 後で読める答え（resolvedNote）を持つ」こと。
   * 答えを残さず閉じただけ（resolved・note 空）はナレッジではない（Issue #81）。
   * @param {QuestionItem} it - 判定対象アイテム
   * @returns {boolean} ナレッジなら true
   */
  function isKnowledge(it) {
    return !!it && it.status === "resolved" && MK.util.normalizeKey(it.resolvedNote) !== "";
  }

  /**
   * ステータス別・全体・ナレッジのアイテム件数を集計する。
   * `knowledge` は {@link isKnowledge} を満たす件数（＝答えありの resolved）。
   * @returns {Object.<string, number>} `all` / 各ステータスキー / `knowledge` を持つ件数マップ
   */
  function counts() {
    const c = { all: 0, knowledge: 0 };
    STATUSES.forEach((s) => (c[s.key] = 0));
    items().forEach((it) => {
      c.all++;
      c[it.status] = (c[it.status] || 0) + 1;
      if (isKnowledge(it)) c.knowledge++;
    });
    return c;
  }

  /**
   * ステータスと検索語でアイテムを絞り込む。
   * 検索語はタイトル・詳細・タグに加え、解決内容（resolvedNote）も対象にする。
   * これにより「わかった」タブがナレッジ（FAQ）ビューとして、回答本文からも引ける。
   * @param {string} filter - 絞り込むステータスキー（"all" または未指定で全件）
   * @param {string} search - タイトル・詳細・タグ・解決内容を対象とする検索語（名寄せキーで部分一致）
   * @returns {QuestionItem[]} 条件に合致したアイテム一覧
   */
  function filtered(filter, search) {
    const q = MK.util.normalizeKey(search || "");
    let list = items();
    if (filter && filter !== "all") list = list.filter((it) => it.status === filter);
    if (q) list = list.filter((it) =>
      MK.util.normalizeKey(it.title).includes(q) ||
      MK.util.normalizeKey(it.detail).includes(q) ||
      MK.util.normalizeKey(it.resolvedNote).includes(q) ||
      (it.tags || []).some((t) => MK.util.normalizeKey(t).includes(q)));
    return list;
  }

  /**
   * ナレッジ（答えありの解決済み）だけをキーワードで絞り込んで返す。
   * 答えを残さず閉じただけの resolved は含めない（{@link isKnowledge}・B案：棚の純度優先）。
   * キーワードはタイトル・詳細・タグ・解決内容に部分一致する。
   * @param {string} [search] - 絞り込みキーワード（省略でナレッジ全件）
   * @returns {QuestionItem[]} キーワードに合致したナレッジ一覧
   */
  function knowledge(search) { return filtered("resolved", search).filter(isKnowledge); }

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
   * 指定アイテムを「わかった（resolved）」にし、解決内容を記録する。未解決／調査中から
   * ナレッジへ移す導線用の薄いラッパ（{@link updateItem} が resolvedAt を設定する）。
   * @param {string} id - 対象アイテムID
   * @param {string} [note] - 解決内容（前後空白は trim。省略で空のまま）
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function resolve(id, note) {
    updateItem(id, { status: "resolved", resolvedNote: (note || "").trim() });
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
   * resolvedAt は UTC タイムスタンプ（nowISO）なので、現地日付に変換してから
   * 現地日基準の月曜と比較する（.slice(0,10) の UTC 日付では TZ ズレで取りこぼす）。
   * @param {string} [today] - 基準日（YYYY-MM-DD、現地）。省略時は現地の今日（テスト注入用・TESTING §1）
   * @returns {number} 今週わかった件数
   */
  function resolvedThisWeek(today) {
    const monday = MK.util.mondayOf(today || MK.util.todayISO());
    return items().filter((it) =>
      it.status === "resolved" && it.resolvedAt &&
      MK.util.fmtDate(new Date(it.resolvedAt)) >= monday).length;
  }

  // ---- CSV（整形・取込はロジック。ファイル選択/DLは view）----
  /**
   * わからないことをCSV行データ（ヘッダ＋各行）に整形する。
   * @returns {string[][]} 2次元配列のCSV行データ
   */
  function buildCSVRows() {
    const rows = [["タイトル", "詳細", "ステータス", "タグ", "わかったこと"]];
    items().forEach((it) => rows.push([
      it.title, it.detail || "", it.status, (it.tags || []).join(" "), it.resolvedNote || "",
    ]));
    return rows;
  }
  /**
   * CSV行データからわからないことを取り込み、全置換して保存する。タイトルが空の行はスキップする。
   * ステータスは key（open 等）または日本語ラベル（未解決/調査中/わかった）を受け付け、不明なら "open"。
   * タグは空白またはカンマ区切り。createdAt/updatedAt は取込時刻、resolvedAt は resolved のとき取込時刻。
   * @param {string[][]} rows - CSV行データ（1行目はヘッダ）
   * @returns {number} 取り込んだ件数
   * ※ store へ保存する副作用あり（全置換）。
   */
  function applyCSV(rows) {
    const now = MK.util.nowISO();
    const body = rows.slice(1).filter((r) => r.length >= 1 && (r[0] || "").trim());
    const list = body.map((r) => {
      const status = normalizeStatus(r[2]);
      return {
        id: MK.util.uid("q"), title: (r[0] || "").trim(), detail: (r[1] || "").trim(),
        status, tags: (r[3] || "").split(/[\s,]+/).map((t) => t.trim()).filter(Boolean),
        resolvedNote: (r[4] || "").trim(), createdAt: now, updatedAt: now,
        resolvedAt: status === "resolved" ? now : null,
      };
    });
    save({ version: 1, items: list });
    return list.length;
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
   * @returns {{empty: boolean, stats: {label: string, value: (string|number)}[], attention: {label: string, severity: string}[]}}
   *   `empty` はデータ皆無（空状態表示）、`stats` は表示する指標、`attention` は要対応事項（HOME の帯・Issue #102）。
   */
  function summary() {
    const c = counts();
    const attention = [];
    if (c.open > 0) attention.push({ label: "未解決の質問 " + c.open + "件", severity: "info" });
    return { empty: c.all === 0, stats: [
      { label: "未解決", value: c.open },
      { label: "今週わかった", value: resolvedThisWeek() },
    ], attention };
  }

  /**
   * グローバル検索（コマンドパレット）用のレコードを返す（任意契約 def.searchItems・spec §3.5）。
   * 解決済み（resolved）は除き、未解決・調査中の質問だけを候補にする。label＝タイトル、
   * sub＝ステータス、keywords に詳細・タグを含めて本文検索できるようにする。
   * @returns {{id: string, label: string, sub: string, keywords: string[]}[]}
   */
  function searchItems() {
    const label = (key) => { const s = STATUSES.find((x) => x.key === key); return s ? s.label : key; };
    return items().filter((it) => it.status !== "resolved").map((it) => ({
      id: it.id, label: it.title, sub: label(it.status),
      keywords: [it.detail].concat(it.tags || []).filter(Boolean),
    }));
  }

  MK.logic = MK.logic || {};
  MK.logic.questions = {
    STATUSES, normalizeStatus, load, save, items, counts, filtered, knowledge, isKnowledge,
    addItem, updateItem, removeItem, resolve, resolvedThisWeek, summary,
    searchItems, buildCSVRows, applyCSV, exportData, importData, loadSample,
  };
})();
