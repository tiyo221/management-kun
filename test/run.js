/* テストランナー — 依存ゼロ。`node test/run.js` で実行。
   test/*.test.js を自動で読み込み、グローバルの test/assert/eq/almost を使う。 */
"use strict";
const fs = require("fs");
const path = require("path");
const { setup, reset } = require("./harness");

const MK = setup();
let pass = 0, fail = 0;
const fails = [];

global.MK = MK;
// 非同期テスト（Promise を返す test）は結果を pending へ積み、全ファイルの読込後にまとめて待つ。
// 対象は Promise の決着そのものを見るもの（ui.confirm）だけ ── 続きは全テストの本体が走り終えた
// あとのマイクロタスクで動くため、DOM のような共有状態ではなく手元に控えた値だけを検証する。
const pending = [];
function record(name, e) {
  if (e) { fail++; fails.push(name + " — " + (e && e.message ? e.message : e)); process.stdout.write("x"); }
  else { pass++; process.stdout.write("."); }
}
global.test = function (name, fn) {
  reset(MK);
  try {
    const r = fn(MK);
    if (r && typeof r.then === "function") { pending.push(r.then(() => record(name), (e) => record(name, e))); return; }
    record(name);
  } catch (e) { record(name, e); }
};
global.assert = function (cond, msg) { if (!cond) throw new Error(msg || "assert failed"); };
global.eq = function (a, b, msg) {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error((msg ? msg + ": " : "") + "expected " + B + " got " + A);
};
global.almost = function (a, b, msg) { if (Math.abs(a - b) > 1e-6) throw new Error((msg ? msg + ": " : "") + "expected ~" + b + " got " + a); };

fs.readdirSync(__dirname)
  .filter((f) => f.endsWith(".test.js"))
  .sort()
  .forEach((f) => require(path.join(__dirname, f)));

Promise.all(pending).then(() => {
  console.log("\n" + pass + " passed, " + fail + " failed");
  fails.forEach((f) => console.log("  ✗ " + f));
  process.exit(fail ? 1 : 0);
});
