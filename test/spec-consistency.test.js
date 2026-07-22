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
const cp = require("child_process");

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
  // 列は位置ではなくヘッダ名で引く（列を足しても別のセルを黙って読まないように）。
  // 分割はエスケープされていない | でのみ行う（セル内の \| で列がずれると名前引きが崩れる）。
  const cellsOf = (line) => line.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
  const header = cellsOf(lines[headIdx]);
  const csvCol = header.indexOf("CSV");
  const specCol = header.indexOf("個別仕様");
  assert(csvCol >= 0 && specCol >= 0, "§5 の表に「個別仕様」「CSV」列がある");
  // ヘッダ＋区切り行の次から、表が途切れる（| で始まらない行）まで読む。
  for (let i = headIdx + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!/^\|/.test(line)) break;
    const cells = cellsOf(line);
    if (cells.length < header.length) continue;
    const id = cells[0];
    if (!/^[a-z]+$/.test(id)) continue; // 区切り行や注記行を除外
    ids.add(id);
    if (cells[csvCol] === "✓") csv.add(id);
    specLink.set(id, relativeLinksOf(cells[specCol])[0] || null);
  }
  return { ids, csv, specLink };
}

/* 検査対象の .md（リポジトリ相対パスの配列）。
   正は Git の追跡ファイル——未追跡のローカル作業メモ（下書き・生成物）まで拾うと、
   リポジトリ本体と無関係な理由でフルスイートが赤くなるため。git が使えない環境
   （tarball 展開など）ではファイル走査へフォールバックし、その場合は隠しディレクトリ
   （.git / .claude 等）と node_modules を除く（.github は追跡対象の置き場なので見る）。 */
let mdFilesCache = null;
function allMarkdownFiles() {
  if (!mdFilesCache) mdFilesCache = collectMarkdownFiles(); // git の spawn を毎回繰り返さない
  const files = mdFilesCache;
  // 0件・spec.md 抜けは「全部素通り＝緑」になる無効化パターン（sparse-checkout 等）。印を残す。
  assert(files.includes("spec.md"), "検査対象の md に spec.md が含まれる（" + files.length + "件）");
  return files;
}

