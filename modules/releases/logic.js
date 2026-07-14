/* モジュール releases — ロジック（データ・計算・CRUD）。DOM/UI に触れない。CONVENTIONS §1
   Product マスタ（MK.products）を productId で参照する横断（global）台帳。
   product-scoped にしない設計判断は spec/modules/releases.md を参照（Issue #84）。 */
(function () {
  "use strict";
  const MK = window.MK;
  const col = MK.store.collection("module:releases", { key: "releases", stamp: true });

  /**
   * リリースの状態（ステータス）定義。key＝内部値、label＝表示名。表示順もこの配列順に従う。
   * @typedef {Object} Status
   * @property {string} key - 内部キー（"planned" | "done" | "cancelled"）
   * @property {string} label - 画面表示名
   */

  /**
   * リリース1件のレコード。
   * @typedef {Object} Release
   * @property {string} id - リリースID（"rel" プレフィックス）
   * @property {string} productId - 対象プロダクトの id（Product マスタ参照・必須）
   * @property {string} version - バージョン/名称（必須。例: v1.2.0, 夏の大型アップデート）
   * @property {string} plannedDate - 予定日（YYYY-MM-DD。未定は ""）
   * @property {string} actualDate - 実施日（YYYY-MM-DD。未実施は ""）
   * @property {string} status - ステータスキー（{@link Status} の key）
   * @property {string} note - メモ（任意）
   * @property {string} createdAt - 作成日時（ISO 8601）
   * @property {string} updatedAt - 更新日時（ISO 8601）
   */

  /**
   * モジュールの永続データ全体。
   * @typedef {Object} ReleasesData
   * @property {number} version - スキーマバージョン
   * @property {Release[]} releases - リリース一覧
   * @property {string} [exportedAt] - 最終保存日時（ISO 8601）
   */

  const STATUSES = [
    { key: "planned", label: "予定（Planned）" },
    { key: "done", label: "完了（Done）" },
    { key: "cancelled", label: "中止（Cancelled）" },
  ];
  // ラベル解決 / 正規化 / 件数集計の定型は共有ヘルパへ集約（Issue #188）。
  const statusSet = MK.util.statusSet(STATUSES, { fallback: "planned" });

  // load/save は共有ヘルパへ集約（Issue #139）。load＝store 読取→releases 配列検証→既定返却、
  // save＝exportedAt 付与→store.set（返り値は保存成否）。仕様は MK.store.collection を参照。
  const { load, save } = col;
  /**
   * 全リリースの配列を返す。
   * @returns {Release[]} リリース一覧
   */
  function releases() { return load().releases; }

  /**
   * status を正規化する（未知・未指定は "planned" に寄せる）。
   * @param {string} status - ステータスキー候補
   * @returns {string} 正規化したステータスキー
   */
  function normalizeStatus(status) {
    return statusSet.normalize(status);
  }

  /**
   * 時系列ソートに使う日付を返す（実施日があれば実施日、なければ予定日）。
   * @param {Release} r - リリース
   * @returns {string} YYYY-MM-DD。どちらも未定なら ""
   */
  function effectiveDate(r) { return r.actualDate || r.plannedDate || ""; }

  /**
   * プロダクト・ステータスで絞り込み、時系列（昇順・日付未定は末尾）で返す。
   * @param {string} productId - 絞り込むプロダクト id（"all" または未指定で全プロダクト）
   * @param {string} status - 絞り込むステータスキー（"all" または未指定で全ステータス）
   * @returns {Release[]} 条件に合致したリリースの時系列一覧
   */
  function timeline(productId, status) {
    let list = releases();
    if (productId && productId !== "all") list = list.filter((r) => r.productId === productId);
    if (status && status !== "all") list = list.filter((r) => r.status === status);
    return list.slice().sort((a, b) => {
      const da = effectiveDate(a);
      const db = effectiveDate(b);
      if (da !== db) {
        if (!da) return 1;   // 日付未定は末尾
        if (!db) return -1;
        return da < db ? -1 : 1;
      }
      return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
    });
  }

  /**
   * ステータス別および全体の件数を集計する（プロダクトで絞り込み可）。
   * @param {string} [productId] - 絞り込むプロダクト id（"all" または未指定で全プロダクト）
   * @returns {Object.<string, number>} `all` と各ステータスキーの件数マップ
   */
  function counts(productId) {
    // productId 絞り込みは呼び出し側の関心なので、集計前にリストを絞ってから共有ヘルパへ渡す。
    const list = productId && productId !== "all"
      ? releases().filter((r) => r.productId === productId)
      : releases();
    return statusSet.counts(list, (r) => r.status);
  }

  /**
   * リリースを1件追加して保存する。productId とバージョン/名称は必須。
   * @param {Object} attrs - 初期属性（productId・version 必須。他は既定値で補完）
   * @returns {Release|null} 作成したリリース。必須不足なら null（保存しない）
   * ※ store へ保存する副作用あり（作成成功時のみ）。
   */
  function addRelease(attrs) {
    const a = attrs || {};
    const productId = String(a.productId == null ? "" : a.productId).trim();
    const version = String(a.version == null ? "" : a.version).trim();
    if (!productId || !version) return null;
    const d = load();
    const now = MK.util.nowISO();
    const r = {
      id: MK.util.uid("rel"), productId, version,
      plannedDate: a.plannedDate || "", actualDate: a.actualDate || "",
      status: normalizeStatus(a.status), note: a.note || "",
      createdAt: now, updatedAt: now,
    };
    d.releases.push(r);
    save(d);
    return r;
  }

  /**
   * 指定リリースを部分更新して保存する（updatedAt を現在時刻で更新、status は正規化）。
   * @param {string} id - 対象リリースID
   * @param {Partial<Release>} patch - 上書きするフィールド
   * @returns {Release|null} 更新後のリリース、該当なしなら null
   * ※ store へ保存する副作用あり。
   */
  function updateRelease(id, patch) {
    const d = load();
    const r = d.releases.find((x) => x.id === id);
    if (!r) return null;
    Object.assign(r, patch);
    if (Object.prototype.hasOwnProperty.call(patch, "status")) r.status = normalizeStatus(patch.status);
    r.updatedAt = MK.util.nowISO();
    save(d);
    return r;
  }

  /**
   * 指定リリースを削除して保存する。
   * @param {string} id - 対象リリースID
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function removeRelease(id) { const d = load(); d.releases = d.releases.filter((r) => r.id !== id); save(d); }

  /**
   * 対象プロダクト名を返す（Product 削除後の表示破綻防止ガード。products.relatedProjects と同じ方針）。
   * @param {Release} r - リリース
   * @returns {string} プロダクト名。参照先が無ければ ""
   */
  function productName(r) {
    const p = r && r.productId ? MK.products.get(r.productId) : null;
    return p ? p.name : "";
  }

  /**
   * 指定日以降の予定リリース（status=planned・予定日あり）を予定日昇順で返す。
   * @param {string} fromISO - 起点日（YYYY-MM-DD。この日を含む）
   * @returns {Release[]} 直近の予定リリース一覧
   */
  function upcoming(fromISO) {
    return releases()
      .filter((r) => r.status === "planned" && r.plannedDate && r.plannedDate >= fromISO)
      .sort((a, b) => (a.plannedDate < b.plannedDate ? -1 : a.plannedDate > b.plannedDate ? 1 : 0));
  }

  /**
   * エクスポート用に現在の全データを返す。
   * @returns {ReleasesData} 現在の releases データ
   */
  function exportData() { return load(); }
  /**
   * 外部データを取り込む。merge は id 一致で上書きマージ、それ以外は全置換。
   * @param {ReleasesData} data - 取り込むデータ
   * @param {"merge"|"replace"} mode - 取り込みモード（"merge" 以外は全置換扱い）
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function importData(data, mode) {
    if (mode === "merge") {
      const d = load();
      d.releases = MK.util.mergeById(d.releases, data.releases);
      save(d);
    } else {
      save({ version: 1, releases: (data && data.releases) || [] });
    }
  }
  /**
   * サンプルデータを生成して保存する（既存データは全置換）。
   * Product マスタから先頭のプロダクトを借りる。プロダクトが未登録なら空のまま保存する。
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function loadSample() {
    const products = (MK.products && MK.products.all()) || [];
    if (!products.length) { save({ version: 1, releases: [] }); return; }
    const now = MK.util.nowISO();
    const day = (n) => MK.util.addDays(MK.util.todayISO(), n);
    const p0 = products[0].id;
    const p1 = (products[1] || products[0]).id;
    const mk = (productId, version, plannedDate, actualDate, status, note) => ({
      id: MK.util.uid("rel"), productId, version,
      plannedDate, actualDate, status, note, createdAt: now, updatedAt: now,
    });
    save({ version: 1, releases: [
      mk(p0, "v1.0.0", day(-30), day(-28), "done", "初回リリース。2日遅れで実施"),
      mk(p0, "v1.1.0", day(-7), day(-7), "done", "検索機能を追加"),
      mk(p0, "v1.2.0", day(14), "", "planned", "ダークモード対応を予定"),
      mk(p1, "2026夏アップデート", day(30), "", "planned", "大型機能の同梱を検討中"),
      mk(p1, "ベータ配布", day(-14), "", "cancelled", "品質基準未達のため中止"),
    ] });
  }

  /**
   * HOME ダッシュボード用のサマリーを算出する（spec §3.6）。
   * @param {string} [today] - 基準日（"YYYY-MM-DD"。省略時は本日。テスト用）
   * @returns {{empty: boolean, stats: {label: string, value: (string|number)}[], attention: {label: string, severity: string}[]}}
   *   `empty` はデータ皆無（空状態表示）、`stats` は行動指標、`attention` は要対応事項（HOME の帯）。
   */
  function summary(today) {
    const base = today || MK.util.todayISO();
    const c = counts();
    const next = upcoming(base)[0] || null;
    const list = releases();
    // 日程未定: planned だが plannedDate が空＝日付を決める一手。
    const undated = list.filter((r) => r.status === "planned" && !r.plannedDate).length;
    // 遅延: planned のまま plannedDate が基準日より前（＝未リリースの超過。ISO 日付は辞書順＝時系列順）。
    const delayed = list.filter((r) => r.status === "planned" && r.plannedDate && r.plannedDate < base).length;
    const attention = [];
    if (delayed > 0) attention.push({ label: "遅延 " + delayed + "件", severity: "warn" });
    // 行動指標: 次に出す直近予定（＋あと何日）と、日付を決める一手の 日程未定。
    // 母数（予定 件数）は撤去し、遅延は attention と重複するため stats に出さない（spec §3.6 方針①③・#205）。
    return { empty: c.all === 0, stats: [
      { label: "直近予定", value: next ? next.plannedDate + "（あと" + MK.util.daysBetween(base, next.plannedDate) + "日）" : "—" },
      { label: "日程未定", value: undated },
    ], attention };
  }

  /**
   * グローバル検索（コマンドパレット）用のレコードを返す（任意契約 def.searchItems・spec §3.5）。
   * 中止（cancelled）は追う対象でないので除き、予定・完了のリリースを候補にする。
   * label＝バージョン/名称、sub＝プロダクト名＋ステータス、keywords に実施日/予定日とメモを含める。
   * @returns {{id: string, label: string, sub: string, keywords: string[]}[]}
   */
  function searchItems() {
    const label = statusSet.label;
    return releases().filter((r) => r.status !== "cancelled").map((r) => ({
      id: r.id, label: r.version,
      sub: [productName(r), label(r.status)].filter(Boolean).join(" · "),
      keywords: [effectiveDate(r), r.note].filter(Boolean),
    }));
  }

  MK.logic = MK.logic || {};
  MK.logic.releases = {
    STATUSES, load, save, releases, normalizeStatus, effectiveDate, timeline, counts,
    addRelease, updateRelease, removeRelease, productName, upcoming,
    summary, searchItems, exportData, importData, loadSample,
  };
})();
