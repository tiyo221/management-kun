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

test("meta: 全モジュールに1行説明（description）がある（Issue #40）", (MK) => {
  // 観点: 各 view.js の registerModule が非空の description を持つ（初見の見取り図の単一ソース）
  const rootDir = path.join(__dirname, "..");
  MODULES.forEach((id) => {
    if (!MK.modules[id]) {
      const code = fs.readFileSync(path.join(rootDir, "modules", id, "view.js"), "utf8");
      vm.runInThisContext(code, { filename: "modules/" + id + "/view.js" });
    }
    const def = MK.modules[id];
    assert(def, id + " が registerModule で登録されている");
    assert(typeof def.description === "string" && def.description.trim().length > 0, id + " に1行説明（description）がある");
  });
});
