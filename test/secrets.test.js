/* 秘密情報・ローカル固有値の混入ガード（Issue #305）。
   #303 で `.claude/agents/` を Git 追跡下に入れたことで、それまで「ローカル設定を置く場所」
   だった `.claude/` が公開対象になった。前提の変化はコミット履歴にしか残らないため、
   古い前提のまま書かれた値（API キー・ローカル絶対パス）を機械で止める。
   対象は `.claude/` に限らず Git 追跡下のテキスト全体 ── 追跡されていれば場所を問わず公開される。

   方針は「きつく始めて、証拠が出たら緩める」（TESTING.md §7.2）。見逃しは公開されたら
   不可逆、誤検出はテストが赤くなるだけで可逆という非対称から、厳しい側に倒す。ただし
   逃げ道の無い厳しさは「共通の正規表現を削る」圧力に変わるので、抑止マーカーとセットで持つ。

   パターンの性格は2種類ある。(1) 既知のキー（`ghp_` 等）は接頭辞＋十分な長さの本体を要求し、
   ドキュメントが接頭辞に言及しても落ちない。(2) 代入形・16進値・.env 形式は接頭辞を持たない
   ヒューリスティックで、正当な記述にも当たりうる ── そのための抑止マーカー。
   高エントロピー検出だけは入れない（実測で誤検出しか出なかったため。§7.2）。
   このファイル自身も走査対象なので、正規表現リテラル・テストデータは自己一致しない形で書く。 */
"use strict";
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const rootDir = path.join(__dirname, "..");

/* 抑止マーカー。この文字列を含む行は検査しない。
   見逃し（偽陰性）は公開されたら不可逆、誤検出（偽陽性）はテストが赤くなるだけで可逆 ──
   非対称なので厳しい側に倒す。ただし逃げ道が無い厳しさは「共通の正規表現を削る」圧力に
   変わり、検査ごと外される。そこで例外は**行単位で明示**する形にした。
   ダミー値の暗黙免除（`YOUR_KEY` 等を自動で見逃す）は置かない ── 緩める操作が
   差分に出ず、総数も数えられないため。例外は `git grep secrets-allow` で全部数えられる。 */
const ALLOW_MARKER = "secrets-allow";

