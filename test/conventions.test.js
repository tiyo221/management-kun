/* 規約の静的検査（Issue #312）— CONVENTIONS.md の規約のうち、ソースを読めば機械で判定できるものを
   ここで固定する。§6 の DoD は「人が目視するしかないもの」だけを残す方針で、ここに来た項目は
   md のチェックリストから削られている（テスト名がそのまま項目名）。
   検査は grep ではなくコメント・文字列を落とした「コード部分」に対して行う（説明文や JSDoc に
   出てくる `localStorage` / `"project"` を違反と誤検出しないため）。 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const cp = require("child_process");
const { ALL_MODULE_IDS } = require("./harness");

const rootDir = path.join(__dirname, "..");

/** リポジトリ相対パスのソースを読む。 */
function read(rel) {
  return fs.readFileSync(path.join(rootDir, rel), "utf8");
}

/** モジュールの logic.js / view.js の相対パス一覧（id 順）。 */
function moduleFiles(kind) {
  return ALL_MODULE_IDS.map((id) => ({ id, rel: "modules/" + id + "/" + kind + ".js" }))
    .filter((f) => fs.existsSync(path.join(rootDir, f.rel)));
}

/* 走査の下ごしらえは2段。行番号と桁を保つため、落とす文字は空白へ置き換える（改行は残す）。
   正規表現リテラルは除算と区別が付かないので触らない（本リポジトリのコードで誤判定を生む
   書き方が無いことを検査側で担保する）。

   - textOf() … コメントだけを落とす。**文字列の中身を見たい検査**に使う
     （`=== "project"` の決め打ち・テンプレート内の `style="margin…"`）。
   - codeOf() … さらに文字列リテラルの中身も落とす。**識別子を探す検査**に使う
     （説明文や JSDoc の `localStorage` / `render()` を違反にしないため）。 */
const blank = (s) => s.replace(/[^\n]/g, " ");

function textOf(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === "//") {
      const end = src.indexOf("\n", i);
      const stop = end < 0 ? src.length : end;
      out += blank(src.slice(i, stop)); i = stop; continue;
    }
    if (two === "/*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += blank(src.slice(i, stop)); i = stop; continue;
    }
    // 文字列は中身を残すが、その中の `//` `/*` をコメント開始と誤読しないよう読み飛ばす。
    const q = src[i];
    if (q === '"' || q === "'" || q === "`") {
      const j = endOfString(src, i);
      out += src.slice(i, j); i = j; continue;
    }
    out += src[i]; i++;
  }
  return out;
}

/** src[i] の引用符から始まる文字列リテラルの終端（閉じ引用符の次）を返す。 */
function endOfString(src, i) {
  const q = src[i];
  let j = i + 1;
  while (j < src.length) {
    if (src[j] === "\\") { j += 2; continue; }
    if (src[j] === q) return j + 1;
    if (q !== "`" && src[j] === "\n") return j; // 未閉じの引用符で暴走させない
    j++;
  }
  return j;
}

function codeOf(src) {
  const text = textOf(src);
  let out = "";
  let i = 0;
  while (i < text.length) {
    const q = text[i];
    if (q === '"' || q === "'" || q === "`") {
      const j = endOfString(text, i);
      const closed = text[j - 1] === q && j - 1 > i;
      out += q + blank(text.slice(i + 1, closed ? j - 1 : j)) + (closed ? q : "");
      i = j; continue;
    }
    out += text[i]; i++;
  }
  return out;
}

/** code の中で re に当たる箇所を `rel:line` の配列で返す。 */
function hits(rel, code, re) {
  const found = [];
  code.split(/\r?\n/).forEach((line, n) => {
    re.lastIndex = 0;
    if (re.test(line)) found.push(rel + ":" + (n + 1));
  });
  return found;
}

/** 全ファイルのコード部分（文字列の中身も落とす）を走査して違反箇所を集める。 */
function scan(files, re) {
  const out = [];
  files.forEach((f) => { out.push(...hits(f.rel, codeOf(read(f.rel)), re)); });
  return out;
}

/** 全ファイルのコメント以外（文字列の中身は残す）を走査して違反箇所を集める。 */
function scanText(files, re) {
  const out = [];
  files.forEach((f) => { out.push(...hits(f.rel, textOf(read(f.rel)), re)); });
  return out;
}

// ---- codeOf 自体の検査（この土台が壊れると、以下の検査が黙って全部通る） ----

