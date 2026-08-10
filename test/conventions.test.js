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

/* 走査の下ごしらえ。ソースを1回だけ舐めて2つの見え方を同時に作る。行番号と桁を保つため、
   落とす文字は空白へ置き換える（改行は残す）。

   - text … コメント・正規表現の中身だけを落とす。**文字列の中身を見たい検査**に使う
     （`=== "project"` の決め打ち・テンプレート内の `style="margin…"`）。
   - code … さらに文字列リテラルの中身も落とす。**識別子を探す検査**に使う
     （説明文や JSDoc の `localStorage` / `render()` を違反にしないため）。

   正規表現リテラルは除算と区別が付かないので、直前の意味のあるトークンで判別する（値が
   来た直後の `/` は除算、演算子・記号・キーワードの直後は正規表現）。ここを飛ばすと
   `/[",\r\n]/`（`shared/io.js` にある実在の書き方）のバッククォート／引用符が文字列の
   開始と誤読され、**以降のコードが丸ごと空白化されて全検出器が黙って素通りする**。
   テンプレートリテラルの `${…}` は中身をコードとして残す（置換式に書いた違反を見逃さない）。 */
const blank = (s) => s.replace(/[^\n]/g, " ");

// 直前がこれらで終わっていれば、続く `/` は除算ではなく正規表現の開始とみなす。
const REGEX_PRECEDERS = "(,=:[!&|?{};+-*%~^<>";
const REGEX_KEYWORDS = /(?:^|[^\w$.])(?:return|typeof|instanceof|case|in|of|new|delete|void|throw|do|else|yield|await)$/;

/** ソースを走査して { text, code } を返す（どちらも元と同じ長さ・同じ行数）。 */
function split(src) {
  let text = "", code = "";
  let i = 0;
  let prev = ""; // これまでに出力したコード部分（正規表現／除算の判別に使う）
  const emit = (t, c) => { text += t; code += c; prev += c; };
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === "//") {
      const end = src.indexOf("\n", i);
      const stop = end < 0 ? src.length : end;
      const b = blank(src.slice(i, stop));
      text += b; code += b; i = stop; continue;
    }
    if (two === "/*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      const b = blank(src.slice(i, stop));
      text += b; code += b; i = stop; continue;
    }
    const ch = src[i];
    if (ch === "/" && isRegexStart(prev)) {
      const j = endOfRegex(src, i);
      emit(src.slice(i, j), blank(src.slice(i, j)));
      i = j; continue;
    }
    if (ch === '"' || ch === "'") {
      const j = endOfQuoted(src, i);
      const closed = src[j - 1] === ch && j - 1 > i;
      emit(src.slice(i, j), ch + blank(src.slice(i + 1, closed ? j - 1 : j)) + (closed ? ch : ""));
      i = j; continue;
    }
    if (ch === "`") {
      const j = scanTemplate(src, i, emit);
      i = j; continue;
    }
    emit(ch, ch); i++;
  }
  return { text, code };
}

/** 直前に出力したコード部分から、続く `/` が正規表現の開始かを判定する。 */
function isRegexStart(prev) {
  const t = prev.replace(/\s+$/, "");
  if (t === "") return true; // 行頭・ファイル先頭
  const last = t[t.length - 1];
  if (REGEX_PRECEDERS.indexOf(last) >= 0) return true;
  return REGEX_KEYWORDS.test(t);
}

/** src[i] の `/` から始まる正規表現リテラルの終端（フラグの次）を返す。 */
function endOfRegex(src, i) {
  let j = i + 1;
  let inClass = false;
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") { j += 2; continue; }
    if (c === "\n") return j; // 正規表現は行を跨がない（判別を誤ったときの暴走止め）
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) { j++; break; }
    j++;
  }
  while (j < src.length && /[a-z]/.test(src[j])) j++; // フラグ
  return j;
}

/** src[i] の `'` / `"` から始まる文字列リテラルの終端（閉じ引用符の次）を返す。 */
function endOfQuoted(src, i) {
  const q = src[i];
  let j = i + 1;
  while (j < src.length) {
    if (src[j] === "\\") { j += 2; continue; }
    if (src[j] === q) return j + 1;
    if (src[j] === "\n") return j; // 未閉じの引用符で暴走させない
    j++;
  }
  return j;
}

