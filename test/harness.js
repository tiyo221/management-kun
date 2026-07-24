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
// DOM スタブ。logic 層は DOM を使わないため大半は素通しの器だが、shared/ui.js の「振る舞いを持つ
// ヘルパ」（undoToast など。Issue #252）を自動テストできるだけの最小の実体を持たせる:
// イベントの登録/解除/発火・親子関係と contains()・classList・activeElement。実 DOM の再実装はしない。
function makeNode(tag) {
  const classes = new Set();
  return {
    tagName: tag ? String(tag).toUpperCase() : "",
    style: {}, className: "", children: [], parentNode: null,
    _attrs: {}, _listeners: {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c) => (classes.has(c) ? classes.delete(c) : classes.add(c)),
    },
    setAttribute(k, v) { this._attrs[k] = v; if (k === "id") this.id = v; if (k === "type") this.type = v; },
    getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; },
    removeAttribute(k) { delete this._attrs[k]; },
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this; this.children.push(child); return child;
    },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) { this.children.splice(i, 1); child.parentNode = null; }
      return child;
    },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    contains(other) { for (let n = other; n; n = n.parentNode) if (n === this) return true; return false; },
    addEventListener(type, fn) { (this._listeners[type] || (this._listeners[type] = [])).push(fn); },
    removeEventListener(type, fn) {
      const arr = this._listeners[type]; if (!arr) return;
      const i = arr.indexOf(fn); if (i >= 0) arr.splice(i, 1);
    },
    set textContent(v) {}, set innerHTML(v) {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
  };
}
function findById(node, id) {
  if (!node) return null;
  if (node.id === id) return node;
  for (const c of node.children) { const found = findById(c, id); if (found) return found; }
  return null;
}
function makeDocument() {
  const doc = makeNode("#document");
  doc.body = makeNode("body"); doc.body.parentNode = doc;
  doc.documentElement = makeNode("html");
  doc.activeElement = null;
  doc.createElement = (t) => makeNode(t);
  doc.createTextNode = () => makeNode("#text");
  doc.getElementById = (id) => findById(doc.body, id);
  return doc;
}

// 制御可能なタイマー（実時間を待たずにテストから時計を進める）。setTimeout/clearTimeout を差し替え、
// advance(ms) で期限の来たコールバックを登録順に発火する。undoToast の自動消滅・フェード・
// focusout の遅延判定（次タスク）を決定的に検証するため（Issue #252）。
// 注意: この差し替えは setup() で一度だけ効き、以降スイート全体に効く（実タイマーには戻らない）。
// 現状 logic はタイマーを使わない（shared/ui.js・io.js のみ）ため無害。タイマーを張るコードを
// テストするときは、そのテスト冒頭で resetDom()（＝CLOCK.reset()）を呼んで前のタイマーと分離する。
function makeClock() {
  let timers = [], seq = 1, now = 0;
  return {
    setTimeout: (fn, ms) => { const id = seq++; timers.push({ id, fn, at: now + (ms || 0) }); return id; },
    clearTimeout: (id) => { timers = timers.filter((t) => t.id !== id); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at || a.id - b.id);
        const due = timers.find((t) => t.at <= end);
        if (!due) break;
        timers = timers.filter((t) => t !== due);
        now = due.at; due.fn();
      }
      now = end;
    },
    reset() { timers = []; now = 0; },
  };
}
let CLOCK = null;

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
  CLOCK = makeClock();
  global.setTimeout = CLOCK.setTimeout;
  global.clearTimeout = CLOCK.clearTimeout;
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

// ---- DOM/タイマーを使うテスト（ui.test.js）向けの操作ヘルパ ----
// 時計を ms 進める（期限の来た setTimeout を発火）。
function advanceTimers(ms) { if (CLOCK) CLOCK.advance(ms); }
// target に登録された type のリスナを、init を混ぜたイベントで発火する（document / ノード両対応）。
function fireEvent(target, type, init) {
  const e = Object.assign({ type, target, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} }, init || {});
  ((target._listeners && target._listeners[type]) || []).slice().forEach((fn) => fn(e));
  return e;
}
// document.activeElement を差し替える（フォーカス依存の分岐を検証するため）。
function setActiveElement(node) { global.document.activeElement = node || null; }
// DOM/タイマーの状態をテスト間で分離する（body の子・document のリスナ・activeElement・時計をクリア）。
function resetDom() {
  const doc = global.document; if (!doc) return;
  doc.body.children.slice().forEach((c) => c.remove());
  doc.body._listeners = {}; doc._listeners = {}; doc.activeElement = null;
  if (CLOCK) CLOCK.reset();
}

module.exports = {
  setup, reset, ALL_MODULE_IDS, ZONE_MODULE_IDS,
  advanceTimers, fireEvent, setActiveElement, resetDom,
};