test("codeOf(): コメント・文字列を落とし、コード部分だけを残す（#312）", () => {
  // 観点: 説明文や文字列リテラルの中の語を違反と誤検出しない土台。行番号がずれないことも見る。
  // 入力: 行コメント／ブロックコメント／各種引用符に「localStorage」を埋めたソース
  // 期待: コード部分の localStorage だけが残り、行数は入力と同じ
  const src = [
    "// localStorage の説明",
    "/* localStorage",
    "   の説明 */",
    'const s = "localStorage";',
    "const t = `localStorage`;",
    "localStorage.getItem(k);",
  ].join("\n");
  const code = codeOf(src);
  eq(code.split("\n").length, 6, "行数が保たれる");
  eq(code.split("\n").filter((l) => l.indexOf("localStorage") >= 0).length, 1, "コード部分の1行だけ残る");
  assert(/^localStorage\.getItem/.test(code.split("\n")[5]), "残るのは 6 行目");
});

test("textOf(): コメントだけを落とし、文字列の中身は残す（#312）", () => {
  // 観点: リテラルの中身を見る検査（`=== "project"` / テンプレート内の style 属性）の土台。
  //       文字列の中の `//` をコメント開始と誤読して以降を消してしまわないことも見る。
  // 入力: コメント／文字列／文字列内 URL を含むソース
  // 期待: コメントだけが空白化され、文字列の中身と後続コードは残る
  const src = [
    '// if (d === "project") {}',
    'if (d === "project") { const u = "https://example.com"; }',
  ].join("\n");
  const text = textOf(src);
  const lines = text.split("\n");
  assert(lines[0].indexOf("project") < 0, "コメント行は落ちる");
  assert(/if \(d === "project"\)/.test(lines[1]), "コード行のリテラルは残る");
  assert(lines[1].indexOf("example.com") >= 0, "文字列内の // で後続を消さない");
});

