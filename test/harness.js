/* テストハーネス — 依存ゼロ（Node 標準のみ）。
   ブラウザ用の shared/* と各モジュールの logic.js を Node 上で読み込み、
   window.MK を組み立てて返す。DOM は最小スタブ（logic は DOM を使わない前提）。 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function makeLocalStorage(opts) {
  const m = {};
  opts = opts || {};
  const api = {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => {
      // 容量超過をシミュレートするフック（store の QuotaExceededError 処理テスト用）。
      if (opts.quota && Object.keys(m).join("").length + String(v).length > opts.quota) {
        const e = new Error("quota exceeded"); e.name = "QuotaExceededError"; e.code = 22; throw e;
      }
      m[k] = String(v);
    },
    removeItem: (k) => { delete m[k]; },
    clear: () => { Object.keys(m).forEach((k) => delete m[k]); },
    key: (i) => { const ks = Object.keys(m); return i >= 0 && i < ks.length ? ks[i] : null; },
  };
  Object.defineProperty(api, "length", { get: () => Object.keys(m).length });
  return api;
}
function makeNode() {
  return {
    style: {}, className: "", children: [],
    classList: { add() {}, remove() {}, contains() { return false; } },
    setAttribute() {}, appendChild() {}, removeChild() {}, remove() {},
    addEventListener() {}, removeEventListener() {},
    set textContent(v) {}, set innerHTML(v) {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
  };
}
function makeDocument() {
  return {
    createElement: () => makeNode(),
    createTextNode: () => makeNode(),
    getElementById: () => null,
    body: makeNode(),
    documentElement: { setAttribute() {}, removeAttribute() {} },
    addEventListener() {}, removeEventListener() {},
  };
}

// 共有資産（全構成で常にロードする土台）。
const SHARED_SCRIPTS = [
  "shared/core.js", "shared/store.js", "shared/scope.js", "shared/io.js",
  "shared/people.js", "shared/projects.js", "shared/products.js", "shared/search.js", "shared/allocations.js", "shared/demands.js", "shared/ui.js", "shared/sample.js",
];

// モジュール id → logic.js。着脱テスト（Issue #123・spec §9.5 柱1）でサブセット構成を
// 作れるよう一覧化する。既定（setup() 引数なし）では全モジュールを従来と同じ順序でロードし、
// 既存テスト・挙動は不変とする。view.js は DOM を触るためここには含めない（logic＋core 層まで）。
const MODULE_LOGIC = {
  todo: "modules/todo/logic.js",
  goals: "modules/goals/logic.js",
  questions: "modules/questions/logic.js",
  wbs: "modules/wbs/logic.js",
  dashboard: "modules/dashboard/logic.js",
  skills: "modules/skills/logic.js",
  workload: "modules/workload/logic.js",
  resource: "modules/resource/logic.js",
  oneonone: "modules/oneonone/logic.js",
  techstack: "modules/techstack/logic.js",
  releases: "modules/releases/logic.js",
};
const ALL_MODULE_IDS = Object.keys(MODULE_LOGIC);

// opts.modules: ロードするモジュール id の配列（未指定＝全モジュール＝従来挙動）。
// サブセットを渡すと「そのモジュールだけ搭載した構成」で起動を再現できる。
function setup(opts) {
  opts = opts || {};
  const ids = opts.modules || ALL_MODULE_IDS;
  ids.forEach((id) => {
    if (!(id in MODULE_LOGIC)) throw new Error("unknown module id: " + id);
  });
  global.window = {};
  global.localStorage = makeLocalStorage();
  global.document = makeDocument();
  global.requestAnimationFrame = (f) => { if (f) f(); return 0; };
  const rootDir = path.join(__dirname, "..");
  const scripts = SHARED_SCRIPTS.concat(ids.map((id) => MODULE_LOGIC[id]));
  scripts.forEach((rel) => {
    const code = fs.readFileSync(path.join(rootDir, rel), "utf8");
    vm.runInThisContext(code, { filename: rel });
  });
  return global.window.MK;
}

// テスト間のデータ分離: localStorage と store キャッシュをクリア
function reset(MK) {
  global.localStorage.clear();
  MK.store._cache = {};
}

module.exports = { setup, reset, ALL_MODULE_IDS };