/** 検出パターン。name は違反メッセージに出す名前（値そのものは絶対に出さない）。 */
const PATTERNS = [
  { name: "API キー（sk- 形式）", re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/ },
  { name: "GitHub トークン", re: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: "GitHub PAT", re: /\bgithub_pat_[A-Za-z0-9_]{20,}/ },
  { name: "AWS アクセスキー", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Slack トークン", re: /\bxox[baprs]-[0-9A-Za-z-]{10,}/ },
  { name: "Google API キー", re: /\bAIza[0-9A-Za-z_-]{35}/ },
  { name: "秘密鍵", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "JWT", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: "長い16進値", re: /\b[0-9a-f]{32,}\b/ },
  // .env 形式（`KEY=長い値`）。行全体がその形のときだけ見る。
  { name: "環境変数形式の値", re: /^[A-Z][A-Z0-9_]{2,}=[^\s"']{12,}$/ },
  // 代入形。語の言及（散文の「トークンを扱わない」等）を拾わないよう、8 文字以上の値が
  // 伴うことを条件にする。引用符の有無は問わない（JSON も .env もシェルも止めるため）。
  // 値の文字集合は ASCII に限る ── 全角を含めると `token: 認証に使う文字列` のような
  // **日本語の散文が丸ごと当たる**（日本語ドキュメント中心のリポジトリでは致命的）。
  // 値が識別子の連なり（`process.env.API_KEY` / `settings.apiKey`）なら**リテラルではない**ので
  // 対象外にする。これは「中身がダミーか」の推測ではなく「そもそも値が書かれていない」判定。
  {
    name: "代入形の秘密",
    re: /\b(?:password|passwd|api[_-]?key|apikey|secret|token)\s*[:=]\s*["'`]?([A-Za-z0-9_\-+/=.:~@#$%^&*!?]{8,})/i,
    exempt: (m) => /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/.test(m[1]),
  },
  // 区切りは `\` と `/` の両方を見る。MCP / エディタの JSON 設定や Node の出力は
  // Windows でもドライブレターの後がスラッシュ区切りになるため、`\` だけだと
  // 止めたい経路の中心が抜ける（この行に実例を書くと自分が引っかかるので書かない）。
  { name: "ローカル絶対パス（Windows）", re: /\b[A-Za-z]:[\\/]+Users[\\/]+[A-Za-z0-9._-]{2,}/ },
  // 前置は否定後読みで「相対パスの途中（foo/Users/bar）」だけを外す。許可リスト方式にすると
  // `cwd=/Users/…` や `path:/home/…`（設定ファイル・ツール出力の貼り付け＝止めたい形の中心）を
  // 落とし、`\b` 起点の Windows 側と非対称になる。
  { name: "ローカル絶対パス（Unix）", re: /(?<![A-Za-z0-9._~/-])\/(?:Users|home)\/[A-Za-z][A-Za-z0-9._-]+/ },
  // WSL / コンテナ経由。`/mnt/c/Users/…` は Windows 側（ドライブレター必須）からも
  // Unix 側（否定後読みの直前が `c`）からも漏れるので、専用に見る。
  { name: "ローカル絶対パス（WSL）", re: /\/mnt\/[a-z]\/Users\/[A-Za-z][A-Za-z0-9._-]+/ },
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

/* 走査は行内の全一致で回す。先頭の1件だけを見て対象外と判断すると、
   `token: process.env.X, key: "<本物>"` のような1行で本物ごと見逃す。
   PATTERNS 側は非グローバルのまま持ち（`test` と lastIndex を共用すると結果が飛ぶ）、
   ここで g 付きの複製を1度だけ作る。 */
const SCANNERS = PATTERNS.map((p) => ({ name: p.name, exempt: p.exempt, re: new RegExp(p.re.source, p.re.flags + "g") }));

/** text を行ごとに検査し、"path:line（パターン名）" の配列を返す。**値は決して含めない**。 */
function scanText(rel, text) {
  if (text.includes("\0")) return []; // 拡張子で漏れたバイナリ
  const hits = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.includes(ALLOW_MARKER)) return; // 明示的に許可された行
    SCANNERS.forEach((s) => {
      const matches = Array.from(line.matchAll(s.re));
      if (!matches.some((m) => !(s.exempt && s.exempt(m)))) return; // 全部が対象外なら見逃す
      hits.push(rel + ":" + (i + 1) + "（" + s.name + "）");
    });
  });
  return hits;
}

/** 追跡下の1ファイルを読んで検査する。読めないもの（作業ツリーに無い等）は対象外。 */
function scanFile(rel) {
  if (BINARY_EXT.has(path.extname(rel).toLowerCase())) return [];
  let text;
  try { text = fs.readFileSync(path.join(rootDir, rel), "utf8"); } catch { return []; }
  return scanText(rel, text);
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
    ["cwd=/home/" + "someone/x", "ローカル絶対パス（Unix）"],   // 設定・ツール出力の貼り付け
    ["path:/home/" + "someone/x", "ローカル絶対パス（Unix）"],
    ["[/home/" + "someone/x](x)", "ローカル絶対パス（Unix）"],  // Markdown リンク
    ["ey" + "J" + "hbGciOiJIUzI1NiJ9." + "eyJzdWIiOiIxIn0", "JWT"],
    ["hash = " + "a1b2c3d4".repeat(4), "長い16進値"],
    ["API" + "_TOKEN=" + "aB3xK9zQ71mn", "環境変数形式の値"],
    ["export " + "token=" + "aB3xK9zQ71mn", "代入形の秘密"], // 引用符が無くても止める
    ["/mnt/c/" + "Users/someone/x", "ローカル絶対パス（WSL）"], // WSL / コンテナ経由
  ];
  const missed = cases
    .filter(([sample, name]) => {
      const p = PATTERNS.find((x) => x.name === name);
      return !p || !p.re.test(sample);
    })
    .map(([, name]) => name);
  eq(missed, [], "担当パターンで検出できなかったもの");
});

