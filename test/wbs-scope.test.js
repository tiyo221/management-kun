/* wbs の対象別 namespace 化・旧データ移行・対象別 export/import テスト spec §3.7.4 / §4.2 / Issue #25 */
"use strict";

// テスト用の次元定義（project 次元）。
const DIMS = [{ dim: "project", label: "プロジェクト", master: "projects" }];
// MK_CONFIG.dimensions を一時差し替えして fn を実行し、必ず元へ戻す（戻り値も透過）。
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
  // 観点: WBS はプロジェクト(対象)ごとに独立して保存され、export も対象別に正しい中身を返す
  // 入力: PJ-A/PJ-B を作成し、それぞれへ別々の WBS（"A作業"/"B作業"）を importData(replace)
  // 期待: PJ ごとに物理キー :A:v1 / :B:v1 が分かれ、exportData(a)=A作業・exportData(b)=B作業
  withDims(DIMS, () => {
    registerWbs(MK);
    const a = MK.projects.create({ name: "PJ-A" });
    const b = MK.projects.create({ name: "PJ-B" });
    MK.logic.wbs.importData({ version: 1, uid: 3, tasks: [{ id: 1, level: 0, name: "A作業", deps: [] }] }, "replace", a.id);
    MK.logic.wbs.importData({ version: 1, uid: 2, tasks: [{ id: 1, level: 0, name: "B作業", deps: [] }] }, "replace", b.id);
    assert(localStorage.getItem("mk:module:wbs:" + a.id + ":v1") != null, "A の対象別キー");
    assert(localStorage.getItem("mk:module:wbs:" + b.id + ":v1") != null, "B の対象別キー");
    eq(MK.logic.wbs.exportData(a.id).tasks[0].name, "A作業");
    eq(MK.logic.wbs.exportData(b.id).tasks[0].name, "B作業");
  });
});

test("wbs: 全体エンベロープが PJ ごとの WBS を targets で束ね、往復で復元できる（§4.2）", (MK) => {
  // 観点: 全体エクスポートは対象別 WBS を targets 形式で束ね、別ストアへ import すると PJ ごとに復元できる（I/O ラウンドトリップ）
  // 入力: PJ-A/PJ-B に別 WBS を投入 → buildEnvelope("all") → 両 PJ の localStorage キーを消去 → importEnvelope(replace)
  // 期待: envelope.modules.wbs.targets が {a.id,b.id} を持つ / 復元後 exportData で A作業・B作業が戻る
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

    // 別ストアへの復元を模して localStorage を消してから import
    localStorage.removeItem("mk:module:wbs:" + a.id + ":v1");
    localStorage.removeItem("mk:module:wbs:" + b.id + ":v1");
    MK.store._cache = {};
    MK.io.importEnvelope(env, "replace");
    eq(MK.logic.wbs.exportData(a.id).tasks[0].name, "A作業");
    eq(MK.logic.wbs.exportData(b.id).tasks[0].name, "B作業");
  });
});

test("wbs: 旧エンベロープ（単一 data）は既定 PJ へ寄せて取り込む（§7 フォールバック）", (MK) => {
  // 観点: scoped 化より前の単一 data 形式のエンベロープも、先頭(既定)PJ へ寄せて取り込める（後方互換）
  // 入力: modules.wbs.data（targets ではなく単一 data）を持つ旧エンベロープを、既存PJ 1件がある状態で importEnvelope
  // 期待: 先頭PJ の対象別キーへ "旧作業" が入る
  withDims(DIMS, () => {
    registerWbs(MK);
    const p = MK.projects.create({ name: "既存PJ" });
    const env = {
      schema: "management-kun", schemaVersion: 1, scope: "all", people: [], projects: [],
      modules: { wbs: { version: 1, data: { version: 1, uid: 2, tasks: [{ id: 1, level: 0, name: "旧作業", deps: [] }] } } },
    };
    MK.io.importEnvelope(env, "replace");
    eq(MK.logic.wbs.exportData(p.id).tasks[0].name, "旧作業");
  });
});

test("scope.ensureDefaultTarget: 対象があれば先頭・無ければ既定を作成", (MK) => {
  // 観点: 対象が1件も無いときは既定対象を1件作り、既にあるときは先頭を再利用して増やさない（冪等）
  // 入力: 対象0件で ensureDefaultTarget → 続けてもう一度呼ぶ
  // 期待: 1回目で作成され projects=1件 / 2回目は同じ対象を返し件数は1件のまま
  withDims(DIMS, () => {
    const dim = DIMS[0];
    const created = MK.scope.ensureDefaultTarget(dim);
    assert(created, "既定対象が作られる");
    eq(MK.projects.all().length, 1);
    eq(MK.scope.ensureDefaultTarget(dim), created);
    eq(MK.projects.all().length, 1);
  });
});

test("scope.migrateLegacyScoped: 旧単一キーを対象別キーへ移送し冪等（Issue #25 再発防止）", (MK) => {
  // 観点: scoped 化前の単一キー mk:module:wbs:v1 を対象別キーへ移送し、旧キーは削除。移送後の再実行は何もしない（冪等）
  // 入力: 旧キーを用意 → migrateLegacyScoped("wbs","pT") → 旧キーが無い状態で再実行
  // 期待: 1回目 moved=true・旧キー消滅・pT:v1 に "移行前" が入る / 2回目 moved=false（冪等）
  withDims(DIMS, () => {
    localStorage.setItem("mk:module:wbs:v1", JSON.stringify({ version: 1, uid: 2, tasks: [{ id: 1, level: 0, name: "移行前", deps: [] }] }));
    MK.store._cache = {};
    const moved = MK.scope.migrateLegacyScoped("wbs", "pT");
    eq(moved, true);
    eq(localStorage.getItem("mk:module:wbs:v1"), null);
    eq(JSON.parse(localStorage.getItem("mk:module:wbs:pT:v1")).tasks[0].name, "移行前");
    eq(MK.scope.migrateLegacyScoped("wbs", "pT"), false);
  });
});

test("scope.migrateLegacyScoped: 移送先が既存なら上書きせず旧キーだけ消す", (MK) => {
  // 観点: 移送先の対象別キーが既にあるときは既存データを保護し（上書きしない）、旧キーだけを除去する
  // 入力: 旧キー("旧")と移送先キー("既存")を両方用意 → migrateLegacyScoped("wbs","pT")
  // 期待: 旧キーは消える / 移送先 pT:v1 は "既存" のまま（上書きされない）
  withDims(DIMS, () => {
    localStorage.setItem("mk:module:wbs:v1", JSON.stringify({ version: 1, tasks: [{ id: 1, name: "旧", deps: [] }] }));
    localStorage.setItem("mk:module:wbs:pT:v1", JSON.stringify({ version: 1, tasks: [{ id: 1, name: "既存", deps: [] }] }));
    MK.store._cache = {};
    MK.scope.migrateLegacyScoped("wbs", "pT");
    eq(localStorage.getItem("mk:module:wbs:v1"), null);
    eq(JSON.parse(localStorage.getItem("mk:module:wbs:pT:v1")).tasks[0].name, "既存");
  });
});