/** git ls-files の結果（リポジトリ相対パスの配列）。git が使えなければ null。 */
function gitLsFiles(pathspec) {
  try {
    const args = ["ls-files", "-z"].concat(pathspec ? [pathspec] : []);
    const out = cp.execFileSync("git", args, { cwd: rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.split("\0").filter((p) => p !== "");
  } catch {
    return null;
  }
}

/* Git 追跡下のパス集合（ディレクトリも「配下に追跡ファイルがある」なら含む）。
   リンク先が作業ツリーにあっても未追跡（.gitignore 済み・コミット忘れ）なら
   GitHub 上では 404 になるため、宛先側も追跡状態で判定する。git が無ければ null。 */
let trackedCache;
function trackedPaths() {
  if (trackedCache === undefined) {
    const files = gitLsFiles(null);
    if (!files) trackedCache = null;
    else {
      const set = new Set();
      files.forEach((p) => {
        set.add(p);
        const segs = p.split("/");
        for (let i = 1; i < segs.length; i++) set.add(segs.slice(0, i).join("/"));
      });
      trackedCache = set;
    }
  }
  return trackedCache;
}

function collectMarkdownFiles() {
  const tracked = gitLsFiles("*.md");
  if (tracked) return tracked;
  {
    const out = [];
    (function walk(dir) {
      fs.readdirSync(dir, { withFileTypes: true }).forEach((ent) => {
        // 隠しエントリ（ファイル・ディレクトリとも）と node_modules は見ない。.github は例外。
        if ((ent.name.startsWith(".") && ent.name !== ".github") || ent.name === "node_modules") return;
        const abs = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(abs);
        else if (ent.name.endsWith(".md")) out.push(path.relative(rootDir, abs).split(path.sep).join("/"));
      });
    })(rootDir);
    return out;
  }
}

/* コードフェンス（``` / ~~~）の中身を落とす。説明用に実在しないパスを書くため。
   フェンスのインデント量は問わず（ネストしたリスト内の4スペース以上のフェンスも
   フェンスとして扱う）、開始と同じ記号・同数以上のバッククォート/チルダが来るまでを
   中身とみなす（CommonMark の緩い近似）。
   戻り値の unclosed は「閉じていないフェンスがある」印——閉じ忘れると以降の
   本文が丸ごと検査対象外になるため、呼び手側で不整合として検出できるようにする。 */
function stripCodeFences(md) {
  const out = [];
  let fence = null; // 開始フェンスの { marker, len }
  md.split(/\r?\n/).forEach((line) => {
    const m = /^[ \t]*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (m && m[1][0] === fence.marker && m[1].length >= fence.len) fence = null;
      return; // 中身も終了フェンス自身も落とす
    }
    if (m) { fence = { marker: m[1][0], len: m[1].length }; return; }
    out.push(line);
  });
  return { body: out.join("\n"), unclosed: fence !== null };
}

/* 行内のインラインコード（`…`）を落とす。開いた列と同じ長さの列で閉じている場合だけ
   落とし、閉じ相手がいない列は記号として残す（後続の実リンクを巻き込むと検査対象から
   黙って外れる＝ガードが弱くなる方向の劣化になるため）。md 側の解釈と揃える意図で、
   閉じ相手がいる場合は中身がリンクでもコードとして扱う（描画もそうなる）。 */
function stripInlineCode(line) {
  let out = "";
  let i = 0;
  while (i < line.length) {
    if (line[i] !== "`") { out += line[i++]; continue; }
    let n = 0;
    while (line[i + n] === "`") n++;
    const open = "`".repeat(n);
    // 同じ長さの閉じ列を探す（前後がバッククォートでない位置＝ちょうど n 個の列）。
    const rest = line.slice(i + n);
    const close = new RegExp("(?<!`)" + open + "(?!`)").exec(rest);
    if (!close) { out += open; i += n; continue; } // 未閉じ: 記号だけ残して先へ
    i += n + close.index + n;
  }
  return out;
}

/* md 本文から相対リンク先を拾う（インラインリンク `](path)` のみ。参照定義形式
   `[label]: path` や <a href> は対象外）。外部 URL・ページ内アンカー・mailto は
   検証対象外（Issue #241 の決定事項）。宛先の山括弧記法 `](<path>)` は剥がし、
   タイトル（`"…"` / `'…'` / `(…)`）は落とす。 */
function relativeLinksOf(md) {
  // HTML コメント内はコメントアウトされた記述で、生きたリンクではない（フェンス同様に落とす）。
  const visible = stripCodeFences(md).body.replace(/<!--[\s\S]*?-->/g, "");
  const body = visible.split("\n").map(stripInlineCode).join("\n");
  const links = [];
  const re = /\]\(([^)\n]*)\)/g; // 宛先に生の改行は入らない（孤立した `](` が数行先の `)` と対にならないように）
  let m;
  while ((m = re.exec(body)) !== null) {
    const inner = m[1].trim();
    let target;
    const angle = /^<([^>]*)>/.exec(inner);
    if (angle) target = angle[1].trim();
    else target = inner.split(/\s/)[0];
    if (target === "") continue;
    // URI スキーム一般（http: / mailto: / tel: …）・プロトコル相対・ページ内アンカーは対象外。
    if (/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target)) continue;
    links.push(target);
  }
  return links;
}

/* パスが実在するか（リポジトリ外を指すリンクは検査しない＝常に true。旧ツールの
   リポジトリを隣に置いた前提の参照が個別仕様にあり、有無はこのリポジトリの管轄外）。
   fs.existsSync は Windows / macOS で大小文字を無視するため、
   各階層を readdirSync の実名と厳密一致で突き合わせる（大小違いのリンクは
   GitHub 上のレンダリングで切れるので、開発機でも赤くしたい）。 */
