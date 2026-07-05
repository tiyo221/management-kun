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
