/* 秘密情報・ローカル固有値の混入ガード（Issue #305）。
   #303 で `.claude/agents/` を Git 追跡下に入れたことで、それまで「ローカル設定を置く場所」
   だった `.claude/` が公開対象になった。前提の変化はコミット履歴にしか残らないため、
   古い前提のまま書かれた値（API キー・ローカル絶対パス）を機械で止める。
   対象は `.claude/` に限らず Git 追跡下のテキスト全体 ── 追跡されていれば場所を問わず公開される。

   検出は既知パターンの列挙に留め、高エントロピー検出は入れない。フルスイートは毎回走るので、
   偽陽性が出ると「とりあえず無視する」運用に堕ちて規約ごと形骸化する（取りこぼしより害が大きい）。
   各パターンは「接頭辞＋十分な長さの本体」を要求する。ドキュメントが `ghp_` のような接頭辞に
   言及しても落ちないようにするため（このファイル自身の正規表現リテラルも同じ理由で自己一致しない）。 */
"use strict";
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const rootDir = path.join(__dirname, "..");

/** 検出パターン。name は違反メッセージに出す名前（値そのものは絶対に出さない）。 */
const PATTERNS = [
  { name: "API キー（sk- 形式）", re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/ },
  { name: "GitHub トークン", re: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: "GitHub PAT", re: /\bgithub_pat_[A-Za-z0-9_]{20,}/ },
  { name: "AWS アクセスキー", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Slack トークン", re: /\bxox[baprs]-[0-9A-Za-z-]{10,}/ },
  { name: "Google API キー", re: /\bAIza[0-9A-Za-z_-]{35}/ },
  { name: "秘密鍵", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  // 代入形。語の言及（散文の「トークンを扱わない」等）を拾わないよう、
  // 引用符で囲まれた 8 文字以上の値が伴うことを条件にする。
  { name: "代入形の秘密", re: /\b(?:password|passwd|api[_-]?key|apikey|secret|token)\s*[:=]\s*["'`][^"'`\s]{8,}["'`]/i },
  // 区切りは `\` と `/` の両方を見る。MCP / エディタの JSON 設定や Node の出力は
  // Windows でもドライブレターの後がスラッシュ区切りになるため、`\` だけだと
  // 止めたい経路の中心が抜ける（この行に実例を書くと自分が引っかかるので書かない）。
  { name: "ローカル絶対パス（Windows）", re: /\b[A-Za-z]:[\\/]+Users[\\/]+[A-Za-z0-9._-]{2,}/ },
  { name: "ローカル絶対パス（Unix）", re: /(?:^|[\s"'`(])\/(?:Users|home)\/[A-Za-z][A-Za-z0-9._-]+/ },
];

/* 中身を読まない拡張子（バイナリ・画像・書庫）。テキストでも NUL を含めば読み飛ばす。 */
const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".pdf",
  ".zip", ".gz", ".woff", ".woff2", ".ttf", ".otf", ".eot", ".mp4", ".mp3",
]);

