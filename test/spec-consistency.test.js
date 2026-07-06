/* 仕様⇄実装の同期ガード（Issue #117 再発防止）。
   spec.md §5 のモジュール一覧表は「時点で変わる列挙」の単一ソース（#97）であり、
   §4.6・§9・§11・§12・import-migration.md・CLAUDE.md 等はすべてこの表を参照する。
   よって §5 の表さえ実装と一致していればドキュメント全体の鮮度が保てる。
   ここでは §5 の表を実装（index.html のロード対象・各 logic.js の CSV 実装）と突き合わせ、
   モジュール追加／CSV 対応追加のたびに表の更新漏れを検出する。 */
"use strict";
const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");

/** spec.md §5 の一覧表を解析し、{ ids:Set, csv:Set } を返す（id 列と CSV 列）。 */
function parseSpecModuleTable() {
  const md = fs.readFileSync(path.join(rootDir, "spec.md"), "utf8");
  const lines = md.split(/\r?\n/);
  // §5 の表ヘッダ「| id | 名称 | ゾーン | 個別仕様 | CSV |」を起点にする。
  const headIdx = lines.findIndex((l) => /^\|\s*id\s*\|.*\|\s*CSV\s*\|/.test(l));
  assert(headIdx >= 0, "spec.md に §5 のモジュール一覧表（id … CSV 列）が見つかる");
  const ids = new Set();
  const csv = new Set();
  // ヘッダ＋区切り行の次から、表が途切れる（| で始まらない行）まで読む。
  for (let i = headIdx + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!/^\|/.test(line)) break;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 5) continue;
    const id = cells[0];
    const csvFlag = cells[cells.length - 1];
    if (!/^[a-z]+$/.test(id)) continue; // 区切り行や注記行を除外
    ids.add(id);
    if (csvFlag === "✓") csv.add(id);
  }
  return { ids, csv };
}

/** index.html が実際にロードするモジュール id 集合（実装済みモジュール）。 */
function implementedModules() {
  const html = fs.readFileSync(path.join(rootDir, "index.html"), "utf8");
  const set = new Set();
  const re = /modules\/([a-z]+)\/(?:logic|view)\.js/g;
  let m;
  while ((m = re.exec(html))) set.add(m[1]);
  return set;
}

/** logic.js に CSV 整形関数（build…CSVRows）を持つモジュール id 集合。 */
function csvModules() {
  const set = new Set();
  const dir = path.join(rootDir, "modules");
  fs.readdirSync(dir).forEach((id) => {
    const logic = path.join(dir, id, "logic.js");
    if (!fs.existsSync(logic)) return;
    if (/build[A-Za-z]*CSVRows/.test(fs.readFileSync(logic, "utf8"))) set.add(id);
  });
  return set;
}

const sorted = (s) => [...s].sort();

test("spec §5: 一覧表のモジュール id が実装（index.html のロード対象）と一致する（#117）", () => {
  const { ids } = parseSpecModuleTable();
  eq(sorted(ids), sorted(implementedModules()), "spec.md §5 の表 id ⇄ index.html のロード対象");
});

test("spec §5: CSV 列 ✓ が実装（build…CSVRows を持つモジュール）と一致する（#117）", () => {
  const { csv } = parseSpecModuleTable();
  // CSV 対応の唯一の正＝§5 の表。実装からの導出とズレたら、表かコードのどちらかが陳腐化している。
  eq(sorted(csv), sorted(csvModules()), "spec.md §5 の CSV✓ ⇄ build…CSVRows を持つモジュール");
});
