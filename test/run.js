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
global.test = function (name, fn) {
  reset(MK);
  try { fn(MK); pass++; process.stdout.write("."); }
  catch (e) { fail++; fails.push(name + " — " + (e && e.message ? e.message : e)); process.stdout.write("x"); }
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

console.log("\n" + pass + " passed, " + fail + " failed");
fails.forEach((f) => console.log("  ✗ " + f));
process.exit(fail ? 1 : 0);
