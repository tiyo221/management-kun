/* テスト一覧ツール — 依存ゼロ（Node 標準のみ）。`node test/list.js` で実行。
   test/*.test.js を走査し、各 test の「観点 / 入力 / 期待」コメント（TESTING.md §5 の規約）を
   抜き出して一覧にする。テストを実行せずに「何を・どんな入力で・どうなるべきか」を俯瞰するための道具。

   使い方:
     node test/list.js            全テストを ファイル別に「観点/入力/期待」付きで表示
     node test/list.js --missing  3項目（観点/入力/期待）が欠けているテストだけを表示（品質点検用）
     node test/list.js --md       Markdown で出力（> test/COVERAGE.md にリダイレクトできる）
     node test/list.js --html     検索・絞り込みできる自己完結 HTML を test/coverage.html に生成（file:// で開ける）
     node test/list.js <keyword>  テスト名・コメントに <keyword> を含むものだけに絞り込む
   複数指定可: 例) node test/list.js --md wbs / node test/list.js --html resource */
"use strict";
const fs = require("fs");
const path = require("path");

const LABELS = ["観点", "入力", "期待"];
// 「観点:」「入力：」など、全角/半角コロンの両方を許す
const LABEL_RE = new RegExp("^(" + LABELS.join("|") + ")[:：]\\s*(.*)$");

/* 1ファイルをパースして [{name, 観点, 入力, 期待, line}] を返す */
function parseFile(src) {
  const lines = src.split(/\r?\n/);
  const tests = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*test\(\s*["'`](.+?)["'`]\s*,/);
    if (!m) continue;
    const entry = { name: m[1], line: i + 1, 観点: "", 入力: "", 期待: "" };
    let current = null; // 直前のラベル（複数行コメントの継続を拾う）
    // test( の直後に続く // コメント行だけを見る（本体コードに入ったら打ち切る）
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (t.startsWith("//")) {
        const body = t.replace(/^\/\/\s?/, "");
        const lm = body.match(LABEL_RE);
        if (lm) {
          current = lm[1];
          entry[current] = lm[2].trim();
        } else if (current) {
          // ラベルなしコメントは直前ラベルの継続行として連結
          entry[current] = (entry[current] + " " + body).trim();
        }
        continue;
      }
      if (t === "") continue; // コメント間の空行は許容
      break; // コード行に到達 → コメントブロック終了
    }
    tests.push(entry);
  }
  return tests;
}

function collectFiles() {
  const dir = __dirname;
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".test.js"))
    .sort()
    .map((f) => ({ file: f, tests: parseFile(fs.readFileSync(path.join(dir, f), "utf8")) }));
}

function missingLabels(t) {
  return LABELS.filter((k) => !t[k]);
}

/* --- 出力 --- */
function printHuman(groups, opts) {
  let total = 0, withAll = 0, missing = 0;
  for (const g of groups) {
    const shown = g.tests.filter(opts.keep);
    if (shown.length === 0) continue;
    console.log("\n### " + g.file + "  (" + shown.length + (shown.length === g.tests.length ? "" : "/" + g.tests.length) + " tests)");
    for (const t of shown) {
      total++;
      const miss = missingLabels(t);
      if (miss.length === 0) withAll++; else missing++;
      const flag = miss.length ? "  ⚠ 欠落: " + miss.join("/") : "";
      console.log("\n- " + t.name + "  (:" + t.line + ")" + flag);
      for (const k of LABELS) {
        if (t[k]) console.log("    " + k + ": " + t[k]);
      }
    }
  }
  console.log("\n=== 表示 " + total + " tests（3項目そろい " + withAll + " / 欠落あり " + missing + "） ===");
}

function printMarkdown(groups, opts) {
  const out = [];
  out.push("# テストカバレッジ一覧（自動生成）");
  out.push("");
  out.push("> `node test/list.js --md > test/COVERAGE.md` で再生成する。手で編集しない。");
  out.push("> 各テストの「観点 / 入力 / 期待」は各 `test/*.test.js` の規約コメント（TESTING.md §5）から抽出。");
  out.push("");
  let total = 0, missing = 0;
  for (const g of groups) {
    const shown = g.tests.filter(opts.keep);
    if (shown.length === 0) continue;
    out.push("## " + g.file + " (" + shown.length + ")");
    out.push("");
    for (const t of shown) {
      total++;
      const miss = missingLabels(t);
      if (miss.length) missing++;
      out.push("### " + t.name + (miss.length ? " ⚠️（欠落: " + miss.join("/") + "）" : ""));
      out.push("");
      for (const k of LABELS) {
        out.push("- **" + k + "**: " + (t[k] || "_（未記載）_"));
      }
      out.push("");
    }
  }
  out.push("---");
  out.push("");
  out.push("合計 " + total + " テスト / 3項目欠落あり " + missing + " テスト");
  console.log(out.join("\n"));
}