/** src[i] の `` ` `` から始まるテンプレートリテラルを走査し、終端の次を返す。
    素の部分は文字列として（code 側は空白化して）、`${…}` の中身はコードとして出す。 */
function scanTemplate(src, i, emit) {
  emit("`", "`");
  let j = i + 1;
  let chunk = "";
  const flushChunk = () => { emit(chunk, blank(chunk)); chunk = ""; };
  while (j < src.length) {
    if (src[j] === "\\") { chunk += src.slice(j, j + 2); j += 2; continue; }
    if (src[j] === "`") { flushChunk(); emit("`", "`"); return j + 1; }
    if (src[j] === "$" && src[j + 1] === "{") {
      flushChunk();
      emit("${", "${");
      const end = endOfSubstitution(src, j + 2);
      const inner = split(src.slice(j + 2, end));
      // 置換式の中身はコードとして残す（`${MK.ui.x()}` に書いた違反を見逃さないため）。
      emit(inner.text, inner.code);
      if (src[end] === "}") { emit("}", "}"); j = end + 1; } else { j = end; }
      continue;
    }
    chunk += src[j]; j++;
  }
  flushChunk();
  return j;
}

/** `${` の直後 i から、対応する `}` の位置を返す（中の文字列・テンプレート・入れ子の波括弧を飛ばす）。 */
function endOfSubstitution(src, i) {
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === "}" && depth === 0) return j;
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === '"' || c === "'") { j = endOfQuoted(src, j); continue; }
    else if (c === "`") { j = scanTemplate(src, j, () => {}); continue; }
    j++;
  }
  return j;
}

const textOf = (src) => split(src).text;
const codeOf = (src) => split(src).code;

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

test("split(): 正規表現リテラルで後続のコードを飲まない（#312）", () => {
  // 観点: `/[",\r\n]/`（shared/io.js の CSV エスケープと同型）の引用符を文字列の開始と誤読すると、
  //       以降が丸ごと空白化されて全検出器が黙って素通りする。除算との判別も併せて固定する。
  // 入力: バッククォート／引用符を含む正規表現の後ろに違反コードを置いたソースと、除算のソース
  // 期待: 正規表現の中身は落ち、後続の違反は残る。除算は正規表現と誤認しない
  const code = codeOf('const q = /[`",]/;\nMK.ui.toast(1);\nlocalStorage.getItem(1);');
  const lines = code.split("\n");
  assert(lines[0].indexOf('"') < 0, "正規表現の中身は落ちる");
  assert(lines[1].indexOf("MK.ui") >= 0, "後続の MK.ui が残る");
  assert(lines[2].indexOf("localStorage") >= 0, "後続の localStorage が残る");
  const div = codeOf('const r = (a) / b / c;\nlocalStorage.getItem(1);');
  assert(div.split("\n")[1].indexOf("localStorage") >= 0, "除算を正規表現と誤認しない");
});

