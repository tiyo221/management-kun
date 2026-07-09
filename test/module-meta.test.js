/* モジュールのメタ契約（Issue #40）— 各 def が1行説明（description）を持つこと。
   view.js は DOM を触るためハーネス既定の SCRIPTS には含まれない。registerModule はロード時に
   def を登録するだけ（mount は遅延）なので、ここで view.js を読み込めば MK.modules に
   title/icon/description が揃う。HOME はこの description を単一ソースに描画する（重複ハードコード禁止）。 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// index.html が積む実装済みモジュール（準備中＝未実装は description を持たなくてよい）。
const MODULES = ["todo", "goals", "questions", "dashboard", "wbs", "skills", "workload", "resource", "oneonone", "techstack", "releases"];

// 各 view.js を読み込んで MK.modules に def（title/icon/description）を揃える。
function loadDefs(MK, rootDir) {
  MODULES.forEach((id) => {
    if (!MK.modules[id]) {
      const code = fs.readFileSync(path.join(rootDir, "modules", id, "view.js"), "utf8");
      vm.runInThisContext(code, { filename: "modules/" + id + "/view.js" });
    }
  });
}

// 構成マニフェスト（shared/manifest.js の window.MK_MANIFEST）の catalog を取り出す。
function loadCatalog(rootDir) {
  const code = fs.readFileSync(path.join(rootDir, "shared/manifest.js"), "utf8");
  const sandbox = { window: {}, document: undefined }; // document 無しでスクリプト注入をスキップ
  vm.runInNewContext(code, sandbox, { filename: "shared/manifest.js" });
  return sandbox.window.MK_MANIFEST.catalog;
}

test("meta: 全モジュールに1行説明（description）がある（Issue #40）", (MK) => {
  // 観点: 各 view.js の registerModule が非空の description を持つ（初見の見取り図の単一ソース）
  const rootDir = path.join(__dirname, "..");
  loadDefs(MK, rootDir);
  MODULES.forEach((id) => {
    const def = MK.modules[id];
    assert(def, id + " が registerModule で登録されている");
    assert(typeof def.description === "string" && def.description.trim().length > 0, id + " に1行説明（description）がある");
  });
});

test("meta: 全モジュールの def に title/icon がある（表示メタの単一ソース・Issue #142）", (MK) => {
  // 観点: title/icon の単一ソースは def。シェルの META は def を優先して読む。
  const rootDir = path.join(__dirname, "..");
  loadDefs(MK, rootDir);
  MODULES.forEach((id) => {
    const def = MK.modules[id];
    assert(typeof def.title === "string" && def.title.trim().length > 0, id + " の def に title がある");
    assert(typeof def.icon === "string" && def.icon.trim().length > 0, id + " の def に icon がある");
  });
});

test("meta: 実装済み id の catalog 値は空（title/icon の二重定義を禁止・Issue #142）", (MK) => {
  // 観点: def を持つモジュールはカタログに title/icon を書かない（＝再び二重管理に戻らない）。
  // 準備中（def 無し）のみカタログ側にフォールバックの title/icon を許す。
  const rootDir = path.join(__dirname, "..");
  loadDefs(MK, rootDir);
  const catalog = loadCatalog(rootDir);
  MODULES.forEach((id) => {
    if (!MK.modules[id]) return; // 準備中はフォールバックを持ってよい
    const v = catalog[id] || {};
    assert(v.title == null && v.icon == null,
      id + " は def が単一ソースなので catalog 値に title/icon を持たない");
  });
});
