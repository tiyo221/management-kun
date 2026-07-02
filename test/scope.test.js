/* スコープ次元の基盤（MK.scope・対象別 store）テスト spec §3.7 / Issue #24 */
"use strict";

const DIMS = [{ dim: "project", label: "プロジェクト", master: "projects" }];
function withDims(dims, fn) {
  const prev = global.window.MK_CONFIG;
  global.window.MK_CONFIG = { dimensions: dims };
  try { fn(); } finally { global.window.MK_CONFIG = prev; }
}

test("scope.dims: MK_CONFIG.dimensions を返す・未設定なら空", (MK) => {
  eq(MK.scope.dims(), []);
  withDims(DIMS, () => eq(MK.scope.dims(), DIMS));
});

test("scope.dimOf: global/未知は null・scoped は次元 config", (MK) => {
  withDims(DIMS, () => {
    eq(MK.scope.dimOf("global"), null);
    eq(MK.scope.dimOf(undefined), null);
    eq(MK.scope.dimOf({ dim: "product" }), null); // config に無い次元
    eq(MK.scope.dimOf({ dim: "project" }), DIMS[0]);
  });
});

test("scope.master/entities: dim.master 名で汎用にマスタを引く", (MK) => {
  withDims(DIMS, () => {
    const dim = DIMS[0];
    assert(MK.scope.master(dim) === MK.projects, "master は MK.projects を汎用解決");
    eq(MK.scope.entities(dim), []);
    MK.projects.create({ name: "A" });
    eq(MK.scope.entities(dim).length, 1);
  });
});

test("scope.mode: 縮退モード（0=empty / 1=single / 2+=multi）", (MK) => {
  eq(MK.scope.mode(0), "empty");
  eq(MK.scope.mode(1), "single");
  eq(MK.scope.mode(2), "multi");
  eq(MK.scope.mode(9), "multi");
});

test("scope.resolveTarget: 保存済みが有効ならそれ・無効/未指定なら先頭・空なら null", (MK) => {
  withDims(DIMS, () => {
    const dim = DIMS[0];
    eq(MK.scope.resolveTarget(dim, "p_x"), null); // 要素なし
    const a = MK.projects.create({ name: "A" });
    const b = MK.projects.create({ name: "B" });
    eq(MK.scope.resolveTarget(dim, b.id), b.id);   // 有効な保存値
    eq(MK.scope.resolveTarget(dim, "p_gone"), a.id); // 無効→先頭
    eq(MK.scope.resolveTarget(dim, null), a.id);     // 未指定→先頭
  });
});

test("scope.storeNsFor: scoped は対象別 ns・global/対象なしは従来 ns", (MK) => {
  eq(MK.scope.storeNsFor("wbs", "global", null), "module:wbs");
  eq(MK.scope.storeNsFor("wbs", { dim: "project" }, "p1"), "module:wbs"); // config 未設定→次元解決できず global 相当
  withDims(DIMS, () => {
    eq(MK.scope.storeNsFor("wbs", { dim: "project" }, "p1"), "module:wbs:p1");
    eq(MK.scope.storeNsFor("wbs", { dim: "project" }, null), "module:wbs"); // 対象未定はフォールバック
    eq(MK.scope.storeNsFor("wbs", "global", "p1"), "module:wbs");           // global は対象を無視
  });
});

test("対象別 store: mk:module:<id>:<targetId>:v1 に対象別で保存/読込される", (MK) => {
  withDims(DIMS, () => {
    const nsA = MK.scope.storeNsFor("wbs", { dim: "project" }, "pA");
    const nsB = MK.scope.storeNsFor("wbs", { dim: "project" }, "pB");
    MK.store.scope(nsA).set({ version: 1, tasks: ["a"] });
    MK.store.scope(nsB).set({ version: 1, tasks: ["b"] });
    // 物理キーが対象別に分かれている（§3.7.4）
    assert(localStorage.getItem("mk:module:wbs:pA:v1") != null, "pA キーが存在");
    assert(localStorage.getItem("mk:module:wbs:pB:v1") != null, "pB キーが存在");
    eq(MK.store.scope(nsA).get().tasks, ["a"]);
    eq(MK.store.scope(nsB).get().tasks, ["b"]);
  });
});

test("store.read: prewarm 対象外の対象別キーを localStorage から遅延ロードする", (MK) => {
  // load() は "module:<id>" しか prewarm しない。対象別キーを直接書いてキャッシュを飛ばしても読める。
  localStorage.setItem("mk:module:wbs:pZ:v1", JSON.stringify({ version: 1, tasks: ["z"] }));
  MK.store._cache = {};
  eq(MK.store.scope("module:wbs:pZ").get().tasks, ["z"]);
});