const dirEntriesCache = new Map(); // dir → readdirSync の結果（同じ階層を何度も読まない）
function entriesOf(dir) {
  if (!dirEntriesCache.has(dir)) {
    let entries;
    try { entries = fs.readdirSync(dir); } catch { entries = null; }
    dirEntriesCache.set(dir, entries);
  }
  return dirEntriesCache.get(dir);
}

function existsExact(absPath) {
  const rel = path.relative(rootDir, absPath);
  if (rel === "") return true;
  const segs = rel.split(path.sep);
  const up = segs.filter((s) => s === "..").length;
  // 1段上（＝隣のリポジトリ）までは検査対象外。それより上へ出るのは `../` の数の
  // 書き間違いとみなして落とす（無条件に通すと typo が黙って生き残る）。
  if (up > 0) return up === 1;
  let dir = rootDir;
  for (const seg of segs) {
    const entries = entriesOf(dir);
    if (!entries || !entries.includes(seg)) return false;
    dir = path.join(dir, seg);
  }
  return true;
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
    assert(existsExact(path.join(rootDir, rel)), rel + " が存在する");
    eq(specLink.get(id), rel, "spec.md §5 の " + id + " 行が個別仕様へリンクする（表記は spec/modules/<id>.md に統一）");
  });
});

test("md の相対リンクがリンク切れしていない（#241）", () => {
  // 観点: ドキュメント間の相対リンクが、ファイルの移動・改名で切れていないか
  // 入力: リポジトリ内の全 .md（コードフェンス内を除く）の `](path)` 形式リンク
  // 期待: 参照先が実在する（外部 URL・mailto・ページ内アンカーは対象外。path#anchor はファイル部分のみ検証）
  const broken = [];
  allMarkdownFiles().forEach((rel) => {
    const dir = path.dirname(path.join(rootDir, rel));
    // 追跡されているのに作業ツリーに無い（git rm せず消した／移動した）ケースも、
    // 例外で検査を中断させずここで拾う——ファイル移動の取りこぼしこそ本ガードの主目的。
    let md;
    try { md = fs.readFileSync(path.join(rootDir, rel), "utf8"); }
    catch { broken.push(rel + "（追跡されているがファイルが無い）"); return; }
    relativeLinksOf(md).forEach((target) => {
      const file = target.split("#")[0].split("?")[0]; // アンカー・クエリはファイル名の一部ではない
      // %エンコードは戻して照合するが、不正な % を含むリンクで例外死させない（生パスで見る）。
      let decoded;
      try { decoded = decodeURIComponent(file); } catch { decoded = file; }
      // `/` 始まりは GitHub の md レンダラがサイトルート（github.com/…）として解くため、
      // リポジトリ内ドキュメントへのリンクとしては必ず壊れる。常にリンク切れ扱いにする。
      if (decoded.startsWith("/")) { broken.push(rel + " → " + target + "（ルート絶対リンクは使わない）"); return; }
      // `\` 区切りは Windows の path.resolve では解決できてしまうが GitHub 上では 404。
      // OS でテスト結果が割れないよう、実在チェックの前に落とす。
      if (decoded.includes("\\")) { broken.push(rel + " → " + target + "（区切りは / を使う）"); return; }
      const abs = path.resolve(dir, decoded);
      if (!existsExact(abs)) { broken.push(rel + " → " + target); return; }
      // 作業ツリーにあっても未追跡（.gitignore 済み・コミット忘れ）なら GitHub 上では 404。
      // 走査元の「追跡されているが作業ツリーに無い」と対で、宛先側の追跡漏れも拾う。
      const tracked = trackedPaths();
      const relTarget = path.relative(rootDir, abs).split(path.sep).join("/");
      if (tracked && !relTarget.startsWith("..") && !tracked.has(relTarget)) {
        broken.push(rel + " → " + target + "（Git 追跡下に無い）");
      }
    });
  });
  eq(broken, [], "リンク切れ");
});

