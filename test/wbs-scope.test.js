/* wbs の対象別 namespace 化・旧データ移行・対象別 export/import テスト spec §3.7.4 / §4.2 / Issue #25 */
"use strict";

const DIMS = [{ dim: "project", label: "プロジェクト", master: "projects" }];
function withDims(dims, fn) {
  const prev = global.window.MK_CONFIG;
  global.window.MK_CONFIG = { dimensions: dims };
  try { return fn(); } finally { global.window.MK_CONFIG = prev; }
}
// harness は view.js（registerModule）を読み込まないため、io テスト用に scoped な wbs def を
// 実ロジックへ委譲する形で登録する（登録は冪等・moduleOrder は重複しない）。
function registerWbs(MK) {
  if (MK.modules.wbs) return; // reset は modules を消さないため二重登録を避ける
  MK.registerModule("wbs", {
    scope: { dim: "project" },
    exportData: (t) => MK.logic.wbs.exportData(t),
    importData: (d, m, t) => MK.logic.wbs.importData(d, m, t),
  });
}

test("wbs: 対象別 export/import で PJ ごとに独立して保持される（§3.7.4）", (MK) => {
  withDims(DIMS, () => {
    registerWbs(MK);
    const a = MK.projects.create({ name: "PJ-A" });
    const b = MK.projects.create({ name: "PJ-B" });
    // 各 PJ に別々の WBS を投入
    MK.logic.wbs.importData({ version: 1, uid: 3, tasks: [{ id: 1, level: 0, name: "A作業", deps: [] }] }, "replace", a.id);
    MK.logic.wbs.importData({ version: 1, uid: 2, tasks: [{ id: 1, level: 0, name: "B作業", deps: [] }] }, "replace", b.id);
    // 物理キーが PJ ごとに分かれている
    assert(localStorage.getItem("mk:module:wbs:" + a.id + ":v1") != null, "A の対象別キー");
    assert(localStorage.getItem("mk:module:wbs:" + b.id + ":v1") != null, "B の対象別キー");
    eq(MK.logic.wbs.exportData(a.id).tasks[0].name, "A作業");
    eq(MK.logic.wbs.exportData(b.id).tasks[0].name, "B作業");
  });
});

test("wbs: 全体エンベロープが PJ ごとの WBS を targets で束ね、往復で復元できる（§4.2）", (MK) => {
  withDims(DIMS, () => {
    registerWbs(MK);
    const a = MK.projects.create({ name: "PJ-A" });
    const b = MK.projects.create({ name: "PJ-B" });
    MK.logic.wbs.importData({ version: 1, uid: 2, tasks: [{ id: 1, level: 0, name: "A作業", deps: [] }] }, "replace", a.id);
    MK.logic.wbs.importData({ version: 1, uid: 2, tasks: [{ id: 1, level: 0, name: "B作業", deps: [] }] }, "replace", b.id);

    const env = MK.io.buildEnvelope("all");
    assert(env.modules.wbs.targets, "targets 形式で出力される");
    eq(Object.keys(env.modules.wbs.targets).sort(), [a.id, b.id].sort());
    eq(env.modules.wbs.targets[a.id].tasks[0].name, "A作業");

    // 別ストアへ復元（localStorage を消してから import）
    localStorage.removeItem("mk:module:wbs:" + a.id + ":v1");
    localStorage.removeItem("mk:module:wbs:" + b.id + ":v1");
    MK.store._cache = {};
    MK.io.importEnvelope(env, "replace");
    eq(MK.logic.wbs.exportData(a.id).tasks[0].name, "A作業");
    eq(MK.logic.wbs.exportData(b.id).tasks[0].name, "B作業");
  });
});

test("wbs: 旧エンベロープ（単一 data）は既定 PJ へ寄せて取り込む（§7 フォールバック）", (MK) => {
  withDims(DIMS, () => {
    registerWbs(MK);
    const p = MK.projects.create({ name: "既存PJ" });
    // scoped 化前の形（modules.wbs.data）を持つエンベロープ
    const env = {
      schema: "management-kun", schemaVersion: 1, scope: "all", people: [], projects: [],
      modules: { wbs: { version: 1, data: { version: 1, uid: 2, tasks: [{ id: 1, level: 0, name: "旧作業", deps: [] }] } } },
    };
    MK.io.importEnvelope(env, "replace");
    // 先頭 PJ の対象別キーへ入る
    eq(MK.logic.wbs.exportData(p.id).tasks[0].name, "旧作業");
  });
});

test("scope.ensureDefaultTarget: 対象があれば先頭・無ければ既定を作成", (MK) => {
  withDims(DIMS, () => {
    const dim = DIMS[0];
    const created = MK.scope.ensureDefaultTarget(dim); // 空→作成
    assert(created, "既定対象が作られる");
    eq(MK.projects.all().length, 1);
    eq(MK.scope.ensureDefaultTarget(dim), created); // 既存→先頭を再利用（増えない）
    eq(MK.projects.all().length, 1);
  });
});

test("scope.migrateLegacyScoped: 旧単一キーを対象別キーへ移送し冪等（Issue #25 再発防止）", (MK) => {
  withDims(DIMS, () => {
    // 旧 mk:module:wbs:v1 を用意
    localStorage.setItem("mk:module:wbs:v1", JSON.stringify({ version: 1, uid: 2, tasks: [{ id: 1, level: 0, name: "移行前", deps: [] }] }));
    MK.store._cache = {};
    const moved = MK.scope.migrateLegacyScoped("wbs", "pT");
    eq(moved, true);
    // 旧キーは消え、対象別キーへ移っている
    eq(localStorage.getItem("mk:module:wbs:v1"), null);
    eq(JSON.parse(localStorage.getItem("mk:module:wbs:pT:v1")).tasks[0].name, "移行前");
    // 冪等: 旧キーが無い状態で再実行しても何もしない
    eq(MK.scope.migrateLegacyScoped("wbs", "pT"), false);
  });
});

test("scope.migrateLegacyScoped: 移送先が既存なら上書きせず旧キーだけ消す", (MK) => {
  withDims(DIMS, () => {
    localStorage.setItem("mk:module:wbs:v1", JSON.stringify({ version: 1, tasks: [{ id: 1, name: "旧", deps: [] }] }));
    localStorage.setItem("mk:module:wbs:pT:v1", JSON.stringify({ version: 1, tasks: [{ id: 1, name: "既存", deps: [] }] }));
    MK.store._cache = {};
    MK.scope.migrateLegacyScoped("wbs", "pT");
    eq(localStorage.getItem("mk:module:wbs:v1"), null); // 旧キーは除去
    eq(JSON.parse(localStorage.getItem("mk:module:wbs:pT:v1")).tasks[0].name, "既存"); // 既存を保持
  });
});