test("散文の言及を誤検出しない（#305）", () => {
  // 観点: 通常の散文まで拾うと例外だらけになり、抑止マーカーが形骸化する。ここは通す。
  //       ダミー値の暗黙免除は持たないので、キー名と 8 文字以上の値が揃った記述例は
  //       中身がダミーでも**検出される**（通したい行には抑止マーカーを付ける。次のテスト）。
  // 入力: 接頭辞への言及・値を伴わない語・相対パス・プレースホルダ記法だけの行
  // 期待: いずれも検出しない
  const benign = [
    "既知のキー接頭辞（ghp_ / AKIA / AIza）を検出する",
    "token を扱わない。password は保存しない",
    'const label = "APIキー";',
    "foo/Users/bar/baz",                   // 相対パスの途中（絶対パスではない）
    "shared/ui.js と modules/todo/logic.js を参照",
    "C:\\Users\\<名前>\\... のようなローカル絶対パスは書かない",
    "詳細は /home ディレクトリ構成の節を参照",
    // 日本語の散文。値の文字集合を ASCII に限っているので当たらない
    "- token: 認証に使う文字列のこと。仕様は後述する",
    "| `secret` | 秘密の値を表す語。ここでは扱わない |",
    // 値が識別子の連なり＝リテラルが書かれていないコード
    'const token = localStorage.getItem("k");',
    "let apiKey = process.env.API_KEY;",
    "api_key: settings.apiKey",
  ];
  const wrong = benign.filter((s) => scanText("x.md", s).length > 0);
  eq(wrong.length, 0, "誤検出した行数");
});

test("抑止マーカーのある行は検査しない（#305）", () => {
  // 観点: 厳しさは逃げ道とセットでのみ成立する。逃げ道が無いと、赤くなった人が
  //       共通の正規表現を削る方向へ動き、検査ごと失われる。例外は行単位で明示する。
  // 入力: 本物の形を含む行（マーカー無し／マーカー付き）
  // 期待: マーカー付きの行だけ検出しない。マーカーは行のどこにあっても効く
  const real = "gh" + "p_" + "E".repeat(36);
  eq(scanText("a.md", "key: " + real).length, 1);
  eq(scanText("a.md", "key: " + real + "  // " + "secrets-allow" + ": 記述例"), []);
  eq(scanText("a.md", "<!-- " + "secrets-allow" + " --> key: " + real), []);
});

test("scanText(): 書式・行番号・値の非出力・NUL スキップ（#305）", () => {
  // 観点: 「違反メッセージに値そのものを含めない」は本検査の中心的な保証。
  //       パターンの自己テストだけでは、走査本体が値を足す変更に気づけない。
  // 入力: 2行目にだけ秘密（合成した GitHub トークン形式）を含むテキスト／NUL を含むテキスト
  // 期待: "a.md:2（GitHub トークン）" だけを返し、戻り値のどこにも秘密の断片が現れない。NUL 入りは []
  const secretValue = "gh" + "p_" + "D".repeat(36);
  const hits = scanText("a.md", "1行目は普通\n" + "key: " + secretValue + "\n3行目も普通");
  eq(hits, ["a.md:2（GitHub トークン）"]);
  assert(!hits.join("|").includes(secretValue.slice(4)), "戻り値に値の断片が含まれない");
  eq(scanText("b.bin", "key: " + secretValue + "\0"), []);

  // 観点（続き）: パターン直呼びの自己テストは走査経路を通らないため、走査を経た検出も固定する。
  // 入力: 実在形の値を持つ代入（値はここでも実行時に組み立てる）
  // 期待: 1件検出する
  const realish = "s3cr3t" + "value123";
  eq(scanText("x.js", "const cfg = { api_key: \"" + realish + "\" };"), ["x.js:1（代入形の秘密）"]);
  // 対象外（識別子の連なり）と本物が同居する行は、本物の側で検出する
  eq(scanText("x.js", "token: process.env.X, api_key: \"" + realish + "\""), ["x.js:1（代入形の秘密）"]);
});
