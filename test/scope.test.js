/* スコープ次元の基盤（MK.scope・対象別 store）テスト spec §3.7 / Issue #24 / #54 */
"use strict";

// テスト用の次元定義（project 次元をマスタ projects に紐づける）。
const DIMS = [{ dim: "project", label: "プロジェクト", master: "projects" }];
// 実運用の MK_CONFIG.dimensions 相当（project + product の2次元。Issue #54）。
const DIMS_ALL = [
  { dim: "project", label: "プロジェクト", master: "projects" },
  { dim: "product", label: "プロダクト", master: "products" },
];
// MK_CONFIG.dimensions を一時的に差し替えて fn を実行し、必ず元へ戻すヘルパ。
function withDims(dims, fn) {
  const prev = global.window.MK_CONFIG;
  global.window.MK_CONFIG = { dimensions: dims };
  try { fn(); } finally { global.window.MK_CONFIG = prev; }
}

test("scope.dims: MK_CONFIG.dimensions を返す・未設定なら空", (MK) => {
  // 観点: 次元一覧は MK_CONFIG.dimensions をそのまま返し、未設定でも落ちず空配列になる
  // 入力: MK_CONFIG 未設定のまま呼ぶ / DIMS を設定して呼ぶ
  // 期待: 未設定→[] / 設定時→DIMS
  eq(MK.scope.dims(), []);
  withDims(DIMS, () => eq(MK.scope.dims(), DIMS));
});

test("scope.dimOf: global/未知は null・scoped は次元 config", (MK) => {
  // 観点: scope 指定から対応する次元 config を引く。global・未指定・未知次元は null に落ちる
  // 入力: "global" / undefined / config に無い {dim:"product"} / config にある {dim:"project"}
  // 期待: 先の3つ→null / 最後→DIMS[0]
  withDims(DIMS, () => {
    eq(MK.scope.dimOf("global"), null);
    eq(MK.scope.dimOf(undefined), null);
    eq(MK.scope.dimOf({ dim: "product" }), null);
    eq(MK.scope.dimOf({ dim: "project" }), DIMS[0]);
  });
});

test("scope.master/entities: dim.master 名で汎用にマスタを引く", (MK) => {
  // 観点: 次元は dim.master の名前でマスタ(MK.projects 等)を汎用解決し、その要素一覧を返す
  // 入力: DIMS[0]（master:"projects"）で master()/entities() を呼ぶ → projects を1件作成
  // 期待: master===MK.projects / 作成前 entities=[] / 作成後 entities は1件
  withDims(DIMS, () => {
    const dim = DIMS[0];
    assert(MK.scope.master(dim) === MK.projects, "master は MK.projects を汎用解決");
    eq(MK.scope.entities(dim), []);
    MK.projects.create({ name: "A" });
    eq(MK.scope.entities(dim).length, 1);
  });
});

test("scope.mode: 縮退モード（0=empty / 1=single / 2+=multi）", (MK) => {
  // 観点: 対象数に応じた UI 縮退モードを返す（0件/1件/複数でスイッチャの出し方を変える）
  // 入力: 対象数 0 / 1 / 2 / 9
  // 期待: 0→"empty" / 1→"single" / 2以上→"multi"
  eq(MK.scope.mode(0), "empty");
  eq(MK.scope.mode(1), "single");
  eq(MK.scope.mode(2), "multi");
  eq(MK.scope.mode(9), "multi");
});

test("scope.resolveTarget: 保存済みが有効ならそれ・無効/未指定なら先頭・空なら null", (MK) => {
  // 観点: 保存された選択対象IDを検証し、有効ならそのまま・無効/未指定なら先頭・要素なしなら null に解決する
  // 入力: 要素0件で "p_x" / 2件(A,B)作成後に b.id / 存在しない "p_gone" / null
  // 期待: 要素なし→null / 有効値→そのまま(b.id) / 無効→先頭(a.id) / 未指定→先頭(a.id)
  withDims(DIMS, () => {
    const dim = DIMS[0];
    eq(MK.scope.resolveTarget(dim, "p_x"), null);
    const a = MK.projects.create({ name: "A" });
    const b = MK.projects.create({ name: "B" });
    eq(MK.scope.resolveTarget(dim, b.id), b.id);
    eq(MK.scope.resolveTarget(dim, "p_gone"), a.id);
    eq(MK.scope.resolveTarget(dim, null), a.id);
  });
});

