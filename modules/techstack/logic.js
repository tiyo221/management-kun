/* モジュール techstack — ロジック（データ・計算・CSV整形/取込）。DOM/UI に触れない。CONVENTIONS §1 */
(function () {
  "use strict";
  const MK = window.MK;
  const col = MK.store.collection("module:techstack", { key: "items", stamp: true });

  /**
   * 採用状況（Tech Radar のリング）定義。key＝内部値、label＝表示名。表示順もこの配列順に従う。
   * @typedef {Object} Ring
   * @property {string} key - 内部キー（"adopt" | "trial" | "assess" | "hold"）
   * @property {string} label - 画面表示名
   */

  /**
   * 技術スタック1件のレコード。
   * @typedef {Object} TechItem
   * @property {string} id - アイテムID（"ts" プレフィックス）
   * @property {string} name - 技術名（必須。例: React, PostgreSQL）
   * @property {string} category - カテゴリ（任意。例: 言語/フレームワーク/DB/基盤）
   * @property {string} version - 使用バージョン（任意）
   * @property {string} ring - 採用状況キー（{@link Ring} の key）
   * @property {string} note - 用途・所感・移行方針（任意）
   * @property {string} reviewDate - EOL／見直し期限（任意。"YYYY-MM-DD" または ""）
   * @property {string[]} tags - 自由タグ（任意）
   * @property {string} createdAt - 作成日時（ISO 8601）
   * @property {string} updatedAt - 更新日時（ISO 8601）
   */

  /**
   * モジュールの永続データ全体。
   * @typedef {Object} TechstackData
   * @property {number} version - スキーマバージョン
   * @property {TechItem[]} items - 技術スタック一覧
   * @property {string} [exportedAt] - 最終保存日時（ISO 8601）
   */

  const RINGS = [
    { key: "adopt", label: "採用（Adopt）" },
    { key: "trial", label: "試行（Trial）" },
    { key: "assess", label: "評価（Assess）" },
    { key: "hold", label: "保留（Hold）" },
  ];
  const RING_KEYS = RINGS.map((r) => r.key);

  /** 見直し期限が「接近」とみなされる残日数の閾値（この日数以内で soon）。 */
  const DEADLINE_SOON_DAYS = 90;

  // load/save は共有ヘルパへ集約（Issue #139）。load＝store 読取→items 配列検証→既定返却、
  // save＝exportedAt 付与→store.set（返り値は保存成否）。仕様は MK.store.collection を参照。
  const { load, save } = col;
  /**
   * 全アイテムの配列を返す。
   * @returns {TechItem[]} 技術スタック一覧
   */
  function items() { return load().items; }

  /**
   * ring を正規化する（未知・未指定は "assess" に寄せる）。
   * @param {string} ring - リングキー候補
   * @returns {string} 正規化したリングキー
   */
  function normalizeRing(ring) {
    const r = String(ring == null ? "" : ring).trim().toLowerCase();
    return RING_KEYS.indexOf(r) >= 0 ? r : "assess";
  }

  /**
   * 日付を "YYYY-MM-DD" に正規化する。形式が違う・空なら "" を返す。
   * @param {string} v - 日付候補
   * @returns {string} 正規化した日付、または ""
   */
  function normalizeDate(v) {
    const s = String(v == null ? "" : v).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
  }

  /**
   * 見直し期限の状態を判定する（EOL 管理）。
   * @param {string} reviewDate - 見直し期限（"YYYY-MM-DD" または ""）
   * @param {string} [today] - 基準日（"YYYY-MM-DD"。省略時は本日）
   * @returns {"none"|"overdue"|"soon"|"ok"} 未設定=none / 超過=overdue / 接近=soon / 余裕あり=ok
   */
  function deadlineStatus(reviewDate, today) {
    const d = normalizeDate(reviewDate);
    if (!d) return "none";
    const t = today || MK.util.todayISO();
    const days = MK.util.daysBetween(t, d);
    if (days < 0) return "overdue";
    if (days <= DEADLINE_SOON_DAYS) return "soon";
    return "ok";
  }

  /**
   * 見直し期限の接近／超過の件数を集計する。
   * @param {string} [today] - 基準日（省略時は本日）
   * @returns {{soon: number, overdue: number}} 接近・超過の件数
   */
  function deadlineCounts(today) {
    const t = today || MK.util.todayISO();
    let soon = 0, overdue = 0;
    items().forEach((it) => {
      const s = deadlineStatus(it.reviewDate, t);
      if (s === "overdue") overdue++;
      else if (s === "soon") soon++;
    });
    return { soon, overdue };
  }

  /**
   * リング別および全体のアイテム件数を集計する。
   * @returns {Object.<string, number>} `all` と各リングキーをキーに持つ件数マップ
   */
  function counts() {
    const c = { all: 0 };
    RINGS.forEach((r) => (c[r.key] = 0));
    items().forEach((it) => { c.all++; c[it.ring] = (c[it.ring] || 0) + 1; });
    return c;
  }

  /**
   * カテゴリを出現順に重複なく返す（空カテゴリは除く）。
   * @returns {string[]} カテゴリの一意な出現順リスト
   */
  function categories() {
    const seen = [];
    items().forEach((it) => { const c = (it.category || "").trim(); if (c && seen.indexOf(c) < 0) seen.push(c); });
    return seen;
  }

  /**
   * リング・カテゴリ・検索語でアイテムを絞り込む。
   * @param {string} ring - 絞り込むリングキー（"all" または未指定で全リング）
   * @param {string} category - 絞り込むカテゴリ（"all" または未指定で全カテゴリ）
   * @param {string} search - 技術名・カテゴリ・バージョン・メモ・タグを対象とする検索語（名寄せキーで部分一致）
   * @returns {TechItem[]} 条件に合致したアイテム一覧
   */
  function filtered(ring, category, search) {
    const q = MK.util.normalizeKey(search || "");
    let list = items();
    if (ring && ring !== "all") list = list.filter((it) => it.ring === ring);
    if (category && category !== "all") list = list.filter((it) => (it.category || "").trim() === category);
    if (q) list = list.filter((it) =>
      MK.util.normalizeKey(it.name).includes(q) ||
      MK.util.normalizeKey(it.category).includes(q) ||
      MK.util.normalizeKey(it.version).includes(q) ||
      MK.util.normalizeKey(it.note).includes(q) ||
      (it.tags || []).some((t) => MK.util.normalizeKey(t).includes(q)));
    return list;
  }

  /**
   * 技術を1件追加して保存する（先頭に挿入、ring 既定は "assess"）。
   * @param {string} name - 技術名（前後空白は trim される）
   * @returns {void}
   * ※ store へ保存する副作用あり。空の技術名は何もしない。
   */
  function addItem(name) {
    const n = (name || "").trim();
    if (!n) return;
    const d = load();
    const now = MK.util.nowISO();
    d.items.unshift({
      id: MK.util.uid("ts"), name: n, category: "", version: "", ring: "assess",
      note: "", reviewDate: "", tags: [], createdAt: now, updatedAt: now,
    });
    save(d);
  }
  /**
   * 指定アイテムを部分更新して保存する（updatedAt を現在時刻で更新）。該当なしなら何もしない。
   * ring は {@link normalizeRing} で正規化する。
   * @param {string} id - 対象アイテムID
   * @param {Partial<TechItem>} patch - 上書きするフィールド
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function updateItem(id, patch) {
    const d = load();
    const it = d.items.find((x) => x.id === id);
    if (!it) return;
    Object.assign(it, patch);
    if (Object.prototype.hasOwnProperty.call(patch, "ring")) it.ring = normalizeRing(patch.ring);
    if (Object.prototype.hasOwnProperty.call(patch, "reviewDate")) it.reviewDate = normalizeDate(patch.reviewDate);
    it.updatedAt = MK.util.nowISO();
    save(d);
  }
  /**
   * 指定アイテムを削除して保存する。
   * @param {string} id - 対象アイテムID
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function removeItem(id) { const d = load(); d.items = d.items.filter((it) => it.id !== id); save(d); }

  // ---- CSV（整形・取込はロジック。ファイル選択/DLは view）----
  /**
   * 技術スタックをCSV行データ（ヘッダ＋各行）に整形する。
   * @returns {string[][]} 2次元配列のCSV行データ
   */
  function buildCSVRows() {
    const rows = [["技術名", "カテゴリ", "バージョン", "リング", "メモ", "見直し期限", "タグ"]];
    items().forEach((it) => rows.push([
      it.name, it.category || "", it.version || "", it.ring,
      it.note || "", it.reviewDate || "", (it.tags || []).join(" "),
    ]));
    return rows;
  }
  /**
   * CSV行データから技術スタックを取り込み、全置換して保存する。技術名が空の行はスキップする。
   * リングは key（adopt 等）または日本語ラベル先頭語（採用/試行/評価/保留）を受け付け、
   * 不明なら "assess" に寄せる。タグは空白またはカンマ区切り。
   * @param {string[][]} rows - CSV行データ（1行目はヘッダ）
   * @returns {number} 取り込んだ件数
   * ※ store へ保存する副作用あり（全置換）。
   */
  function applyCSV(rows) {
    const ringFromCSV = (v) => {
      const s = String(v == null ? "" : v).trim();
      const byLabel = { "採用": "adopt", "試行": "trial", "評価": "assess", "保留": "hold" };
      if (byLabel[s]) return byLabel[s];
      return normalizeRing(s);
    };
    const now = MK.util.nowISO();
    const body = rows.slice(1).filter((r) => r.length >= 1 && (r[0] || "").trim());
    const list = body.map((r) => ({
      id: MK.util.uid("ts"), name: (r[0] || "").trim(), category: (r[1] || "").trim(),
      version: (r[2] || "").trim(), ring: ringFromCSV(r[3]), note: (r[4] || "").trim(),
      reviewDate: normalizeDate(r[5]),
      tags: (r[6] || "").split(/[\s,]+/).map((t) => t.trim()).filter(Boolean),
      createdAt: now, updatedAt: now,
    }));
    save({ version: 1, items: list });
    return list.length;
  }

  /**
   * エクスポート用に現在の全データを返す。
   * @returns {TechstackData} 現在の techstack データ
   */
  function exportData() { return load(); }
  /**
   * 外部データを取り込む。merge は id 一致で上書きマージ、それ以外は全置換。
   * @param {TechstackData} data - 取り込むデータ
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
    const today = MK.util.todayISO();
    const it = (name, category, version, ring, opts) => Object.assign({
      id: MK.util.uid("ts"), name, category, version, ring, note: "", reviewDate: "", tags: [],
      createdAt: now, updatedAt: now,
    }, opts || {});
    save({ version: 1, items: [
      it("React", "フロントエンド", "18", "adopt", { note: "標準の画面ライブラリ", tags: ["web"] }),
      it("TypeScript", "言語", "5", "adopt", { note: "全新規リポジトリで採用", tags: ["web"] }),
      it("PostgreSQL", "DB", "16", "adopt", { note: "基幹DB", tags: ["infra"], reviewDate: MK.util.addDays(today, 45) }),
      it("Vite", "ビルド", "5", "trial", { note: "新規は Vite で開始", tags: ["web"] }),
      it("Bun", "ランタイム", "1.1", "assess", { note: "CI 高速化を検証中", tags: ["infra"], reviewDate: MK.util.addDays(today, 200) }),
      it("Deno", "ランタイム", "", "assess", { tags: ["infra"] }),
      it("jQuery", "フロントエンド", "3", "hold", { note: "新規採用しない・段階的に撤去", tags: ["web", "legacy"], reviewDate: MK.util.addDays(today, -30) }),
      it("CoffeeScript", "言語", "", "hold", { note: "移行対象", tags: ["legacy"], reviewDate: MK.util.addDays(today, -120) }),
    ] });
  }

  /**
   * HOME ダッシュボード用のサマリーを算出する（spec §3.6）。
   * @param {string} [today] - 基準日（"YYYY-MM-DD"。省略時は本日。テスト用）
   * @returns {{empty: boolean, stats: {label: string, value: (string|number)}[], attention: {label: string, severity: string}[]}}
   *   `empty` はデータ皆無（空状態表示）、`stats` は表示する指標、`attention` は要対応事項（HOME の帯・Issue #102）。
   */
  function summary(today) {
    const c = counts();
    const dc = deadlineCounts(today);
    const attention = [];
    if (dc.overdue > 0) attention.push({ label: "見直し期限超過 " + dc.overdue + "件", severity: "error" });
    if (dc.soon > 0) attention.push({ label: "見直し期限 " + DEADLINE_SOON_DAYS + "日以内 " + dc.soon + "件", severity: "warn" });
    return { empty: c.all === 0, stats: [
      { label: "技術", value: c.all },
      { label: "保留（Hold）", value: c.hold },
      { label: "期限 接近/超過", value: dc.soon + " / " + dc.overdue },
    ], attention };
  }

  /**
   * グローバル検索（コマンドパレット）用のレコードを返す（任意契約 def.searchItems・spec §3.5）。
   * 技術台帳は「使う技術を引く」用途がそのまま検索と一致するので全アイテムを候補にする。
   * label＝技術名、sub＝採用状況＋カテゴリ、keywords にバージョン・用途メモ・タグを含める。
   * @returns {{id: string, label: string, sub: string, keywords: string[]}[]}
   */
  function searchItems() {
    const label = (key) => { const r = RINGS.find((x) => x.key === key); return r ? r.label : key; };
    return items().map((it) => ({
      id: it.id, label: it.name,
      sub: [label(it.ring), it.category].filter(Boolean).join(" · "),
      keywords: [it.version, it.note].concat(it.tags || []).filter(Boolean),
    }));
  }

  MK.logic = MK.logic || {};
  MK.logic.techstack = {
    RINGS, DEADLINE_SOON_DAYS, load, save, items, normalizeRing, normalizeDate,
    deadlineStatus, deadlineCounts, counts, categories, filtered,
    addItem, updateItem, removeItem, buildCSVRows, applyCSV,
    summary, searchItems, exportData, importData, loadSample,
  };
})();