test("split(): テンプレートリテラルの ${…} はコードとして残る（#312）", () => {
  // 観点: 置換式に書いた違反（`${MK.ui.x()}`）を見逃さない。素の部分は文字列扱いのまま。
  // 入力: 素の部分と置換式の両方に検出対象の語を置いたテンプレート
  // 期待: code 側で置換式の MK.ui は残り、素の部分の localStorage は落ちる
  const code = codeOf("const h = `localStorage ${MK.ui.toast(1)}`;");
  assert(code.indexOf("MK.ui.toast") >= 0, "置換式はコードとして残る");
  assert(code.indexOf("localStorage") < 0, "素の部分は文字列として落ちる");
  // 入れ子（置換式の中のテンプレート・波括弧）で終端を見失わない
  const nested = codeOf("const h = `a${ f({ k: `b${ MK.ui.x() }` }) }z`;\nlocalStorage.getItem(1);");
  assert(nested.indexOf("MK.ui.x") >= 0, "入れ子の置換式も残る");
  assert(nested.split("\n")[1].indexOf("localStorage") >= 0, "入れ子の後もコードが続く");
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
  const color = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|\b(?:rgba?|hsla?)\s*\(\s*(?!var\()/;
  assert(fire(color, 'el.style.color = "#ff0000";', textOf), "16進カラーを検出");
  assert(fire(color, 'const c = "rgba(0,0,0,.3)";', textOf), "rgba の直書きを検出");
  assert(!fire(color, 'const c = "rgba(var(--color-primary-rgb), .3)";', textOf), "トークン経由の rgba は違反にしない");
  assert(!fire(color, 'const c = "var(--color-primary)";', textOf), "var 参照は違反にしない");
  const dlg = /(?<![.\w])(?:confirm|alert|prompt)\s*\(/;
  assert(fire(dlg, "confirm(1);"), "ネイティブ confirm を検出");
  assert(!fire(dlg, "MK.ui.confirm(1);"), "MK.ui.confirm は違反にしない");
  const ut = /(?<!Delete)\bundoToast\s*\(/;
  assert(fire(ut, "MK.ui.undoToast(m, fn);"), "undoToast 直呼びを検出");
  assert(!fire(ut, "MK.ui.undoDeleteToast(m, fn);"), "undoDeleteToast は違反にしない");
});

test("codeOf(): 走査対象が痩せていない（無効化の番人・#312）", () => {
  // 観点: split が何かの拍子にコードを空白へ潰すと、以下の検査が全部素通りで緑になる。
  //       絶対量（「200 文字以上残っている」）ではファイル末尾が丸ごと消えても通るので、比で見る。
  // 入力: 全モジュールの logic.js / view.js
  // 期待: code / text（＝コメントを除いたうちコードとして残る割合）が 60% 以上。
  //   分母を素のソースにするとコメントの厚いファイルが 44% まで落ちて閾値を張れない。
  //   一方、誤読は「そこから先を全部文字列として飲む」形で出る ── text は残るが code だけが
  //   消えるので、この比なら急落する（実測の下限は 80%＝ view.js 群）。
  const files = moduleFiles("logic").concat(moduleFiles("view"));
  assert(files.length >= 20, "走査対象が十分ある: " + files.length);
  files.forEach((f) => {
    const r = split(read(f.rel));
    const text = r.text.replace(/\s/g, "").length;
    const code = r.code.replace(/\s/g, "").length;
    assert(code / text >= 0.6,
      f.rel + " のコード残存率が低い（split の誤読を疑う）: " + Math.round((code / text) * 100) + "%");
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
  // 入力: 各 logic.js の MK.store.scope(...) / collection(...) の第1引数（コメントは textOf が落とす）
  // 期待: すべて "module:<id>" か "module:<id>:" 始まり（他モジュールの領域を書かない）。
  //   scoped モジュールは `"module:wbs:" + targetId` と組み立てるので、**先頭の文字列リテラル**で
  //   判定する（接頭辞さえ自分のものなら、後ろに何を継いでも他の領域へは出られない）。
  //   先頭がリテラルでない（丸ごと変数渡し）ものは黙って対象外にせず「検査不能」として落とす
  //   ── 静かな抜け道になるため、通したくなったらこの検査の側を直す。
  const bad = [];
  moduleFiles("logic").forEach((f) => {
    const text = textOf(read(f.rel));
    const re = /MK\.store\.(?:scope|collection)\(\s*([^,)]*)/g;
    let m;
    while ((m = re.exec(text))) {
      const arg = m[1].trim();
      const lit = /^(?:"([^"]*)"|'([^']*)'|`([^`$]*)`)/.exec(arg);
      if (!lit) { bad.push(f.rel + " → 第1引数の先頭がリテラルでなく検査できない: " + arg); continue; }
      const ns = lit[1] || lit[2] || lit[3] || "";
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
  //   `style.margin` の直代入だけでなく `cssText` / `setProperty("margin"…)` の迂回路も見る。
  const files = moduleFiles("logic").concat(moduleFiles("view"));
  const bad = scanText(files, /style\s*=\s*["'`][^"'`]*(?:margin|padding)|\.style\.(?:margin|padding)|cssText[^\n]*(?:margin|padding)|setProperty\(\s*["'`](?:margin|padding)/);
  eq(bad, [], "余白をインラインで直書きしている");
});

test("§2.1: 色をトークン経由で指定している（値の直書きが無い・#312）", () => {
  // 観点: 色は DESIGN トークン（CSS 変数）経由。直書きするとダークテーマに追従しない
  //       （§2.1 末尾「値の直書き禁止」の静的な半分。ダークで実際に見るのは TESTING.md §3.1）。
  // 入力: 全モジュールの logic.js / view.js（リテラルの中身を見るので textOf で走査）
  // 期待: 16進カラー（`#fff` 等）と rgb()/hsl() の直書きがゼロ。
  //   `rgba(var(--color-primary-rgb), .3)` のように**チャンネルをトークンから取る**書き方は
  //   トークン経由なので違反にしない（skills の評価セルが実際にこの形）。
  //   コメント中の Issue 番号（`#213` = 3桁16進に見える）は textOf が落とす。
  const files = moduleFiles("logic").concat(moduleFiles("view"));
  const bad = scanText(files, /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|\b(?:rgba?|hsla?)\s*\(\s*(?!var\()/);
  eq(bad, [], "色を直書きしている（var(--token) を使う）");
});

test("§2.3: ネイティブ confirm / alert / prompt を使っていない（#312）", () => {
  // 観点: 確認・通知は MK.ui へ寄せる（トークン描画・ダーク追従・Esc）。
  // 入力: 全モジュールの logic.js / view.js のコード部分
  // 期待: MK.ui 経由でない confirm( / alert( / prompt( がゼロ。
  //   `window.` / `globalThis.` / `self.` を前置した呼び方も同じネイティブ呼び出しなので違反にする
  //   （logic は window 検査で塞がるが view.js は素通りしていた）。
  const files = moduleFiles("logic").concat(moduleFiles("view"));
  const bad = scan(files, /(?:\b(?:window|globalThis|self)\.|(?<![.\w]))(?:confirm|alert|prompt)\s*\(/);
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
  // 期待: `test/<id>.test.js` が**完全一致で**存在する。
  //   接頭辞一致（`<id>-*.test.js` も可）は逃げ道が広すぎる ── 仮に id が `read` なら無関係な
  //   `read-summary.test.js` が満たしてしまう。全モジュールが実際に完全一致のファイルを
  //   持っているので、緩める理由が無い（`wbs-scope.test.js` のような追加ファイルは妨げにならない）。
  const files = fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.js"));
  const missing = ALL_MODULE_IDS.filter((id) => files.indexOf(id + ".test.js") < 0);
  eq(missing, [], "ロジックのテストが無いモジュール");
});

// ---- §6 動作: 構文 ----

test("追跡下の .js が構文エラーなく解析できる（node --check 相当・#312）", () => {
  // 観点: view.js はハーネスの既定ロード対象に入らないため、構文エラーが全テスト緑のまますり抜ける。
  // 入力: Git 追跡下の .js 全部（未追跡の下書きは対象外）
  // 期待: すべて new vm.Script() で解析できる。取得できない環境では素通りさせず落とす。
  //   既定の core.quotepath は非 ASCII のパスを `"..."` でクォートして返し、その行は直後の
  //   存在チェックで黙って落ちる（＝検査されないまま緑）。off ＋ NUL 区切りで生のパスを受ける。
  let list;
  try {
    list = cp.execSync('git -c core.quotepath=off ls-files -z "*.js"', { cwd: rootDir, encoding: "utf8" });
  } catch (e) {
    throw new Error("git ls-files が使えないため構文検査が成立しない（素通りで緑にしない）");
  }
  const names = list.split("\0").filter(Boolean);
  const files = names.filter((f) => fs.existsSync(path.join(rootDir, f)));
  eq(names.filter((f) => files.indexOf(f) < 0), [], "追跡下なのに作業ツリーに無い .js（未検査で緑にしない）");
  assert(files.length >= 30, "走査対象が極端に少ない（取得の破損を疑う）: " + files.length);
  const bad = [];
  files.forEach((rel) => {
    try { new vm.Script(read(rel), { filename: rel }); }
    catch (e) { bad.push(rel + " — " + (e && e.message ? e.message : e)); }
  });
  eq(bad, [], "構文エラーがある");
});
