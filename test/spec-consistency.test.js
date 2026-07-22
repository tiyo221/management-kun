/* 仕様⇄実装の同期ガード（Issue #117 再発防止）。
   spec.md §5 のモジュール一覧表は「時点で変わる列挙」の単一ソース（#97）であり、
   §4.6・§11・§12・import-migration.md・CLAUDE.md 等はすべてこの表を参照する。
   よって §5 の表さえ実装と一致していればドキュメント全体の鮮度が保てる。
   ここでは §5 の表を実装（shared/manifest.js のカタログ・各 logic.js の CSV 実装）と突き合わせ、
   モジュール追加／CSV 対応追加のたびに表の更新漏れを検出する。
   あわせてドキュメント側の取りこぼし（個別仕様 spec/modules/<id>.md の作成・リンク漏れ、
   md 間の相対リンク切れ）も機械的に検出する（人力 grep は取りこぼす・#227 / #241）。 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const rootDir = path.join(__dirname, "..");

/** spec.md §5 の一覧表を解析し、{ ids:Set, csv:Set, specLink:Map } を返す（id 列・CSV 列・個別仕様リンク列）。 */
function parseSpecModuleTable() {
  const md = fs.readFileSync(path.join(rootDir, "spec.md"), "utf8");
  const lines = md.split(/\r?\n/);
  // §5 の表ヘッダ「| id | 名称 | ゾーン | 個別仕様 | CSV |」を起点にする。
  const headIdx = lines.findIndex((l) => /^\|\s*id\s*\|.*\|\s*CSV\s*\|/.test(l));
  assert(headIdx >= 0, "spec.md に §5 のモジュール一覧表（id … CSV 列）が見つかる");
  const ids = new Set();
  const csv = new Set();
  const specLink = new Map(); // id → 個別仕様セルのリンク先（無ければ null）
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
    const link = /\]\(([^)\s]+)\)/.exec(cells[cells.length - 2]);
    specLink.set(id, link ? link[1] : null);
  }
  return { ids, csv, specLink };
}

/** リポジトリ内の .md を再帰的に集める（相対パスの配列）。 */
function allMarkdownFiles() {
  const out = [];
  const skip = new Set([".git", "node_modules"]);
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((ent) => {
      if (skip.has(ent.name)) return;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.name.endsWith(".md")) out.push(path.relative(rootDir, abs).split(path.sep).join("/"));
    });
  })(rootDir);
  return out;
}

/* md 本文からリンク先を拾う。フェンス（``` … ```）内はコード例なので除外する
   （実在しないパスを説明用に書くことがあるため）。外部 URL・ページ内アンカー・
   mailto は検証対象外（Issue #241 の決定事項）。 */
function relativeLinksOf(md) {
  const body = md.replace(/^```[\s\S]*?^```/gm, "");
  const links = [];
  const re = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const target = m[1];
    if (/^(https?:|mailto:|#|\/\/)/.test(target)) continue;
    links.push(target);
  }
  return links;
}

/** 実装済みモジュール id 集合＝構成マニフェストのカタログ（shared/manifest.js の単一ソース・Issue #137）。 */
function implementedModules() {
  const code = fs.readFileSync(path.join(rootDir, "shared/manifest.js"), "utf8");
  // document を undefined にしてスクリプト注入をスキップさせ、window.MK_MANIFEST だけ取り出す。
  const sandbox = { window: {}, document: undefined };
  vm.runInNewContext(code, sandbox, { filename: "shared/manifest.js" });
  return new Set(Object.keys(sandbox.window.MK_MANIFEST.catalog));
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

test("spec §5: 一覧表のモジュール id が実装（マニフェストのカタログ）と一致する（#117）", () => {
  // 観点: spec.md §5 の表（モジュール列挙の単一ソース）と実装のカタログがズレていないか
  // 入力: spec.md §5 表の id 列と shared/manifest.js の catalog キー
  // 期待: 両集合が完全一致（追加漏れ・削除漏れがあれば検出）
  const { ids } = parseSpecModuleTable();
  eq(sorted(ids), sorted(implementedModules()), "spec.md §5 の表 id ⇄ manifest カタログ");
});

test("spec §5: CSV 列 ✓ が実装（build…CSVRows を持つモジュール）と一致する（#117）", () => {
  // 観点: §5 表の CSV✓ と、実装で CSV 整形関数を持つモジュールがズレていないか
  // 入力: spec.md §5 表で CSV=✓ の id 集合と、logic.js に build…CSVRows を持つ id 集合
  // 期待: 両集合が完全一致（CSV 対応の追加漏れ・表の陳腐化を検出）
  const { csv } = parseSpecModuleTable();
  // CSV 対応の唯一の正＝§5 の表。実装からの導出とズレたら、表かコードのどちらかが陳腐化している。
  eq(sorted(csv), sorted(csvModules()), "spec.md §5 の CSV✓ ⇄ build…CSVRows を持つモジュール");
});

test("spec §5: 各モジュールに個別仕様 spec/modules/<id>.md があり表から参照されている（#241）", () => {
  // 観点: モジュール追加時に個別仕様の作成・リンクを忘れていないか（CONVENTIONS §5 手順5 の自動化）
  // 入力: manifest カタログの id 集合と、spec.md §5 表の「個別仕様」セルのリンク先
  // 期待: 各 id について spec/modules/<id>.md が実在し、表のリンクがそのパスを指す
  const { specLink } = parseSpecModuleTable();
  // 方向はカタログ → md の一方向のみ。逆向き（md → カタログ）を見ると、退役モジュールの
  // 記録として残す spec/modules/workload.md（#167）が違反になってしまう。
  sorted(implementedModules()).forEach((id) => {
    const rel = "spec/modules/" + id + ".md";
    assert(fs.existsSync(path.join(rootDir, rel)), rel + " が存在する");
    eq(specLink.get(id), rel, "spec.md §5 の " + id + " 行が個別仕様へリンクする");
  });
});

test("md の相対リンクがリンク切れしていない（#241）", () => {
  // 観点: ドキュメント間の相対リンクが、ファイルの移動・改名で切れていないか
  // 入力: リポジトリ内の全 .md（コードフェンス内を除く）の `](path)` 形式リンク
  // 期待: 参照先が実在する（外部 URL・mailto・ページ内アンカーは対象外。path#anchor はファイル部分のみ検証）
  const broken = [];
  allMarkdownFiles().forEach((rel) => {
    const dir = path.dirname(path.join(rootDir, rel));
    relativeLinksOf(fs.readFileSync(path.join(rootDir, rel), "utf8")).forEach((target) => {
      const file = target.split("#")[0];
      if (!file) return; // 同一ファイル内アンカーのみ
      if (!fs.existsSync(path.resolve(dir, decodeURIComponent(file)))) broken.push(rel + " → " + target);
    });
  });
  eq(broken, [], "リンク切れ");
});