/** Git 追跡下のファイル（リポジトリ相対）。git が使えなければ null。 */
function trackedFiles() {
  try {
    const out = cp.execFileSync("git", ["ls-files", "-z"], {
      cwd: rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\0").filter((p) => p !== "");
  } catch {
    return null;
  }
}

/** rel のテキストを行ごとに検査し、"path:line（パターン名）" の配列を返す。値は含めない。 */
function scanFile(rel) {
  if (BINARY_EXT.has(path.extname(rel).toLowerCase())) return [];
  let text;
  try { text = fs.readFileSync(path.join(rootDir, rel), "utf8"); } catch { return []; }
  if (text.includes("\0")) return []; // 拡張子で漏れたバイナリ
  const hits = [];
  text.split(/\r?\n/).forEach((line, i) => {
    PATTERNS.forEach((p) => {
      if (p.re.test(line)) hits.push(rel + ":" + (i + 1) + "（" + p.name + "）");
    });
  });
  return hits;
}

test("Git 追跡下に秘密情報・ローカル固有値が混入していない（#305）", () => {
  // 観点: 追跡されたファイルは場所を問わず公開される。API キー・トークン・ローカル絶対パスを止める。
  // 入力: Git 追跡下の全ファイル（`git ls-files -z`）。バイナリ拡張子・NUL を含むものは読み飛ばす
  // 期待: 違反ゼロ。違反時は path:line とパターン名だけを出し、値そのものは出さない（ログへの二次流出を防ぐ）。
  const files = trackedFiles();
  // この検査は「追跡下＝公開される」が判定の本質なので、追跡状態を引けない環境では
  // 素通り（＝緑）にせず落とす。0 件で全部素通りする無効化パターンを塞ぐ。
  assert(files, "git ls-files が使える（追跡状態を判定できない環境では検査が成立しない）");
  assert(files.includes("CLAUDE.md"), "走査対象に既知のファイルが含まれる（" + files.length + "件）");
  const violations = [];
  files.forEach((rel) => { scanFile(rel).forEach((h) => violations.push(h)); });
  eq(violations, [], "秘密情報・ローカル固有値の混入");
});

test("検出パターンが実際の秘密の形を検出する（#305）", () => {
  // 観点: パターンが腐って「何も検出しない正規表現」になっていないことを固定する。
  //       検査対象に本物の形を残さないよう、サンプルは実行時に組み立てる（リテラルで書くと自分が引っかかる）。
  // 入力: サンプルと、それを捕まえるべきパターン名の組
  // 期待: 各サンプルが「担当のパターン」で検出される。どれか1つでも当たれば緑にしない
  //       ── 別のパターンが偶然拾うと、担当が壊れても気づけないため（#306 レビュー）
  const cases = [
    ["sk-ant-" + "a1b2c3d4e5f6g7h8i9j0k1", "API キー（sk- 形式）"],
    ["gh" + "p_" + "A".repeat(36), "GitHub トークン"],
    ["github" + "_pat_" + "B".repeat(30), "GitHub PAT"],
    ["AKIA" + "ABCDEFGHIJKLMNOP", "AWS アクセスキー"],
    ["xox" + "b-" + "123456789012-abcdef", "Slack トークン"],
    ["AIza" + "C".repeat(35), "Google API キー"],
    ["-----BEGIN RSA " + "PRIVATE KEY-----", "秘密鍵"],
    ['const cfg = { api' + '_key: "s3cr3tvalue123" };', "代入形の秘密"],
    ["C:" + "\\Users\\someone\\Desktop", "ローカル絶対パス（Windows）"],
    ["C:/" + "Users/someone/Desktop", "ローカル絶対パス（Windows）"], // スラッシュ区切りも止める
    ["  /home/" + "someone/work", "ローカル絶対パス（Unix）"],
    ["  /Users/" + "Someone/work", "ローカル絶対パス（Unix）"], // 大文字始まりのユーザ名
  ];
  const missed = cases
    .filter(([sample, name]) => {
      const p = PATTERNS.find((x) => x.name === name);
      return !p || !p.re.test(sample);
    })
    .map(([, name]) => name);
  eq(missed, [], "担当パターンで検出できなかったもの");
});

test("散文の言及・プレースホルダを誤検出しない（#305）", () => {
  // 観点: 偽陽性でフルスイートが赤くなると規約ごと形骸化するので、通常の記述が通ることを固定する。
  // 入力: 接頭辞への言及・値を伴わない語・プレースホルダ・リポジトリ相対パス
  // 期待: いずれも検出しない
  const benign = [
    "既知のキー接頭辞（ghp_ / AKIA / AIza）を検出する",
    "token を扱わない。password は保存しない",
    'const label = "APIキー";',
    "api_key: <YOUR_KEY_HERE>",
    "shared/ui.js と modules/todo/logic.js を参照",
    "C:\\Users\\<名前>\\... のようなローカル絶対パスは書かない",
    "詳細は /home ディレクトリ構成の節を参照",
  ];
  const wrong = benign.filter((s) => PATTERNS.some((p) => p.re.test(s)));
  eq(wrong.length, 0, "誤検出した行数");
});