test("scope.storeNsFor: scoped は対象別 ns・global/対象なしは従来 ns", (MK) => {
  // 観点: 保存名前空間はスコープ次第で切り替わる。scoped かつ対象確定時のみ対象別 ns、それ以外は従来 ns にフォールバック
  // 入力: global / config 未設定での {dim:"project"} / config 設定下での 対象あり・対象null・global
  // 期待: 従来 "module:wbs" ↔ 対象別 "module:wbs:p1"。config 未解決・対象null・global は従来 ns へ縮退
  eq(MK.scope.storeNsFor("wbs", "global", null), "module:wbs");
  eq(MK.scope.storeNsFor("wbs", { dim: "project" }, "p1"), "module:wbs"); // config 未設定→次元解決できず global 相当
  withDims(DIMS, () => {
    eq(MK.scope.storeNsFor("wbs", { dim: "project" }, "p1"), "module:wbs:p1");
    eq(MK.scope.storeNsFor("wbs", { dim: "project" }, null), "module:wbs"); // 対象未定はフォールバック
    eq(MK.scope.storeNsFor("wbs", "global", "p1"), "module:wbs");           // global は対象を無視
  });
});

test("対象別 store: mk:module:<id>:<targetId>:v1 に対象別で保存/読込される", (MK) => {
  // 観点: 対象別 ns への保存は対象ごとに物理キーが分離され、互いに干渉しない（§3.7.4）
  // 入力: 対象 pA/pB それぞれの ns へ別データ(tasks:["a"]/["b"])を set
  // 期待: mk:module:wbs:pA:v1 と :pB:v1 が両方存在し、各 ns の get で自分側の値だけ読める
  withDims(DIMS, () => {
    const nsA = MK.scope.storeNsFor("wbs", { dim: "project" }, "pA");
    const nsB = MK.scope.storeNsFor("wbs", { dim: "project" }, "pB");
    MK.store.scope(nsA).set({ version: 1, tasks: ["a"] });
    MK.store.scope(nsB).set({ version: 1, tasks: ["b"] });
    assert(localStorage.getItem("mk:module:wbs:pA:v1") != null, "pA キーが存在");
    assert(localStorage.getItem("mk:module:wbs:pB:v1") != null, "pB キーが存在");
    eq(MK.store.scope(nsA).get().tasks, ["a"]);
    eq(MK.store.scope(nsB).get().tasks, ["b"]);
  });
});

test("scope: Product 次元（Issue #54）も project と同様に汎用配線で動く", (MK) => {
  // 観点: MK_CONFIG.dimensions に product を並べても、コードの決め打ち分岐なしに
  // master 名（"products"）から MK.products を汎用解決し、対象別 ns・縮退モードも project と同じ挙動になる
  // 入力: DIMS_ALL（project+product）下で product 次元を dimOf/master/entities/mode/storeNsFor に通す
  // 期待: dimOf→DIMS_ALL[1] / master→MK.products / entities は作成件数どおり / mode は project と同じ規則 /
  //       storeNsFor は "module:<id>:<productId>" へ解決
  withDims(DIMS_ALL, () => {
    const dim = MK.scope.dimOf({ dim: "product" });
    eq(dim, DIMS_ALL[1]);
    assert(MK.scope.master(dim) === MK.products, "master は MK.products を汎用解決");
    eq(MK.scope.entities(dim), []);
    eq(MK.scope.mode(MK.scope.entities(dim).length), "empty");

    const p1 = MK.products.create({ name: "Product A" });
    eq(MK.scope.entities(dim).length, 1);
    eq(MK.scope.mode(1), "single");

    const p2 = MK.products.create({ name: "Product B" });
    eq(MK.scope.mode(2), "multi");
    eq(MK.scope.resolveTarget(dim, p2.id), p2.id);
    eq(MK.scope.resolveTarget(dim, "prod_gone"), p1.id);

    eq(MK.scope.storeNsFor("sample", { dim: "product" }, p1.id), "module:sample:" + p1.id);
  });
});

test("store.read: prewarm 対象外の対象別キーを localStorage から遅延ロードする", (MK) => {
  // 観点: load() は "module:<id>" しか prewarm しないが、prewarm 対象外の対象別キーもキャッシュ未在時に localStorage から遅延ロードできる（再発防止）
  // 入力: 対象別キー mk:module:wbs:pZ:v1 を直接書き込み → _cache を空にしてキャッシュを飛ばす
  // 期待: その ns の get() で localStorage から tasks:["z"] を読み出せる
  localStorage.setItem("mk:module:wbs:pZ:v1", JSON.stringify({ version: 1, tasks: ["z"] }));
  MK.store._cache = {};
  eq(MK.store.scope("module:wbs:pZ").get().tasks, ["z"]);
});
