/* モジュール metrics — ロジック（指標ツリー・実績・達成度計算・CRUD）。DOM/UI に触れない。CONVENTIONS §1
   プロダクト指標（KGI/NSM/KPI）を対象プロダクトごとに管理する product-scoped モジュール（§3.7.4）。
   保存は対象別 namespace（mk:module:metrics:<productId>:v1）。設計判断は spec/modules/metrics.md（Issue #168）。 */
(function () {
  "use strict";
  const MK = window.MK;
  // 既定は従来の単一 namespace。scoped 化（§3.7.4）に伴い、シェルが mount 時に対象別 store
  // （mk:module:metrics:<productId>:v1）を渡してくるので setStore で差し替える（表示中のプロダクト文脈）。
  let store = MK.store.scope("module:metrics");
  function setStore(s) { if (s) store = s; }
  // 表示中の store（setStore で束ねたプロダクト）とは独立に、指定プロダクトの対象別 store を引く。
  // export/import/サンプル投入・HOME 横断集計が「現在表示中でないプロダクト」も扱えるようにするため（§3.7.4）。
  // targetId 未指定なら表示中の store を返す（テスト時の従来動作）。
  function storeFor(targetId) { return targetId != null ? MK.store.scope("module:metrics:" + targetId) : store; }

  /**
   * 指標ノード1件。parentId で自由木を作り、KGI→NSM→KPI の階層を推奨する（構造は強制しない）。
   * @typedef {Object} Metric
   * @property {string} id - 指標ID（"m" プレフィックス・§4.7）
   * @property {string} name - 指標名（必須）
   * @property {("kgi"|"nsm"|"kpi")} kind - 種別（未知・未指定は "kpi" に正規化）
   * @property {string} unit - 単位（任意。例: %, 円, 人, 件）
   * @property {("up"|"down")} direction - 方向（up=大きいほど良い / down=小さいほど良い。達成度判定に使う）
   * @property {string|null} parentId - 親指標の id（トップは null。存在しない id は孤児＝トップ扱い）
   * @property {number|null} targetValue - 目標値（未設定は null）
   * @property {{period: string, value: number}[]} records - 実績（period＝月 "2026-07" または四半期 "2026-Q3"、value＝実績値）
   * @property {string} note - メモ（任意）
   * @property {string} createdAt - 作成日時（ISO 8601）
   * @property {string} updatedAt - 更新日時（ISO 8601）
   */

  /**
   * モジュールの永続データ全体（対象プロダクト1つぶん）。
   * @typedef {Object} MetricsData
   * @property {number} version - スキーマバージョン
   * @property {Metric[]} metrics - 指標一覧
   * @property {string} [exportedAt] - 最終保存日時（ISO 8601）
   */

  const KINDS = [
    { key: "kgi", label: "KGI" },
    { key: "nsm", label: "NSM" },
    { key: "kpi", label: "KPI" },
  ];
  const DIRECTIONS = [
    { key: "up", label: "大きいほど良い" },
    { key: "down", label: "小さいほど良い" },
  ];
  // ラベル解決 / 正規化は共有ヘルパへ集約（Issue #188）。kind は未知を "kpi"、direction は "up" に寄せる。
  const kindSet = MK.util.statusSet(KINDS, { fallback: "kpi" });
  const dirSet = MK.util.statusSet(DIRECTIONS, { fallback: "up" });

  /**
   * ストアから指標データを読み込む。不正形式なら初期データを返す。
   * @param {{get:Function}} [s] - 読込元ストア（省略時は表示中の store）
   * @returns {MetricsData}
   */
  function load(s) {
    const d = (s || store).get();
    return d && Array.isArray(d.metrics) ? d : { version: 1, metrics: [] };
  }
  /**
   * 指標データをストアへ保存する（exportedAt を現在時刻で付与）。
   * @param {MetricsData} d - 保存するデータ
   * @param {{set:Function}} [s] - 保存先ストア（省略時は表示中の store）
   * @returns {boolean} 保存成否（容量超過などで false）
   * ※ store（localStorage）へ書き込む副作用あり。
   */
  function save(d, s) { d.exportedAt = MK.util.nowISO(); return (s || store).set(d); }
  /**
   * 全指標の配列を返す（表示中の store）。
   * @returns {Metric[]}
   */
  function metrics() { return load().metrics; }

  /** kind を正規化する（未知・未指定は "kpi"）。 */
  function normalizeKind(kind) { return kindSet.normalize(kind); }
  /** direction を正規化する（未知・未指定は "up"）。 */
  function normalizeDirection(dir) { return dirSet.normalize(dir); }

  /**
   * 数値または null に正規化する（空・非数は null）。目標値・実績値の受け口。
   * @param {*} v
   * @returns {number|null}
   */
  function toNumOrNull(v) {
    if (v === "" || v === null || v === undefined) return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  }

  // ---- ツリー（純粋関数。parentId の自由木を扱う） ----
  /**
   * id→ノードの索引を作る（純粋）。
   * @param {Metric[]} list
   * @returns {Object.<string, Metric>}
   */
  function indexById(list) { const by = {}; list.forEach((m) => { by[m.id] = m; }); return by; }
  /**
   * 指定ノードの直接の子を配列順で返す（純粋）。
   * @param {Metric[]} list
   * @param {string} id
   * @returns {Metric[]}
   */
  function childrenOf(list, id) { return list.filter((m) => m.parentId === id); }
  /**
   * トップ（ルート）ノードを返す（純粋）。parentId が null か、存在しない id を指す孤児はトップ扱い。
   * @param {Metric[]} list
   * @returns {Metric[]}
   */
  function roots(list) {
    const by = indexById(list);
    return list.filter((m) => !m.parentId || !by[m.parentId]);
  }
  /**
   * 指定ノードの祖先 id 配列を根へ向かって返す（純粋・循環に強い）。
   * @param {Metric[]} list
   * @param {string} id
   * @returns {string[]}
   */
  function ancestorsOf(list, id) {
    const by = indexById(list);
    const out = [], seen = {};
    let cur = by[id];
    while (cur && cur.parentId && by[cur.parentId] && !seen[cur.parentId]) {
      seen[cur.parentId] = true;
      out.push(cur.parentId);
      cur = by[cur.parentId];
    }
    return out;
  }
  /**
   * 指定ノードの子孫 id 配列を返す（純粋）。親付け替え時の循環防止（選択肢から除外）に使う。
   * @param {Metric[]} list
   * @param {string} id
   * @returns {string[]}
   */
  function descendantsOf(list, id) {
    const out = [];
    (function walk(pid) { childrenOf(list, pid).forEach((c) => { out.push(c.id); walk(c.id); }); })(id);
    return out;
  }
  /**
   * ツリーを深さ優先で平坦化し、各行に depth（階層の深さ）を付けて表示順に返す（純粋・循環に強い）。
   * ビューはこの並びをインデント表示に使う。孤児・循環に取り残されたノードも末尾へ必ず出す。
   * @param {Metric[]} list
   * @returns {{node: Metric, depth: number}[]}
   */
  function tree(list) {
    const out = [], seen = {};
    // 深さ優先で親→子の順に積む。seen で循環に取り込まれても無限再帰しない（setParent が循環を防ぐが二重の安全策）。
    function walk(node, depth) {
      if (seen[node.id]) return;
      seen[node.id] = true;
      out.push({ node: node, depth: depth });
      childrenOf(list, node.id).forEach((c) => walk(c, depth + 1));
    }
    roots(list).forEach((r) => walk(r, 0));
    // ルートから辿れないノード（循環で孤立）も末尾へ必ず出す。
    list.forEach((m) => { if (!seen[m.id]) { seen[m.id] = true; out.push({ node: m, depth: 0 }); } });
    return out;
  }

  // ---- 実績・達成度（純粋） ----
  /**
   * 実績を period 昇順で返す（純粋）。period は月／四半期の文字列で、同一粒度内で辞書順＝時系列順。
   * @param {Metric} m
   * @returns {{period: string, value: number}[]}
   */
  function sortedRecords(m) {
    return ((m && m.records) || []).slice().sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
  }
  /**
   * 直近（最新 period）の実績を返す（純粋）。無ければ null。
   * @param {Metric} m
   * @returns {{period: string, value: number}|null}
   */
  function latestRecord(m) {
    const rs = sortedRecords(m);
    return rs.length ? rs[rs.length - 1] : null;
  }
  /**
   * 達成度を算出する（純粋）。direction を考慮し、直近実績と目標値から比率・達成可否を返す。
   * up＝大きいほど良い（ratio=value/target）／down＝小さいほど良い（ratio=target/value）。
   * @param {Metric} m
   * @returns {{value:number, target:number, period:string, direction:string, ratio:(number|null), met:boolean}|null}
   *   目標値なし or 実績なしのときは null（達成度を出さない）。
   */
  function achievement(m) {
    const latest = latestRecord(m);
    const target = m ? m.targetValue : null;
    if (!latest || target === null || target === undefined) return null;
    const value = latest.value;
    const dir = normalizeDirection(m.direction);
    let ratio;
    if (dir === "down") ratio = value === 0 ? null : target / value; // 小さいほど良い
    else ratio = target === 0 ? null : value / target;              // 大きいほど良い
    const met = dir === "down" ? value <= target : value >= target;
    return { value: value, target: target, period: latest.period, direction: dir, ratio: ratio, met: met };
  }

  // ---- CRUD ----
  /**
   * 指標を1件追加して保存する。name は必須。親は存在する id のみ採用（無効・欠落は null＝トップ）。
   * @param {Object} attrs - 初期属性（name 必須。kind/unit/direction/parentId/targetValue/note は既定補完）
   * @returns {Metric|null} 作成した指標。name 不足なら null（保存しない）。
   * ※ store へ保存する副作用あり（作成成功時のみ）。
   */
  function addMetric(attrs) {
    const a = attrs || {};
    const name = String(a.name == null ? "" : a.name).trim();
    if (!name) return null;
    const d = load();
    const by = indexById(d.metrics);
    const now = MK.util.nowISO();
    const m = {
      id: MK.util.uid("m"), name: name,
      kind: normalizeKind(a.kind),
      unit: String(a.unit == null ? "" : a.unit).trim(),
      direction: normalizeDirection(a.direction),
      parentId: (a.parentId && by[a.parentId]) ? a.parentId : null,
      targetValue: toNumOrNull(a.targetValue),
      records: [], note: a.note || "",
      createdAt: now, updatedAt: now,
    };
    d.metrics.push(m);
    save(d);
    return m;
  }
  /**
   * 指標のスカラー項目を部分更新して保存する（name/kind/unit/direction/targetValue/note）。
   * 親（parentId）の変更は循環判定が要るため {@link setParent} で行う（ここでは扱わない）。
   * name は空を拒否し既存値を保つ（name 必須の不変条件）。
   * @param {string} id - 対象指標ID
   * @param {Partial<Metric>} patch - 上書きするフィールド
   * @returns {Metric|null} 更新後の指標、該当なしなら null
   * ※ store へ保存する副作用あり。
   */
  function updateMetric(id, patch) {
    const d = load();
    const m = d.metrics.find((x) => x.id === id);
    if (!m) return null;
    const p = patch || {};
    const has = (k) => Object.prototype.hasOwnProperty.call(p, k);
    if (has("name")) { const n = String(p.name == null ? "" : p.name).trim(); if (n) m.name = n; }
    if (has("kind")) m.kind = normalizeKind(p.kind);
    if (has("unit")) m.unit = String(p.unit == null ? "" : p.unit).trim();
    if (has("direction")) m.direction = normalizeDirection(p.direction);
    if (has("targetValue")) m.targetValue = toNumOrNull(p.targetValue);
    if (has("note")) m.note = p.note || "";
    m.updatedAt = MK.util.nowISO();
    save(d);
    return m;
  }
  /**
   * 親指標を付け替えて保存する（循環を作る指定は拒否）。自分自身・自分の子孫を親には指定できない。
   * @param {string} id - 対象指標ID
   * @param {string|null} parentId - 新しい親の id（トップにするなら null / ""）
   * @returns {boolean} 付け替えた場合 true、該当なし・循環・存在しない親なら false
   * ※ 成功時のみ store へ保存する副作用あり。
   */
  function setParent(id, parentId) {
    const d = load();
    const m = d.metrics.find((x) => x.id === id);
    if (!m) return false;
    const pid = parentId || null;
    if (pid !== null) {
      if (pid === id) return false;                                   // 自分自身は親にできない
      if (!d.metrics.some((x) => x.id === pid)) return false;         // 存在しない親
      if (descendantsOf(d.metrics, id).indexOf(pid) >= 0) return false; // 子孫を親にすると循環
    }
    m.parentId = pid;
    m.updatedAt = MK.util.nowISO();
    save(d);
    return true;
  }
  /**
   * 指標を削除して保存する。子は削除ノードの親へ引き上げる（サブツリーごと消さない＝葉を失わない）。
   * @param {string} id - 対象指標ID
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function removeMetric(id) {
    const d = load();
    const m = d.metrics.find((x) => x.id === id);
    if (!m) return;
    const newParent = m.parentId || null;
    d.metrics.forEach((x) => { if (x.parentId === id) x.parentId = newParent; }); // 子を引き上げる
    d.metrics = d.metrics.filter((x) => x.id !== id);
    save(d);
  }

  // ---- 実績の記録 ----
  /**
   * 実績を period 単位で追加／更新（upsert）して保存する。同じ period は上書きする。
   * @param {string} id - 対象指標ID
   * @param {string} period - 期間（月 "2026-07" または四半期 "2026-Q3"）
   * @param {*} value - 実績値（数値化できるもの）
   * @returns {Metric|null} 更新後の指標。該当なし・period 空・value 非数なら null（保存しない）
   * ※ store へ保存する副作用あり（成功時のみ）。
   */
  function setRecord(id, period, value) {
    const d = load();
    const m = d.metrics.find((x) => x.id === id);
    if (!m) return null;
    const per = String(period == null ? "" : period).trim();
    const val = toNumOrNull(value);
    if (!per || val === null) return null;
    if (!Array.isArray(m.records)) m.records = [];
    const existing = m.records.find((r) => r.period === per);
    if (existing) existing.value = val;
    else m.records.push({ period: per, value: val });
    m.updatedAt = MK.util.nowISO();
    save(d);
    return m;
  }
  /**
   * 指定 period の実績を削除して保存する。
   * @param {string} id - 対象指標ID
   * @param {string} period - 削除する期間
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function removeRecord(id, period) {
    const d = load();
    const m = d.metrics.find((x) => x.id === id);
    if (!m || !Array.isArray(m.records)) return;
    m.records = m.records.filter((r) => r.period !== period);
    m.updatedAt = MK.util.nowISO();
    save(d);
  }

  // ---- HOME 横断集計（product-scoped・§3.7.4） ----
  /**
   * 全プロダクト（対象別 store）の指標を横断して返す（横断集計の土台）。
   * データはプロダクトごとの store に分かれて入るため、summary・searchItems は表示中プロダクトだけでなく
   * 全プロダクトを走査する。プロダクトが1つも無い（＝テスト・従来の単一 namespace）場合は表示中の store を1件返す。
   * @returns {{id: (string|null), name: string, metrics: Metric[]}[]}
   */
  function eachProductMetrics() {
    const products = (MK.products && typeof MK.products.all === "function") ? MK.products.all() : [];
    if (!products.length) return [{ id: null, name: "", metrics: load(store).metrics }];
    return products.map((p) => ({ id: p.id, name: p.name, metrics: load(storeFor(p.id)).metrics }));
  }

  /**
   * HOME ダッシュボード用のサマリーを算出する（spec §3.6）。product-scoped のため全プロダクトを横断して畳む。
   * 母数の羅列を避け（方針①）、行動につながる指標を出す:
   *   stats … 「達成 met/measured」（目標＋実績のある指標のうち達成できている数）・「未記録 N」（指標はあるが実績ゼロ＝最初の一手）
   *   attention … 「未達 N件」（目標に届いていない指標。warn。stats の達成と同一事実を二重表示しない・方針③）
   * @returns {{empty: boolean, stats: {label: string, value: (string|number)}[], attention: {label: string, severity: string}[]}}
   */
  function summary() {
    let total = 0, measured = 0, met = 0, noRecord = 0;
    eachProductMetrics().forEach((pm) => {
      pm.metrics.forEach((m) => {
        total++;
        if (!m.records || !m.records.length) noRecord++;
        const a = achievement(m);
        if (a) { measured++; if (a.met) met++; }
      });
    });
    const unmet = measured - met;
    const attention = [];
    if (unmet > 0) attention.push({ label: "未達 " + unmet + "件", severity: "warn" });
    return {
      empty: total === 0,
      stats: [
        { label: "達成", value: measured ? (met + "/" + measured) : "—" },
        { label: "未記録", value: noRecord },
      ],
      attention: attention,
    };
  }

  /**
   * グローバル検索（コマンドパレット）用のレコードを返す（任意契約 def.searchItems・spec §3.5）。
   * 全プロダクトを横断し、label＝指標名・sub＝プロダクト名+種別・keywords＝単位/メモで供給する。
   * @returns {{id: string, label: string, sub: string, keywords: string[]}[]}
   */
  function searchItems() {
    const out = [];
    eachProductMetrics().forEach((pm) => {
      pm.metrics.forEach((m) => {
        if (!m.name) return;
        out.push({
          id: (pm.id || "") + ":" + m.id, label: m.name,
          sub: [pm.name, kindSet.label(m.kind)].filter(Boolean).join(" · "),
          keywords: [m.unit, m.note].filter(Boolean),
        });
      });
    });
    return out;
  }

  // ---- 入出力・サンプル（対象別 scope・§3.7.4） ----
  /**
   * エクスポート用にデータを返す。targetId 指定時はそのプロダクトのデータ、未指定なら表示中の store。
   * @param {string} [targetId] - 対象プロダクト id
   * @returns {MetricsData}
   */
  function exportData(targetId) { return load(storeFor(targetId)); }
  /**
   * 外部データを取り込む。merge は id 一致で上書きマージ、それ以外は全置換。targetId でプロダクトを指定。
   * @param {MetricsData} data - 取り込むデータ
   * @param {"merge"|"replace"} mode - 取り込みモード
   * @param {string} [targetId] - 取込先プロダクト id（未指定なら表示中の store）
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function importData(data, mode, targetId) {
    const s = storeFor(targetId);
    if (mode === "merge") {
      const d = load(s);
      d.metrics = MK.util.mergeById(d.metrics, (data && data.metrics) || []);
      save(d, s);
    } else {
      save({ version: 1, metrics: (data && data.metrics) || [] }, s);
    }
  }
  /**
   * サンプルデータを生成して保存する（対象プロダクトの store を全置換）。KGI→NSM→KPI の小さな木＋実績を投入する。
   * @param {string} [targetId] - 投入先プロダクト id（未指定なら表示中の store）
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function loadSample(targetId) {
    const s = storeFor(targetId);
    const now = MK.util.nowISO();
    const kgi = MK.util.uid("m"), nsm = MK.util.uid("m"), kpi1 = MK.util.uid("m"), kpi2 = MK.util.uid("m");
    const mk = (id, name, kind, unit, direction, parentId, targetValue, records, note) => ({
      id: id, name: name, kind: kind, unit: unit, direction: direction, parentId: parentId,
      targetValue: targetValue, records: records || [], note: note || "", createdAt: now, updatedAt: now,
    });
    save({ version: 1, metrics: [
      mk(kgi, "年間売上（ARR）", "kgi", "百万円", "up", null, 1200, [{ period: "2026-Q2", value: 900 }, { period: "2026-Q3", value: 1050 }], "最上位のビジネス目標"),
      mk(nsm, "週次アクティブ利用者数（WAU）", "nsm", "人", "up", kgi, 5000, [{ period: "2026-06", value: 3800 }, { period: "2026-07", value: 4200 }], "北極星指標"),
      mk(kpi1, "新規登録数", "kpi", "件/月", "up", nsm, 800, [{ period: "2026-06", value: 620 }, { period: "2026-07", value: 710 }], "先行指標"),
      mk(kpi2, "解約率", "kpi", "%", "down", nsm, 3, [{ period: "2026-06", value: 4.1 }, { period: "2026-07", value: 3.4 }], "遅行指標（小さいほど良い）"),
    ] }, s);
  }

  MK.logic = MK.logic || {};
  MK.logic.metrics = {
    KINDS, DIRECTIONS, setStore, load, save, metrics,
    normalizeKind, normalizeDirection, toNumOrNull,
    childrenOf, roots, ancestorsOf, descendantsOf, tree,
    sortedRecords, latestRecord, achievement,
    addMetric, updateMetric, setParent, removeMetric, setRecord, removeRecord,
    eachProductMetrics, summary, searchItems, exportData, importData, loadSample,
  };
})();