test("relativeLinksOf(): コード内の記述を拾わず、実リンクだけを返す（#241）", () => {
  // 観点: リンク抽出の除外条件（フェンス・インラインコード・外部 URL・アンカー）が効いているか
  //       ——ここが壊れると「検査対象から静かに外れる」＝ガードが黙って弱くなるため、実データに
  //       依存せずリテラルで固定する。
  // 入力: 各種フェンス（```／~~~／インデント／4連バッククォート）とインラインコードを含む md 断片
  // 期待: フェンス内・インラインコード内・外部 URL・アンカーは拾わず、本文の相対リンクだけを返す
  const md = [
    "本文 [a](real1.md) と [外部](https://example.com/x.md) と [中](#anchor)。",
    "```",
    "[fence](fenced1.md)",
    "```",
    "- リスト:",
    "  ```js",
    "  [indented](fenced2.md)",
    "  ```",
    "~~~",
    "[tilde](fenced3.md)",
    "~~~",
    "````",
    "``` 入れ子",
    "[deep](fenced4.md)",
    "````",
    "インラインコード `](fenced5.md)` は拾わない。",
    "末尾 [b](real2.md)。",
  ].join("\n");
  eq(relativeLinksOf(md), ["real1.md", "real2.md"]);
});

test("relativeLinksOf(): 閉じないバッククォートで後続のリンクを巻き込まない（#241）", () => {
  // 観点: インラインコード除去が「閉じている組」だけを落とすこと。閉じ相手のいない ` に続く
  //       実リンクまで消すと、リンク切れを静かに見逃す（ガードが弱くなる方向の劣化）。
  // 入力: (1) 閉じ相手のいない ` の後ろにリンクがある行、(2) 長さの違う ` 列が混ざる行、
  //       (3) 閉じたインラインコード内のリンク
  // 期待: (1)(2) は拾う（md でもコードにならず本物のリンクとして描画される）、(3) は拾わない
  eq(relativeLinksOf("閉じない ` の後ろ [x](y.md)"), ["y.md"]);
  eq(relativeLinksOf("``a ` b`` [c](z.md)"), ["z.md"]);
  eq(relativeLinksOf("`[d](w.md)` と [e](v.md)"), ["v.md"]);
});

test("relativeLinksOf(): 山括弧宛先とタイトル付きリンクを正しく解く（#241）", () => {
  // 観点: 記法差で宛先を取り違えない（<…> は剥がす／タイトルは宛先に含めない）
  // 入力: 山括弧記法・二重引用符/単引用符/括弧のタイトル付きリンク
  // 期待: いずれも宛先パスだけを返す（従来は <a.md> をそのまま返し誤検知、'…' は未検査だった）
  eq(relativeLinksOf("[x](<a.md>) [y](b.md \"t\") [z](c.md 't') [w](d.md (t))"), ["a.md", "b.md", "c.md", "d.md"]);
});

test("trackedPaths(): 追跡ファイルとその親ディレクトリを含み、未追跡は含まない（#241）", () => {
  // 観点: リンク先の追跡判定の土台。作業ツリーにあっても未追跡なら GitHub 上では 404 になるため、
  //       宛先の実在（existsExact）だけでなく追跡状態も見る必要がある。
  // 入力: 追跡ファイル（spec.md）・親ディレクトリ（spec/modules）・gitignore 済み（test/coverage.html）
  // 期待: 前2つは含み、gitignore 済みは含まない（git が無い環境では判定自体をスキップ＝null）
  const tracked = trackedPaths();
  if (!tracked) return; // git が使えない環境ではこの検査自体が無効（フォールバック）
  assert(tracked.has("spec.md"), "追跡ファイルを含む");
  assert(tracked.has("spec/modules"), "追跡ファイルの親ディレクトリを含む");
  assert(!tracked.has("test/coverage.html"), "gitignore 済みは含まない");
});

