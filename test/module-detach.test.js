/* モジュール着脱耐性（結合レベル。spec §9.5 柱1・Issue #123）—
   「実際にモジュールを外した構成で起動しても壊れない」ことを logic＋core 層で担保する。
   read-summary.test.js が readSummary 単体を、この結合テストが「サブセット構成での起動〜
   横断問い合わせ〜残存モジュール動作〜外したデータの温存」を通しで検証する。
   DOM を含む最終確認は手動チェック（CONVENTIONS.md）に委ねる。 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { setup, ZONE_MODULE_IDS } = require("./harness");

// ゾーンに載る全モジュール id（横断表示が総なめする対象の一覧）は構成マニフェスト（Issue #137）
// から導出する（ハードコードせず単一ソースに追随）。
// このテストで「搭載する」サブセット。残りは「外した」構成として検証する。
const RESIDING = ["todo", "goals"];
const DETACHED = ZONE_MODULE_IDS.filter((id) => RESIDING.indexOf(id) === -1);

// サブセット構成でアプリ起動を再現する。setup() はプロセスの global を差し替えるため、
// 呼び出し側で退避・復元して他テストへ影響させない。搭載モジュールは view.js も読み、
// registerModule 済み（＝ MK.modules に summary を持つ def が載った）状態にする。
function withSubset(modules, body) {
  const saved = { window: global.window, localStorage: global.localStorage, document: global.document };
  try {
    const MK = setup({ modules });
    const rootDir = path.join(__dirname, "..");
    modules.forEach((id) => {
      const code = fs.readFileSync(path.join(rootDir, "modules", id, "view.js"), "utf8");
      vm.runInThisContext(code, { filename: "modules/" + id + "/view.js" });
    });
    body(MK);
  } finally {
    global.window = saved.window;
    global.localStorage = saved.localStorage;
    global.document = saved.document;
  }
}

test("detach: サブセット構成でも全スクリプトのロードが完走する（起動が壊れない）", () => {
  // 観点1: shared/* のどれも特定モジュールの logic の存在を前提にしていない。
  //        2モジュールだけ積んでも setup（共有＋logic ロード）が throw せず MK を返す。
  withSubset(RESIDING, (MK) => {
    assert(MK && MK.util && MK.store, "MK コアが組み上がる");
    RESIDING.forEach((id) => assert(MK.logic[id], id + " の logic が載っている"));
    DETACHED.forEach((id) => assert(!MK.logic[id], id + " の logic は載っていない（外した）"));
  });
});

test("detach: 全ゾーン id を readSummary で総なめしても throw せず、外した分は null", () => {
  // 観点2: 横断表示（HOME）が他モジュールをハード参照せず readSummary 経由で問い合わせる限り、
  //        未搭載 id を含めて総なめしても壊れない。外したモジュールは黙って null になる。
  withSubset(RESIDING, (MK) => {
    ZONE_MODULE_IDS.forEach((id) => {
      const s = MK.readSummary(id); // throw しないこと自体が観点
      if (DETACHED.indexOf(id) !== -1) eq(s, null, id + " は外したので null");
      else assert(s && typeof s.empty === "boolean", id + " は搭載済みなので summary を返す");
    });
  });
});

test("detach: 残存モジュールの logic は通常どおり動作する", () => {
  // 観点3: 外した構成でも、積んだモジュールの logic は独立して機能する（着脱が残存側を巻き込まない）。
  withSubset(RESIDING, (MK) => {
    const T = MK.logic.todo;
    T.addTask("買い物"); T.addTask("電話");
    eq(T.counts().all, 2);
    const G = MK.logic.goals;
    G.addGoal("目標X");
    eq(G.summary().stats[1].value, 1);
  });
});

test("detach: 外したモジュールの mk:module:<id> キーは温存される（再装着でデータ復活）", () => {
  // 観点4: 外したモジュールの永続データが localStorage に残っていても、誰も読まず・書かず・壊さない。
  //        キーが byte 単位で不変であることが、再装着時のデータ復活の裏付けになる。
  withSubset(RESIDING, (MK) => {
    const key = MK.store.keyOf("module:questions"); // questions は外した構成
    const payload = JSON.stringify({ version: 1, items: [{ id: "q_1", title: "残す質問" }] });
    localStorage.setItem(key, payload);

    // 残存モジュールの操作・横断問い合わせを一通り走らせても、外したキーには触れない。
    MK.logic.todo.addTask("x");
    ZONE_MODULE_IDS.forEach((id) => MK.readSummary(id));

    eq(localStorage.getItem(key), payload, "外したモジュールのキーは一切変化しない");
  });
});
