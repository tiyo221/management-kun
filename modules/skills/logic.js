/* モジュール skills — ロジック（データ・計算・CSV整形/取込）。DOM/UI に触れない。CONVENTIONS §1 */
(function () {
  "use strict";
  const MK = window.MK;
  const store = MK.store.scope("module:skills");

  /**
   * スキル項目1件（大分類=domain / 中分類=item / 小分類=description の3階層）。
   * @typedef {Object} Skill
   * @property {string} id - スキルID（"sk" プレフィックス）
   * @property {string} domain - 大分類
   * @property {string} item - 中分類
   * @property {string} description - 小分類（説明）
   * @property {boolean} visible - 一覧に表示するか
   * @property {boolean} core - コアスキルか
   * @property {number|null} targetLevel - 目標レベル（1-5、未設定なら null）
   * @property {number|null} requiredCount - 必要人数（未設定なら null）
   */

  /**
   * モジュールの永続データ全体。評価は "メンバーID:スキルID" をキーとするマップで保持する。
   * @typedef {Object} SkillsData
   * @property {number} version - スキーマバージョン
   * @property {Skill[]} skills - スキル一覧
   * @property {Object.<string, string>} ratings - 評価マップ（キー "mid:sid" → 値 "1"〜"5" または "-"）
   */

  /**
   * ストアからスキルデータを読み込む。未保存・不正形式なら空の初期データを返し、ratings 欠落も補う。
   * @returns {SkillsData} 読み込んだデータ（常に skills 配列と ratings を持つ）
   */
  function load() { const d = store.get(); if (!d || !Array.isArray(d.skills)) return { version: 1, skills: [], ratings: {} }; if (!d.ratings) d.ratings = {}; return d; }
  /**
   * スキルデータをストアへ保存する。
   * @param {SkillsData} d - 保存するデータ
   * @returns {void}
   * ※ store（localStorage）へ書き込む副作用あり。
   */
  function save(d) { store.set(d); }
  /**
   * 全スキルの配列を返す。
   * @returns {Skill[]} スキル一覧
   */
  function skills() { return load().skills; }
  /**
   * 表示対象（visible !== false）のスキルのみ返す。
   * @returns {Skill[]} 表示対象スキル一覧
   */
  function visibleSkills() { return skills().filter((s) => s.visible !== false); }
  /**
   * 評価対象のメンバー一覧を人マスタから返す。
   * @returns {Array<Object>} メンバー一覧（MK.people のレコード）
   */
  function members() { return MK.people.all(); }

  /**
   * 指定メンバー×スキルの評価値を取得する。
   * @param {string} mid - メンバーID
   * @param {string} sid - スキルID
   * @returns {string} 評価値（"1"〜"5" または "-"、未設定なら空文字）
   */
  function rating(mid, sid) { const v = load().ratings[mid + ":" + sid]; return v == null ? "" : v; }
  /**
   * 指定メンバー×スキルの評価値を設定/削除して保存する。空値なら該当キーを削除する。
   * @param {string} mid - メンバーID
   * @param {string} sid - スキルID
   * @param {string|null} val - 評価値（空文字/null で削除）
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function setRating(mid, sid, val) { const d = load(); if (val === "" || val == null) delete d.ratings[mid + ":" + sid]; else d.ratings[mid + ":" + sid] = val; save(d); }

  /**
   * スキル一覧に登場する大分類を、出現順に重複なく返す。
   * @param {Skill[]} list - スキル一覧
   * @returns {string[]} 大分類（domain）の一意な出現順リスト
   */
  function domainsOrder(list) { const seen = []; list.forEach((s) => { if (seen.indexOf(s.domain) < 0) seen.push(s.domain); }); return seen; }
  /**
   * 指定スキルの数値評価（"-"・空を除く）を数値配列で返す。
   * @param {string} sid - スキルID
   * @returns {number[]} 全メンバーの数値評価
   */
  function numericRatings(sid) { return members().map((m) => rating(m.id, sid)).filter((v) => v && v !== "-").map(Number); }
  /**
   * 指定スキルの平均レベルを算出する。
   * @param {string} sid - スキルID
   * @returns {number} 平均レベル（評価がなければ 0）
   */
  function avgLevel(sid) { const a = numericRatings(sid); return a.length ? (a.reduce((x, y) => x + y, 0) / a.length) : 0; }
  /**
   * 指定スキルで、しきい値以上の評価を持つメンバー数を数える。
   * @param {string} sid - スキルID
   * @param {number} th - しきい値レベル
   * @returns {number} th 以上のメンバー数
   */
  function countAtLeast(sid, th) { return numericRatings(sid).filter((v) => v >= th).length; }
  /**
   * スキルの必要人数に対する充足/不足（ギャップ）を算出する。
   * @param {Skill} s - 対象スキル
   * @returns {{state: "unset"|"ok"|"short", sufficient?: number, shortage?: number, required?: number, target?: number}}
   *   目標/必要人数が未設定なら state="unset"。それ以外は充足人数・不足人数・必要人数・目標レベルを返す。
   */
  function gapOf(s) {
    if (s.targetLevel == null || s.requiredCount == null) return { state: "unset" };
    const sufficient = members().map((m) => rating(m.id, s.id)).filter((v) => v && v !== "-").map(Number).filter((v) => v >= s.targetLevel).length;
    const shortage = Math.max(0, s.requiredCount - sufficient);
    return { state: shortage > 0 ? "short" : "ok", sufficient, shortage, required: s.requiredCount, target: s.targetLevel };
  }
  /**
   * レベル値を 1〜5 の整数に丸める（数値化できなければ 1）。
   * @param {string|number} v - 入力値
   * @returns {number} 1〜5 に収めた整数
   */
  function clampLv(v) { let n = parseInt(v, 10); if (isNaN(n)) n = 1; return Math.max(1, Math.min(5, n)); }

  /**
   * スキルを1件追加して保存する（未指定フィールドは既定値で補完）。
   * @param {Partial<Skill>} attrs - 初期属性
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function addSkill(attrs) { const d = load(); d.skills.push(Object.assign({ id: MK.util.uid("sk"), domain: "", item: "", description: "", visible: true, core: false, targetLevel: null, requiredCount: null }, attrs || {})); save(d); }
  /**
   * 指定スキルを部分更新して保存する。該当なしなら何も変更しない。
   * @param {string} id - 対象スキルID
   * @param {Partial<Skill>} patch - 上書きするフィールド
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function updateSkill(id, patch) { const d = load(); const s = d.skills.find((x) => x.id === id); if (s) Object.assign(s, patch); save(d); }
  /**
   * 指定スキルを削除し、関連する評価も併せて削除して保存する。
   * @param {string} id - 対象スキルID
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function removeSkill(id) { const d = load(); d.skills = d.skills.filter((s) => s.id !== id); Object.keys(d.ratings).forEach((k) => { if (k.split(":")[1] === id) delete d.ratings[k]; }); save(d); }

  // ---- CSV（整形・取込はロジック。ファイル選択/DLは view）----
  /**
   * スキル定義をCSV行データ（ヘッダ＋各行）に整形する。
   * @returns {string[][]} 2次元配列のCSV行データ
   */
  function buildSkillsCSVRows() {
    const rows = [["大分類", "中分類", "小分類", "コア", "目標レベル", "必要人数", "表示"]];
    skills().forEach((s) => rows.push([s.domain, s.item, s.description, s.core ? "true" : "false", s.targetLevel != null ? s.targetLevel : "", s.requiredCount != null ? s.requiredCount : "", s.visible !== false ? "true" : "false"]));
    return rows;
  }
  /**
   * CSV行データからスキル定義を取り込み、全置換して保存する。評価は孤児化するためクリアする。
   * @param {string[][]} rows - CSV行データ（1行目はヘッダ）
   * @returns {number} 取り込んだスキル件数
   * ※ store へ保存し、既存 ratings を全消去する副作用あり。
   */
  function applySkillsCSV(rows) {
    const truthy = (v) => /^(true|1|○|コア|表示|yes)$/i.test(String(v).trim());
    const body = rows.slice(1).filter((r) => r.length >= 2 && (r[0] || r[1]));
    const d = load();
    d.skills = body.map((r) => ({
      id: MK.util.uid("sk"), domain: (r[0] || "").trim(), item: (r[1] || "").trim(), description: (r[2] || "").trim(),
      core: truthy(r[3]), targetLevel: r[4] !== "" && r[4] != null ? clampLv(r[4]) : null,
      requiredCount: r[5] !== "" && r[5] != null ? Math.max(0, parseInt(r[5], 10) || 0) : null,
      visible: r[6] == null || r[6] === "" ? true : truthy(r[6]),
    }));
    d.ratings = {}; // スキル置換に伴い評価は孤児化
    save(d);
    return body.length;
  }
  /**
   * 評価をCSV行データ（ヘッダ＋各行、値ありのみ）に整形する。
   * @returns {string[][]} 2次元配列のCSV行データ
   */
  function buildRatingsCSVRows() {
    const rows = [["メンバー名", "大分類", "中分類", "値"]];
    const d = load();
    members().forEach((m) => skills().forEach((s) => { const v = d.ratings[m.id + ":" + s.id]; if (v && v !== "") rows.push([m.name, s.domain, s.item, v]); }));
    return rows;
  }
  /**
   * CSV行データから評価を取り込む。メンバーは名寄せ、スキルは大分類×中分類の一致で解決する。
   * 解決できない/値が不正な行はスキップする。
   * @param {string[][]} rows - CSV行データ（1行目はヘッダ、列: メンバー名/大分類/中分類/値）
   * @returns {{ok: number, skip: number}} 取り込み成功件数・スキップ件数
   * ※ store へ保存する副作用あり。
   */
  function applyRatingsCSV(rows) {
    const d = load(); let ok = 0, skip = 0;
    rows.slice(1).forEach((r) => {
      if (r.length < 4) return;
      const m = MK.people.resolve(r[0]);
      const s = d.skills.find((x) => MK.util.normalizeKey(x.domain) === MK.util.normalizeKey(r[1]) && MK.util.normalizeKey(x.item) === MK.util.normalizeKey(r[2]));
      const val = String(r[3]).trim();
      if (!m || !s || (val !== "-" && !/^[1-5]$/.test(val))) { skip++; return; }
      d.ratings[m.id + ":" + s.id] = val; ok++;
    });
    save(d);
    return { ok, skip };
  }

  /**
   * エクスポート用に現在の全データを返す。
   * @returns {SkillsData} 現在のスキルデータ
   */
  function exportData() { return load(); }
  /**
   * 外部データを取り込む。merge は id 一致で上書きマージ（ratings も統合）、それ以外は全置換。
   * @param {SkillsData} data - 取り込むデータ
   * @param {"merge"|"replace"} mode - 取り込みモード（"merge" 以外は全置換扱い）
   * @returns {void}
   * ※ store へ保存する副作用あり。
   */
  function importData(data, mode) {
    if (mode === "merge") {
      const d = load(); const byId = {}; d.skills.forEach((s) => (byId[s.id] = s));
      (data.skills || []).forEach((s) => (byId[s.id] = s));
      d.skills = Object.keys(byId).map((k) => byId[k]);
      Object.assign(d.ratings, data.ratings || {}); save(d);
    } else { save({ version: 1, skills: (data && data.skills) || [], ratings: (data && data.ratings) || {} }); }
  }
  /**
   * サンプルデータを生成して保存する（既存データは全置換）。
   * @returns {void}
   * ※ store へ保存し、参照メンバーを MK.people マスタへ作成する副作用あり。
   */
  function loadSample() {
    const d = { version: 1, skills: [], ratings: {} };
    const mk = (domain, item, description, opts) => Object.assign({ id: MK.util.uid("sk"), domain, item, description, visible: true, core: false, targetLevel: null, requiredCount: null }, opts || {});
    const s1 = mk("Web/アプリ", "バックエンド実装・設計", "サーバーサイドの設計・実装", { core: true, targetLevel: 3, requiredCount: 2 });
    const s2 = mk("Web/アプリ", "フロントエンド実装", "画面側の実装", { core: true, targetLevel: 3, requiredCount: 2 });
    const s3 = mk("Web/アプリ", "UI/UXデザイン", "画面設計・デザイン");
    const s4 = mk("マネジメント", "プロジェクト管理", "進行・調整", { core: true, targetLevel: 4, requiredCount: 1 });
    const s5 = mk("マネジメント", "メンバー育成", "1on1・コーチング");
    d.skills = [s1, s2, s3, s4, s5];
    const sato = MK.people.resolveOrCreate("佐藤 花子"), suzuki = MK.people.resolveOrCreate("鈴木 一郎"), tanaka = MK.people.resolveOrCreate("田中 美咲"), taka = MK.people.resolveOrCreate("高橋 健");
    const set = (mid, sid, v) => { d.ratings[mid + ":" + sid] = v; };
    set(suzuki, s1.id, "4"); set(taka, s1.id, "3"); set(sato, s1.id, "2");
    set(taka, s2.id, "4"); set(suzuki, s2.id, "3"); set(tanaka, s2.id, "2");
    set(tanaka, s3.id, "5"); set(sato, s3.id, "2");
    set(sato, s4.id, "4"); set(suzuki, s4.id, "2");
    set(sato, s5.id, "3"); set(tanaka, s5.id, "-");
    save(d);
  }

  /**
   * HOME ダッシュボード用のサマリーを算出する（spec §3.6）。
   * @returns {{empty: boolean, stats: {label: string, value: (string|number)}[]}}
   */
  function summary() {
    const m = members().length, s = skills().length;
    return { empty: m === 0 && s === 0, stats: [
      { label: "メンバー", value: m },
      { label: "スキル項目", value: s },
    ] };
  }

  MK.logic = MK.logic || {};
  MK.logic.skills = { load, save, skills, visibleSkills, members, rating, setRating, domainsOrder, avgLevel, countAtLeast, gapOf, clampLv, addSkill, updateSkill, removeSkill, buildSkillsCSVRows, applySkillsCSV, buildRatingsCSVRows, applyRatingsCSV, summary, exportData, importData, loadSample };
})();