/* 自己完結 HTML を組み立てて返す（依存ゼロ・file:// で開ける・XSS はクライアント側 textContent で防止）。
   全テストを JSON で埋め込み、検索/ファイル絞り込み/「欠落のみ」はページ内で行う。 */
function buildHtml(groups, seed) {
  const data = groups.map((g) => ({
    file: g.file,
    tests: g.tests.map((t) => ({ name: t.name, line: t.line, 観点: t.観点, 入力: t.入力, 期待: t.期待, miss: missingLabels(t) })),
  }));
  const json = JSON.stringify(data).replace(/</g, "\\u003c"); // </script> 混入を防ぐ
  const seedJson = JSON.stringify(seed || { q: "", missing: false }).replace(/</g, "\\u003c");
  return [
    "<!doctype html>",
    '<html lang="ja"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>テストカバレッジ一覧</title>",
    "<style>" + HTML_CSS + "</style>",
    "</head><body>",
    '<header><h1>テストカバレッジ一覧</h1>',
    '<div id="stats"></div>',
    '<div class="controls">',
    '<input id="q" type="search" placeholder="テスト名・観点・入力・期待で検索…">',
    '<select id="file"></select>',
    '<label class="chk"><input id="missing" type="checkbox"> 欠落のみ</label>',
    "</div></header>",
    '<main id="list"></main>',
    "<script>var DATA=" + json + ";var SEED=" + seedJson + ";</script>",
    "<script>" + HTML_JS + "</script>",
    "</body></html>",
  ].join("\n");
}

const HTML_CSS = "\
:root{--bg:#fff;--fg:#37352f;--muted:#787066;--line:#e9e9e7;--card:#fbfbfa;--warn:#d9730d;--warnbg:#fdf0e6;--accent:#2383e2}\
@media(prefers-color-scheme:dark){:root{--bg:#191919;--fg:#e9e9e7;--muted:#9b9b9b;--line:#2f2f2f;--card:#202020;--warn:#ffa344;--warnbg:#3a2a12;--accent:#529cca}}\
*{box-sizing:border-box}body{margin:0;font:14px/1.6 -apple-system,'Segoe UI',Meiryo,sans-serif;color:var(--fg);background:var(--bg)}\
header{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);padding:14px 20px;z-index:2}\
h1{margin:0 0 8px;font-size:18px}\
#stats{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}\
.chip{font-size:12px;padding:3px 10px;border-radius:20px;background:var(--card);border:1px solid var(--line)}\
.chip b{font-weight:600}.chip.warn{color:var(--warn);background:var(--warnbg);border-color:transparent}\
.controls{display:flex;gap:10px;flex-wrap:wrap;align-items:center}\
#q{flex:1;min-width:200px;padding:7px 12px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg);font-size:14px}\
#file{padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg)}\
.chk{font-size:13px;color:var(--muted);display:flex;align-items:center;gap:5px;cursor:pointer}\
main{padding:8px 20px 60px;max-width:960px}\
.file{margin-top:22px}.file h2{font-size:13px;color:var(--muted);font-weight:600;border-bottom:1px solid var(--line);padding-bottom:6px;margin:0 0 10px;position:sticky;top:96px;background:var(--bg)}\
.file .count{font-weight:400;opacity:.7}\
.t{padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--card);margin-bottom:8px}\
.t.miss{border-color:var(--warn)}\
.t .name{font-weight:600;font-size:13px}.t .ln{color:var(--muted);font-weight:400;font-size:11px;margin-left:6px}\
.badge{display:inline-block;font-size:11px;color:var(--warn);background:var(--warnbg);border-radius:4px;padding:0 6px;margin-left:6px}\
.row{display:flex;gap:8px;margin-top:5px;font-size:13px}\
.row .k{color:var(--muted);flex:0 0 2.4em}.row .v{flex:1}.row .v.none{color:var(--warn);opacity:.8}\
.empty{color:var(--muted);padding:40px 0;text-align:center}\
mark{background:var(--accent);color:#fff;border-radius:2px;padding:0 1px}";

