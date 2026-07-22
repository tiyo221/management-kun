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

// 構成マニフェスト（shared/manifest.js の window.MK_MANIFEST）を単一ソースとして、共有資産の一覧と
// モジュール id をここで導出する（Issue #137）。manifest.js は DOM が無ければスクリプト注入をスキップ
// するため、Node 上で安全にデータだけ取り出せる。
function loadManifest() {
  const prevWindow = global.window, prevDoc = global.document;
  global.window = {};
  global.document = undefined; // 注入ガード（typeof document === "undefined"）に確実に掛ける
  try {
    const code = fs.readFileSync(path.join(__dirname, "..", "shared/manifest.js"), "utf8");
    vm.runInThisContext(code, { filename: "shared/manifest.js" });
    return global.window.MK_MANIFEST;
  } finally {
    global.window = prevWindow; global.document = prevDoc;
  }
}
const MANIFEST = loadManifest();

// 共有資産（全構成で常にロードする土台）。読込順＝依存順はマニフェストの shared 配列に従う。
const SHARED_SCRIPTS = MANIFEST.shared.map((s) => "shared/" + s + ".js");

// モジュール id → logic.js。着脱テスト（Issue #123・spec §9.5）でサブセット構成を
// 作れるよう一覧化する。既定（setup() 引数なし）ではカタログ全モジュールをロードする。
// view.js は DOM を触るためここには含めない（logic＋core 層まで）。
const MODULE_LOGIC = {};
Object.keys(MANIFEST.catalog).forEach((id) => { MODULE_LOGIC[id] = "modules/" + id + "/logic.js"; });
const ALL_MODULE_IDS = Object.keys(MODULE_LOGIC);
// ゾーンに載るモジュール id（カタログ順）。ゾーン外ロード（LOAD）分を除く。着脱テストが総なめ対象に使う。
const ZONE_MODULE_IDS = ALL_MODULE_IDS.filter((id) =>
  (MANIFEST.zones || []).some((z) => (z.modules || []).indexOf(id) >= 0));

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

module.exports = { setup, reset, ALL_MODULE_IDS, ZONE_MODULE_IDS };
