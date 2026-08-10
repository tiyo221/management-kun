/* モジュールのメタ契約（Issue #40）— 各 def が1行説明（description）を持つこと。
   view.js は DOM を触るためハーネス既定の SCRIPTS には含まれない。registerModule はロード時に
   def を登録するだけ（mount は遅延）なので、ここで view.js を読み込めば MK.modules に
   title/icon/description が揃う。HOME はこの description を単一ソースに描画する（重複ハードコード禁止）。 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { ZONE_MODULE_IDS } = require("./harness");

// ゾーンに載る実装済みモジュール（準備中＝未実装は description を持たなくてよい）。
// 一覧はハードコードせず構成マニフェストから導出する（手写しは追加のたびに遅れ、
// 実際 daily / metrics が長く漏れていた）。view.js が無い id は「準備中」として除く。
const MODULES = ZONE_MODULE_IDS.filter((id) =>
  fs.existsSync(path.join(__dirname, "..", "modules", id, "view.js")));
// 下限の番人: 導出が壊れて空配列になると、以下3テストが全部「空ループで緑」になる。
if (MODULES.length < 12) throw new Error("走査対象のモジュールが減っている（導出の破損を疑う）: " + MODULES.length);

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
  // 入力: 実装済み全モジュールの view.js を読み込み MK.modules に def を揃える
  // 期待: 各 def が登録済みで、description が非空文字列
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
  // 入力: 実装済み全モジュールの def（view.js 読み込み後）
  // 期待: 各 def が非空の title と icon を持つ
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
  // 入力: 実装済み def と shared/manifest.js の catalog を突き合わせる
  // 期待: def を持つ id は catalog 値の title/icon が両方 null（二重定義がない）
  const rootDir = path.join(__dirname, "..");
  loadDefs(MK, rootDir);
  const catalog = loadCatalog(rootDir);
  // MODULES は view.js の実在で絞ってあり、直前のテストで def の登録も固定済みなので、
  // 「準備中なら飛ばす」分岐はここには要らない（catalog 値は必ず空であるべき）。
  MODULES.forEach((id) => {
    const v = catalog[id] || {};
    assert(v.title == null && v.icon == null,
      id + " は def が単一ソースなので catalog 値に title/icon を持たない");
  });
});