const HTML_JS = "\
(function(){\
var LABELS=['観点','入力','期待'];\
var qEl=document.getElementById('q'),fileEl=document.getElementById('file'),missEl=document.getElementById('missing');\
var listEl=document.getElementById('list'),statsEl=document.getElementById('stats');\
var totT=0,totMiss=0;\
DATA.forEach(function(g){g.tests.forEach(function(t){totT++;if(t.miss.length)totMiss++;});});\
var opt=document.createElement('option');opt.value='';opt.textContent='全ファイル ('+DATA.length+')';fileEl.appendChild(opt);\
DATA.forEach(function(g){var o=document.createElement('option');o.value=g.file;o.textContent=g.file+' ('+g.tests.length+')';fileEl.appendChild(o);});\
function norm(s){return (s||'').toLowerCase();}\
function chip(cls,label,n){var d=document.createElement('span');d.className='chip'+(cls?' '+cls:'');var b=document.createElement('b');b.textContent=n;d.appendChild(b);d.appendChild(document.createTextNode(' '+label));return d;}\
function hi(el,text,q){el.textContent='';if(!q){el.textContent=text;return;}var lo=text.toLowerCase(),i=0,idx;while((idx=lo.indexOf(q,i))>=0){el.appendChild(document.createTextNode(text.slice(i,idx)));var m=document.createElement('mark');m.textContent=text.slice(idx,idx+q.length);el.appendChild(m);i=idx+q.length;}el.appendChild(document.createTextNode(text.slice(i)));}\
function render(){\
var q=norm(qEl.value.trim()),onlyMiss=missEl.checked,file=fileEl.value;\
listEl.textContent='';var shown=0,shownMiss=0;\
DATA.forEach(function(g){\
if(file&&g.file!==file)return;\
var tests=g.tests.filter(function(t){\
if(onlyMiss&&!t.miss.length)return false;\
if(q){var hay=norm(t.name+' '+t.観点+' '+t.入力+' '+t.期待);if(hay.indexOf(q)<0)return false;}\
return true;});\
if(!tests.length)return;\
var sec=document.createElement('section');sec.className='file';\
var h=document.createElement('h2');h.textContent=g.file;var c=document.createElement('span');c.className='count';c.textContent=' ('+tests.length+')';h.appendChild(c);sec.appendChild(h);\
tests.forEach(function(t){shown++;if(t.miss.length)shownMiss++;\
var card=document.createElement('div');card.className='t'+(t.miss.length?' miss':'');\
var nm=document.createElement('div');nm.className='name';var ns=document.createElement('span');hi(ns,t.name,q);nm.appendChild(ns);\
var ln=document.createElement('span');ln.className='ln';ln.textContent=':'+t.line;nm.appendChild(ln);\
if(t.miss.length){var bd=document.createElement('span');bd.className='badge';bd.textContent='欠落 '+t.miss.join('/');nm.appendChild(bd);}\
card.appendChild(nm);\
LABELS.forEach(function(k){var r=document.createElement('div');r.className='row';var kk=document.createElement('span');kk.className='k';kk.textContent=k;var vv=document.createElement('span');vv.className='v'+(t[k]?'':' none');if(t[k])hi(vv,t[k],q);else vv.textContent='（未記載）';r.appendChild(kk);r.appendChild(vv);card.appendChild(r);});\
sec.appendChild(card);});\
listEl.appendChild(sec);});\
if(!shown){var e=document.createElement('div');e.className='empty';e.textContent='該当するテストがありません';listEl.appendChild(e);}\
statsEl.textContent='';statsEl.appendChild(chip('','表示',shown+' / '+totT));statsEl.appendChild(chip('','3項目そろい',totT-totMiss));statsEl.appendChild(chip(totMiss?'warn':'','欠落あり',totMiss));\
}\
qEl.addEventListener('input',render);fileEl.addEventListener('change',render);missEl.addEventListener('change',render);\
qEl.value=SEED.q||'';missEl.checked=!!SEED.missing;render();\
})();";

/* --- エントリ --- */
const args = process.argv.slice(2);
const asMd = args.includes("--md");
const asHtml = args.includes("--html");
const onlyMissing = args.includes("--missing");
const keywords = args.filter((a) => !a.startsWith("--"));

const keep = (t) => {
  if (onlyMissing && missingLabels(t).length === 0) return false;
  if (keywords.length) {
    const hay = (t.name + " " + t.観点 + " " + t.入力 + " " + t.期待).toLowerCase();
    if (!keywords.every((k) => hay.includes(k.toLowerCase()))) return false;
  }
  return true;
};

const groups = collectFiles();
if (asHtml) {
  // 検索/欠落フィルタはページ内で行うため、HTML は全テストを埋め込む（keyword/--missing は初期状態として渡す）
  const outPath = path.join(__dirname, "coverage.html");
  fs.writeFileSync(outPath, buildHtml(groups, { q: keywords.join(" "), missing: onlyMissing }), "utf8");
  console.log("生成: " + outPath);
  console.log("ブラウザで開く（file:// で動作・依存ゼロ）。再生成は `node test/list.js --html`。");
} else if (asMd) printMarkdown(groups, { keep });
else printHuman(groups, { keep });
