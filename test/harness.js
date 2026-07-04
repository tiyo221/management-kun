/* テストハーネス — 依存ゼロ（Node 標準のみ）。
   ブラウザ用の shared/* と各モジュールの logic.js を Node 上で読み込み、
   window.MK を組み立てて返す。DOM は最小スタブ（logic は DOM を使わない前提）。 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function makeLocalStorage() {
  const m = {};
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; },
    clear: () => { Object.keys(m).forEach((k) => delete m[k]); },
  };
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

const SCRIPTS = [
  "shared/core.js", "shared/store.js", "shared/scope.js", "shared/io.js",
  "shared/people.js", "shared/projects.js", "shared/products.js", "shared/allocations.js", "shared/demands.js", "shared/ui.js", "shared/sample.js",
  "modules/todo/logic.js", "modules/goals/logic.js", "modules/questions/logic.js", "modules/wbs/logic.js",
  "modules/skills/logic.js", "modules/workload/logic.js",
  "modules/resource/logic.js", "modules/oneonone/logic.js",
  "modules/techstack/logic.js",
  "modules/releases/logic.js",
];

function setup() {
  global.window = {};
  global.localStorage = makeLocalStorage();
  global.document = makeDocument();
  global.requestAnimationFrame = (f) => { if (f) f(); return 0; };
  const rootDir = path.join(__dirname, "..");
  SCRIPTS.forEach((rel) => {
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

module.exports = { setup, reset };