test("relativeLinksOf(): 宛先が行をまたがない（#241）", () => {
  // 観点: 孤立した `](` が数行先の `)` と対になって偽のリンク先を拾わないこと
  //       （CommonMark ではリンク宛先に生の改行は入らない）
  // 自明: 1行目の `](` は宛先を持たず、拾えるのは2行目の実リンクだけ
  eq(relativeLinksOf("text ](\nfoo.md) more [a](b.md)"), ["b.md"]);
});

test("stripCodeFences(): 閉じていないフェンスを検出する（#241）", () => {
  // 観点: フェンスの閉じ忘れで以降の本文が丸ごと検査対象外になるのを、印として拾えること
  // 自明: 閉じたフェンスは unclosed=false、閉じないままなら true
  eq(stripCodeFences("```\ncode\n```\n[a](x.md)").unclosed, false);
  eq(stripCodeFences("```\ncode\n\n[a](x.md)").unclosed, true);
});

test("md にコードフェンスの閉じ忘れが無い（#241）", () => {
  // 観点: 閉じ忘れたフェンスがあると、そのファイルの残り全部がリンク検査から静かに外れる
  // 入力: 検査対象の全 md
  // 期待: unclosed なファイルはゼロ
  const unclosed = allMarkdownFiles().filter((rel) => {
    // 追跡されているのに無いファイルはリンク検査側が報告するので、ここでは黙って飛ばす。
    if (!fs.existsSync(path.join(rootDir, rel))) return false;
    return stripCodeFences(fs.readFileSync(path.join(rootDir, rel), "utf8")).unclosed;
  });
  eq(unclosed, [], "閉じていないコードフェンスを持つ md");
});

test("relativeLinksOf(): リンクテキストがコードでもリンクは拾う（#241）", () => {
  // 観点: §5 表の記法 [`spec/modules/x.md`](spec/modules/x.md)（リンクテキストがインラインコード）で
  //       宛先を取り逃さないこと。インラインコード除去がリンク全体を巻き込むと検査が空振りする。
  // 自明: 入力・期待とも1行で読み取れる
  eq(relativeLinksOf("[`spec/modules/x.md`](spec/modules/x.md)"), ["spec/modules/x.md"]);
});

test("existsExact(): 大小文字を区別し、リポジトリ外は検査しない（#241）", () => {
  // 観点: fs.existsSync の大小文字無視（Windows / macOS）で GitHub 上のリンク切れを見逃さないこと
  // 入力: 実在する spec.md／大小違いの SPEC.md／存在しないパス／リポジトリ外を指すパス
  // 期待: 実在=true、大小違い=false（GitHub では切れる）、不在=false、リポジトリ外=true（対象外）
  eq(existsExact(path.join(rootDir, "spec.md")), true);
  eq(existsExact(path.join(rootDir, "SPEC.md")), false);
  eq(existsExact(path.join(rootDir, "spec/modules/__none__.md")), false);
  eq(existsExact(path.join(rootDir, "../sibling-repo/spec.md")), true); // 隣のリポジトリ＝対象外
  eq(existsExact(path.join(rootDir, "../../too-far/spec.md")), false); // 2段以上上は ../ の書き間違い
});

test("relativeLinksOf(): インデントの深いフェンス・HTML コメント・各種スキームを除外する（#241）", () => {
  // 観点: 6巡目レビューで挙がった除外漏れ（4スペース以上インデントのフェンス／コメントアウト／
  //       http 以外のスキーム）を固定する。いずれも「誤検知で赤くなる」「対象外を相対パス扱い」の穴。
  // 入力: ネストしたリスト内（4スペース）のフェンス、HTML コメント内リンク、tel:／data: リンク
  // 期待: いずれも拾わず、本文の相対リンクだけを返す
  const md = [
    "- 手順:",
    "  - 詳細:",
    "    ```sh",
    "    [deep](fenced.md)",
    "    ```",
    "<!-- [commented](hidden.md) -->",
    "[tel](tel:0123) [data](data:text/plain,x) [real](ok.md)",
  ].join("\n");
  eq(relativeLinksOf(md), ["ok.md"]);
});
