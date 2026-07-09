/* MK.store — 使用量表示・書込失敗（QuotaExceededError）のハンドリング（Issue #76）。 */
"use strict";

// 容量超過を投げる localStorage スタブ。setItem で必ず QuotaExceededError を投げる。
function makeQuotaLS() {
  const m = {};
  const api = {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: () => { const e = new Error("quota"); e.name = "QuotaExceededError"; e.code = 22; throw e; },
    removeItem: (k) => { delete m[k]; },
    clear: () => { Object.keys(m).forEach((k) => delete m[k]); },
    key: (i) => { const ks = Object.keys(m); return i >= 0 && i < ks.length ? ks[i] : null; },
    _seed: (k, v) => { m[k] = String(v); },
  };
  Object.defineProperty(api, "length", { get: () => Object.keys(m).length });
  return api;
}

test("store: usage() は mk: プレフィックスキーの合計バイト・比率を返す", (MK) => {
  // 観点: mk: 以外は除外し、UTF-16（1文字2バイト）でキー名＋値を概算する
  MK.store.write("settings", { a: 1 });
  global.localStorage.setItem("other:x", "zzz"); // mk: 以外は集計対象外
  const u = MK.store.usage();
  assert(u.bytes > 0, "bytes が正");
  assert(u.count === 1, "mk: キーは1件（other:x は除外）");
  eq(u.quota, 5 * 1024 * 1024);
  almost(u.ratio, u.bytes / u.quota);
  // other:x を含めていないこと（含めるとバイト数がもっと増える）
  const key = MK.store.keyOf("settings");
  const expected = (key.length + JSON.stringify({ a: 1 }).length) * 2;
  eq(u.bytes, expected);
});

test("store: 書込成功で lastWriteError は null、戻り値 true", (MK) => {
  const ok = MK.store.write("settings", { a: 1 });
  eq(ok, true);
  eq(MK.store.lastWriteError, null);
});

test("store: QuotaExceededError を握りつぶさず記録し、戻り値 false・キャッシュは新値を保持", (MK) => {
  const orig = global.localStorage;
  const q = makeQuotaLS();
  global.localStorage = q;
  try {
    const ok = MK.store.write("settings", { big: "x" });
    eq(ok, false);
    assert(MK.store.lastWriteError, "lastWriteError が記録される");
    eq(MK.store.lastWriteError.quota, true);
    eq(MK.store.lastWriteError.ns, "settings");
    // 失敗しても _cache には新値が残り、JSON エクスポートで退避できる（クラッシュしない）
    eq(MK.store.read("settings"), { big: "x" });
  } finally {
    global.localStorage = orig;
  }
});

test("store: remove() は localStorage キーとキャッシュを落とし、例外環境でも握りつぶす", (MK) => {
  // 観点: 退役モジュールの名前空間破棄（Issue #167）。read でキャッシュに載せた後 remove すると
  //       localStorage キーも _cache も消える。removeItem が投げる環境でも例外を伝播させない。
  MK.store.write("module:todo", { version: 1, tasks: [{ id: "t1" }] });
  eq(MK.store.read("module:todo").tasks.length, 1); // _cache に載せる
  MK.store.remove("module:todo");
  eq(global.localStorage.getItem(MK.store.keyOf("module:todo")), null, "localStorage キーが消える");
  eq(MK.store.read("module:todo"), null, "read は null（キャッシュも破棄）");

  // removeItem が例外を投げる環境でも remove は投げず、_cache からは落とす（起動シーケンスを止めない）。
  // localStorage キー自体は消せないため read は遅延ロードで戻り得るが、例外を伝播しないことが要点。
  const orig = global.localStorage;
  const throwing = Object.assign({}, orig, { removeItem: () => { throw new Error("no remove"); } });
  global.localStorage = throwing;
  try {
    MK.store.write("module:goals", { version: 1, goals: [] });
    MK.store.remove("module:goals"); // 例外を伝播しない
    assert(!("module:goals" in MK.store._cache), "例外環境でも _cache からは落ちる");
  } finally {
    global.localStorage = orig;
  }
});

test("store: collection() load は未保存・不正形式で既定 { version, [key]: [] } を返す", (MK) => {
  // 観点: 配列キー1本の load 定型（Issue #139）。未保存＝null、key が配列でない＝不正形式
  const c = MK.store.collection("module:todo", { key: "tasks", stamp: true });
  eq(c.load(), { version: 1, tasks: [] }); // 未保存
  MK.store.write("module:todo", { version: 1, tasks: "not-array" });
  eq(c.load(), { version: 1, tasks: [] }); // 不正形式
  // 既定は毎回別インスタンス（共有参照の破壊を防ぐ）
  assert(c.load() !== c.load(), "既定オブジェクトは毎回新規");
});

test("store: collection() load は保存済みデータをそのまま返す", (MK) => {
  const c = MK.store.collection("module:todo", { key: "tasks" });
  const saved = { version: 1, tasks: [{ id: "t1" }], exportedAt: "2020-01-01T00:00:00.000Z" };
  MK.store.write("module:todo", saved);
  eq(c.load(), saved);
});

test("store: collection() save は stamp:true で exportedAt を付与し、保存成否を返す", (MK) => {
  // 観点: stamp 有無で exportedAt 付与を切り替え（既存の各モジュール保存仕様を維持）
  const stamped = MK.store.collection("module:todo", { key: "tasks", stamp: true });
  const d = { version: 1, tasks: [] };
  const ok = stamped.save(d);
  eq(ok, true);
  assert(typeof d.exportedAt === "string" && d.exportedAt, "exportedAt が付与される");
  eq(MK.store.read("module:todo").exportedAt, d.exportedAt);

  const plain = MK.store.collection("module:goals", { key: "goals" });
  const g = { version: 1, goals: [] };
  plain.save(g);
  assert(!("exportedAt" in g), "stamp 未指定なら exportedAt を付与しない");
});

test("store: onWriteError フックが呼ばれる（案内導線の差し込み点）", (MK) => {
  const orig = global.localStorage;
  const q = makeQuotaLS();
  global.localStorage = q;
  let got = null;
  MK.store.onWriteError = (info) => { got = info; };
  try {
    MK.store.write("settings", { a: 1 });
    assert(got, "onWriteError が呼ばれる");
    eq(got.quota, true);
  } finally {
    MK.store.onWriteError = null;
    global.localStorage = orig;
  }
});