test("検出器が実際に違反へ当たる（無検出で緑になる罠を塞ぐ・#312）", () => {
  // 観点: 走査の正規表現が何かの拍子に何にも当たらなくなると、規約検査が全部素通りで緑になる。
  //       各検出器へ「必ず違反」のソースを1本ずつ通して、当たることと当たらない書き方を固定する。
  // 入力: 合成した違反スニペットと、違反でない対照
  // 期待: 違反側だけがヒットする
  const fire = (re, src, prep) => (prep || codeOf)(src).split("\n").some((l) => { re.lastIndex = 0; return re.test(l); });
  assert(fire(/\bdocument\b|\bMK\.ui\b|\bwindow\.(?!MK\b)/, "const d = document.body;"), "DOM 参照を検出");
  assert(!fire(/\bdocument\b|\bMK\.ui\b|\bwindow\.(?!MK\b)/, "const MK = window.MK;"), "window.MK 受けは違反にしない");
  assert(fire(/\blocalStorage\b/, "localStorage.getItem(k);"), "localStorage 直叩きを検出");
  assert(fire(/\brender\s*\(/, "render();"), "render 呼び出しを検出");
  const proj = /\w*(?:dim|scope)\w*\s*[=!]==\s*["'`]project["'`]|["'`]project["'`]\s*[=!]==\s*\w*(?:dim|scope)\w*/i;
  assert(fire(proj, 'if (dim === "project") {}', textOf), "決め打ち分岐を検出");
  assert(fire(proj, 'if (a.scopeAttr !== "project") {}', textOf), "属性名でも検出");
  assert(!fire(proj, 'const dim = d || "project";', textOf), "既定値は違反にしない");
  assert(!fire(proj, 'if (sort === "project") {}', textOf), "並び順キーは違反にしない");
  const sp = /style\s*=\s*["'`][^"'`]*(?:margin|padding)|\.style\.(?:margin|padding)/;
  assert(fire(sp, "el.style.marginTop = 4;", textOf), "style.margin 代入を検出");
  assert(fire(sp, 'h = `<div style="margin:2px">`;', textOf), "テンプレート内の style 属性を検出");
  const dlg = /(?<![.\w])(?:confirm|alert|prompt)\s*\(/;
  assert(fire(dlg, "confirm(1);"), "ネイティブ confirm を検出");
  assert(!fire(dlg, "MK.ui.confirm(1);"), "MK.ui.confirm は違反にしない");
  const ut = /(?<!Delete)\bundoToast\s*\(/;
  assert(fire(ut, "MK.ui.undoToast(m, fn);"), "undoToast 直呼びを検出");
  assert(!fire(ut, "MK.ui.undoDeleteToast(m, fn);"), "undoDeleteToast は違反にしない");
});

test("codeOf(): 走査対象が空にならない（無効化の番人・#312）", () => {
  // 観点: codeOf が何かの拍子に全部を空白へ潰すと、以下の検査が全部素通りで緑になる。
  // 入力: 全モジュールの logic.js / view.js
  // 期待: どのファイルもコード部分に中身が残っている
  const files = moduleFiles("logic").concat(moduleFiles("view"));
  assert(files.length >= 20, "走査対象が十分ある: " + files.length);
  files.forEach((f) => {
    const code = codeOf(read(f.rel)).replace(/\s/g, "");
    assert(code.length > 200, f.rel + " のコード部分が空に近い（codeOf の破損を疑う）");
  });
});

// ---- §1.3 logic の責務 ----

test("§1.3: logic が DOM / document / MK.ui を参照しない（#312）", () => {
  // 観点: ドメイン規則を取り出せる形に保つ判定材料 (1)（§1.1.1）。DOM から切れているから node で叩ける。
  // 入力: 全モジュールの logic.js のコード部分
  // 期待: document / MK.ui / window（先頭の `window.MK` 受けを除く）への参照がゼロ
  const bad = scan(moduleFiles("logic"), /\bdocument\b|\bMK\.ui\b|\bwindow\.(?!MK\b)/);
  eq(bad, [], "logic が DOM を参照している");
});

test("§1.3: logic が localStorage を直叩きしない（MK.store 経由・#312）", () => {
  // 観点: 読み書き先を差し替えられる状態を保つ（§1.4）。store 抽象の背後に閉じる。
  // 入力: 全モジュールの logic.js のコード部分（説明文の localStorage は codeOf が落とす）
  // 期待: localStorage への参照がゼロ
  eq(scan(moduleFiles("logic"), /\blocalStorage\b/), [], "logic が localStorage を直叩きしている");
});

test("§1.3: logic が render を呼ばない（描画は view の責務・#312）", () => {
  // 観点: logic の副作用は save まで。描画を呼ぶと view から切り離せなくなる。
  // 入力: 全モジュールの logic.js のコード部分
  // 期待: render( / render() の呼び出しがゼロ
  eq(scan(moduleFiles("logic"), /\brender\s*\(/), [], "logic が render を呼んでいる");
});

test("§1.3: logic の store 名前空間が自分の `module:<id>` に閉じている（#312）", () => {
  // 観点: モジュールは自分の名前空間だけを書く（scoped は `module:<id>:<targetId>`）。
  // 入力: 各 logic.js の MK.store.scope(...) / collection(...) の第1引数リテラル
  // 期待: すべて "module:<id>" か "module:<id>:" 始まり（他モジュールの領域を書かない）
  const bad = [];
  moduleFiles("logic").forEach((f) => {
    const src = read(f.rel);
    const re = /MK\.store\.(?:scope|collection)\(\s*(?:"([^"]*)"|'([^']*)'|`([^`$]*)`)/g;
    let m;
    while ((m = re.exec(src))) {
      const ns = m[1] || m[2] || m[3] || "";
      if (ns !== "module:" + f.id && ns.indexOf("module:" + f.id + ":") !== 0) bad.push(f.rel + " → " + ns);
    }
  });
  eq(bad, [], "自分以外の名前空間へ書いている");
});

// ---- §3 / spec §3.7 スコープ次元 ----

test("§3: スコープ次元を `\"project\"` で決め打ち分岐していない（spec §3.7.6・#312）", () => {
  // 観点: 次元は config／配列を回して汎用に扱う。Product を足すだけで成立する状態を保つ。
  // 入力: 全モジュールの logic.js / view.js（リテラルの中身を見るので textOf で走査）
  // 期待: dim / scope 名の値を "project" と等値比較する箇所がゼロ。
  //   既定値（`d || "project"`）・属性値（`dim: "project"`）は分岐ではないので対象外。
  //   `sort === "project"`（並び順キー）のような同名の別概念に当てないため、左辺は dim / scope 名に限る。
  //   ※ 決め打ちの形はこれだけではない。この検査は代表形のトリップワイヤで、規約そのものは §3 / spec §3.7.6。
  const files = moduleFiles("logic").concat(moduleFiles("view"));
  const bad = scanText(files, /\w*(?:dim|scope)\w*\s*[=!]==\s*["'`]project["'`]|["'`]project["'`]\s*[=!]==\s*\w*(?:dim|scope)\w*/i);
  eq(bad, [], "次元を決め打ち分岐している");
});

// ---- §2.1 余白 / §2.3 ダイアログ / §2.5-3 undo ----

test("§2.1: モジュールに余白のインライン直書きが無い（#312）", () => {
  // 観点: ブロック間隔は共通のレイアウト土台（ui.stack / design.css）に委ねる。
  // 入力: 全モジュールの logic.js / view.js（style 属性・style.margin 代入の両方）
  // 期待: margin / padding のインライン指定がゼロ
  // ※ style 属性はテンプレートリテラルの中に書けるので textOf（コメントだけ落とす）で走査する。
  const files = moduleFiles("logic").concat(moduleFiles("view"));
  const bad = scanText(files, /style\s*=\s*["'`][^"'`]*(?:margin|padding)|\.style\.(?:margin|padding)/);
  eq(bad, [], "余白をインラインで直書きしている");
});

test("§2.3: ネイティブ confirm / alert / prompt を使っていない（#312）", () => {
  // 観点: 確認・通知は MK.ui へ寄せる（トークン描画・ダーク追従・Esc）。
  // 入力: 全モジュールの logic.js / view.js のコード部分
  // 期待: MK.ui 経由でない confirm( / alert( / prompt( がゼロ
  const files = moduleFiles("logic").concat(moduleFiles("view"));
  const bad = scan(files, /(?<![.\w])(?:confirm|alert|prompt)\s*\(/);
  eq(bad, [], "ネイティブダイアログを使っている");
});

test("§2.5-3: view が undoToast を直呼びせず undoDeleteToast を使う（#312）", () => {
  // 観点: 削除の取り消しは定型（失敗文言・Ctrl+Z の到達性）を undoDeleteToast に1本化する。
  // 入力: 全モジュールの view.js のコード部分
  // 期待: `undoToast(` の直呼びがゼロ（`undoDeleteToast(` は別語なので当たらない）
  eq(scan(moduleFiles("view"), /(?<!Delete)\bundoToast\s*\(/), [], "undoToast を直呼びしている");
});

test("§2.5-3: undo 退避を持つ logic に forgetUndo がある（#312）", () => {
  // 観点: store を logic の外から書き換える経路（全データ初期化）で退避を捨てられないと、
  //       初期化後の Ctrl+Z で消したはずの1件が復活する。
  // 入力: undoDelete を公開している全 logic.js
  // 期待: 同じファイルに forgetUndo の定義がある
  const bad = [];
  moduleFiles("logic").forEach((f) => {
    const code = codeOf(read(f.rel));
    if (/\bundoDelete\b/.test(code) && !/\bforgetUndo\b/.test(code)) bad.push(f.rel);
  });
  eq(bad, [], "undo 退避を持つのに forgetUndo が無い");
});

// ---- §1.1.1-(2) 振る舞いがテストで固定されている ----

test("§1.1.1-(2): 全モジュールに test/<id>.test.js がある（#312）", () => {
  // 観点: 「取り出せる形に保つ」の判定材料 (2)。テストの期待値が別 PJ 側の受入条件になる。
  //       個々のドメイン規則が固定されているかは機械では見られないので、器の存在だけを固定する
  //       （中身の追加義務は TESTING.md §5）。
  // 入力: マニフェストのカタログに載る全モジュール id
  // 期待: 対応する test/<id>.test.js が存在する（scoped 等で名前が割れるものは接頭辞一致を許す）
  const files = fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.js"));
  const missing = ALL_MODULE_IDS.filter((id) =>
    files.indexOf(id + ".test.js") < 0 && !files.some((f) => f.indexOf(id + "-") === 0));
  eq(missing, [], "ロジックのテストが無いモジュール");
});

// ---- §6 動作: 構文 ----

test("追跡下の .js が構文エラーなく解析できる（node --check 相当・#312）", () => {
  // 観点: view.js はハーネスの既定ロード対象に入らないため、構文エラーが全テスト緑のまますり抜ける。
  // 入力: Git 追跡下の .js 全部（未追跡の下書きは対象外）
  // 期待: すべて new vm.Script() で解析できる。取得できない環境では素通りさせず落とす。
  let list;
  try {
    list = cp.execSync('git ls-files "*.js"', { cwd: rootDir, encoding: "utf8" });
  } catch (e) {
    throw new Error("git ls-files が使えないため構文検査が成立しない（素通りで緑にしない）");
  }
  const files = list.split(/\r?\n/).filter(Boolean).filter((f) => fs.existsSync(path.join(rootDir, f)));
  assert(files.length >= 30, "走査対象が極端に少ない（取得の破損を疑う）: " + files.length);
  const bad = [];
  files.forEach((rel) => {
    try { new vm.Script(read(rel), { filename: rel }); }
    catch (e) { bad.push(rel + " — " + (e && e.message ? e.message : e)); }
  });
  eq(bad, [], "構文エラーがある");
});
