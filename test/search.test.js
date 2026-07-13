/* グローバル検索（コマンドパレット）のマッチング純関数テスト（Issue #82・MK.search）。
   と、各モジュールの任意契約 def.searchItems() が返すレコードの検査。 */
"use strict";

// ---- MK.search.score: 一致スコアリング ----
test("search.score: 完全一致 > 前方一致 > 部分一致 > 補助テキストのみ", (MK) => {
  // 観点: 一致の強さでスコアの序列が付く（良い候補ほど上位に来る土台）
  // 入力: label="todo" に対し "todo"(完全)/"to"(前方)/"od"(部分)、および sub のみ一致する "メモ"
  // 期待: exact > prefix > part > subOnly > 0（sub のみでも正のスコア）
  const exact = MK.search.score("todo", { label: "todo" });
  const prefix = MK.search.score("to", { label: "todo" });
  const part = MK.search.score("od", { label: "todo" });
  const subOnly = MK.search.score("メモ", { label: "todo", sub: "重要なメモ" });
  assert(exact > prefix, "exact > prefix");
  assert(prefix > part, "prefix > part");
  assert(part > subOnly, "part(label) > subのみ");
  assert(subOnly > 0, "subのみでも一致は正");
});

test("search.score: 空クエリは中立（0）", (MK) => {
  // 観点: 未入力（空白のみ含む）は絞り込みをしない中立状態として扱う
  // 入力: "" と "   "（空白のみ）
  // 期待: いずれもスコア 0（不一致 -1 でも一致 >0 でもない）
  eq(MK.search.score("", { label: "何か" }), 0);
  eq(MK.search.score("   ", { label: "何か" }), 0);
});

test("search.score: 不一致は -1", (MK) => {
  // 観点: どのフィールドにも含まれないクエリは除外対象（負スコア）
  // 入力: label/sub のどちらにも無い "zzz"
  // 期待: -1
  eq(MK.search.score("zzz", { label: "todo", sub: "やること" }), -1);
});

test("search.score: 複数トークンは AND（全て含む必要）", (MK) => {
  // 観点: 空白区切りの複数語は全て含むもののみ一致（絞り込みの積集合）
  // 入力: item に対し "ログイン バグ"（両方含む）と "ログイン 未実装"（片方欠く）
  // 期待: 前者は一致(>=0)、後者は不一致(-1)
  const item = { label: "ログイン画面のバグ", sub: "wbs タスク" };
  assert(MK.search.score("ログイン バグ", item) >= 0, "両方含めば一致");
  eq(MK.search.score("ログイン 未実装", item), -1, "片方欠ければ不一致");
});

test("search.score: 正規化（大小文字・全角半角・空白）を吸収する", (MK) => {
  // 観点: 表記ゆれ（大小文字・全角空白）を吸収して一致させる
  // 入力: label="ToDo　管理"（全角スペース）に対し小文字 "todo" と "todo 管理"
  // 期待: どちらも一致（>=0）
  const item = { label: "ToDo　管理" }; // 全角スペース
  assert(MK.search.score("todo", item) >= 0, "大小無視");
  assert(MK.search.score("todo 管理", item) >= 0, "全角空白を吸収");
});

test("search.score: keywords も探索対象になる", (MK) => {
  // 観点: label/sub 以外の keywords 配列もマッチ対象に含める
  // 入力: label="認証", keywords=["oauth","ログイン"] に対し "oauth"
  // 期待: 一致（>=0）
  const item = { label: "認証", keywords: ["oauth", "ログイン"] };
  assert(MK.search.score("oauth", item) >= 0, "keywords 一致");
});

// ---- MK.search.rank: 絞り込み＋並べ替え ----
test("search.rank: スコア降順で返し、不一致を除外する", (MK) => {
  // 観点: 候補配列を一致度で並べ、不一致は落とす（結果一覧の並び）
  // 入力: "その他タスク"(不一致)/"task 完全"(部分)/"task"(完全) の3件で "task" を検索
  // 期待: 2件だけ残り（不一致1件除外）、先頭は完全一致の "task"
  const items = [
    { label: "その他タスク" },
    { label: "task 完全" },   // 部分一致
    { label: "task" },         // 完全一致 → 先頭
  ];
  const r = MK.search.rank("task", items);
  eq(r.length, 2, "不一致1件を除外");
  eq(r[0].label, "task", "完全一致が先頭");
});

test("search.rank: 空クエリはソース順のまま先頭 limit 件", (MK) => {
  // 観点: 未入力時は並べ替えず元順の先頭 limit 件（初期表示の既定）
  // 入力: [a,b,c] を空クエリ・limit=2 で rank
  // 期待: ["a","b"]（元順のまま先頭2件）
  const items = [{ label: "a" }, { label: "b" }, { label: "c" }];
  eq(MK.search.rank("", items, 2).map((x) => x.label), ["a", "b"]);
});

test("search.rank: 同スコアは元の順序で安定", (MK) => {
  // 観点: 同点のときは元の順序を保つ安定ソート（並びがぶれない）
  // 入力: 同スコアになる "task-a","task-b" を "task" で rank
  // 期待: ["task-a","task-b"]（入力順のまま）
  const items = [{ label: "task-a" }, { label: "task-b" }];
  const r = MK.search.rank("task", items);
  eq(r.map((x) => x.label), ["task-a", "task-b"]);
});

test("search.rank: limit で件数を制限する", (MK) => {
  // 観点: 一致が多くても返す件数は limit で上限を切る
  // 入力: 全て一致する30件を limit=5 で rank
  // 期待: 返却は5件
  const items = [];
  for (let i = 0; i < 30; i++) items.push({ label: "task" + i });
  eq(MK.search.rank("task", items, 5).length, 5);
});

// ---- モジュールの任意契約 def.searchItems（logic 側） ----
test("todo.searchItems: 未完タスクのみを label/sub/keywords 付きで返す", (MK) => {
  // 観点: パレット候補は未完タスクだけ。メモ等を keywords に載せ検索対象にする
  // 入力: 「ログイン画面を直す」(notes="OAuth まわり") と「完了予定のもの」(done 化) の2件
  // 期待: label は文字列で持つ／done は除外／未完を含み、メモが keywords に載る
  MK.logic.todo.load();
  MK.logic.todo.addTask("ログイン画面を直す");
  const t = MK.logic.todo.tasks()[0];
  MK.logic.todo.updateTask(t.id, { notes: "OAuth まわり" });
  MK.logic.todo.addTask("完了予定のもの");
  MK.logic.todo.toggleDone(MK.logic.todo.tasks()[0].id, true); // 先頭（完了予定のもの）を done に
  const rows = MK.logic.todo.searchItems();
  assert(rows.every((r) => r.label && typeof r.label === "string"), "label を持つ");
  assert(!rows.some((r) => r.label === "完了予定のもの"), "done は除外");
  const login = rows.find((r) => r.label === "ログイン画面を直す");
  assert(login, "未完タスクを含む");
  assert(login.keywords.indexOf("OAuth まわり") >= 0, "メモを keywords に含む");
});

test("questions.searchItems: 未解決とナレッジを返し、答えなしの解決済みは除外", (MK) => {
  // 観点: 候補は「未解決」＋「答えのある解決済み（ナレッジ）」。答えなしの解決済みは再利用価値なしで除外
  // 入力: 答えなしで resolved の「Kafka…」／未解決の「gRPC…」／resolve で答えを付けた「HTTP 冪等性とは」
  // 期待: gRPC とナレッジを含み Kafka は除外。ナレッジは sub="ナレッジ"、答え本文が keywords に載る
  const Q = MK.logic.questions;
  Q.addItem("Kafka の再送設計"); // 答えなしで解決 → 再利用対象なし・除外
  const closed = Q.items()[0];
  Q.updateItem(closed.id, { status: "resolved" });
  Q.addItem("gRPC のタイムアウト"); // 未解決 → 含む
  Q.addItem("HTTP 冪等性とは"); // ナレッジ化 → 含む
  const know = Q.items().find((x) => x.title === "HTTP 冪等性とは");
  Q.resolve(know.id, "同じ操作を何度呼んでも結果が変わらない性質");
  const rows = Q.searchItems();
  assert(rows.some((r) => r.label === "gRPC のタイムアウト"), "未解決を含む");
  assert(rows.some((r) => r.label === "HTTP 冪等性とは"), "ナレッジを含む");
  assert(!rows.some((r) => r.label === "Kafka の再送設計"), "答えなしの解決済みは除外");
  const k = rows.find((r) => r.label === "HTTP 冪等性とは");
  eq(k.sub, "ナレッジ");
  assert(k.keywords.some((w) => w.includes("何度呼んでも")), "keywords に答え本文を含む");
});

test("goals.searchItems: 未達成の目標のみを label/sub/keywords 付きで返す", (MK) => {
  // 観点: 進行中の目標だけを候補にし、達成済み（全ステップ done）は除外。sub に進捗/期限、keywords に説明・現在ステップ
  // 入力: 説明・期限・ステップを付けた「英語を話せるようになる」と、唯一のステップを done にした「達成済み目標」
  // 期待: 未達成を含み達成済みは除外。説明と現在ステップ名が keywords に、期限が sub に載る
  const G = MK.logic.goals;
  G.addGoal("英語を話せるようになる");
  const g = G.goals()[0];
  G.updateGoal(g.id, { description: "TOEIC 800 目標", deadline: "2026-12-31" });
  G.addStep(g.id, "単語帳を1周");
  G.addGoal("達成済み目標");
  const done = G.goals().find((x) => x.title === "達成済み目標");
  G.addStep(done.id, "唯一のステップ");
  G.toggleStep(done.id, G.getGoal(done.id).steps[0].id, true); // 全ステップ done → 達成
  const rows = G.searchItems();
  assert(rows.some((r) => r.label === "英語を話せるようになる"), "未達成を含む");
  assert(!rows.some((r) => r.label === "達成済み目標"), "達成済みは除外");
  const r = rows.find((r) => r.label === "英語を話せるようになる");
  assert(r.keywords.indexOf("TOEIC 800 目標") >= 0, "説明を keywords に含む");
  assert(r.keywords.indexOf("単語帳を1周") >= 0, "現在ステップ名を keywords に含む");
  assert(/期限 2026-12-31/.test(r.sub), "sub に期限を含む");
});

test("releases.searchItems: 中止以外を返し、sub にプロダクト名・ステータス", (MK) => {
  // 観点: 予定・完了を候補にし、中止（cancelled）は除外。sub にプロダクト名＋ステータス、keywords に日付・メモ
  // 入力: 商品A に紐づく planned な "v1.0.0"(note="大型更新") と cancelled な "中止版"
  // 期待: v1.0.0 を含み中止版は除外。sub にプロダクト名、メモが keywords に載る
  const R = MK.logic.releases;
  const prod = MK.products.create({ name: "商品A" });
  R.addRelease({ productId: prod.id, version: "v1.0.0", plannedDate: "2026-08-01", status: "planned", note: "大型更新" });
  R.addRelease({ productId: prod.id, version: "中止版", status: "cancelled" });
  const rows = R.searchItems();
  assert(rows.some((r) => r.label === "v1.0.0"), "予定を含む");
  assert(!rows.some((r) => r.label === "中止版"), "中止は除外");
  const r = rows.find((r) => r.label === "v1.0.0");
  assert(/商品A/.test(r.sub), "sub にプロダクト名");
  assert(r.keywords.indexOf("大型更新") >= 0, "メモを keywords に含む");
});

test("techstack.searchItems: 全アイテムを name/sub/keywords 付きで返す", (MK) => {
  // 観点: 技術台帳は全アイテムを候補にする。sub に採用状況＋カテゴリ、keywords にバージョン・メモ・タグ
  // 入力: category=DB, version=16, ring=adopt, tags=[RDB] を付けた "PostgreSQL"
  // 期待: 候補に含まれ、sub にカテゴリ、バージョン・タグが keywords に載る
  const T = MK.logic.techstack;
  T.addItem("PostgreSQL");
  T.updateItem(T.items()[0].id, { category: "DB", version: "16", ring: "adopt", note: "主DB", tags: ["RDB"] });
  const rows = T.searchItems();
  const r = rows.find((x) => x.label === "PostgreSQL");
  assert(r, "アイテムを含む");
  assert(/DB/.test(r.sub), "sub にカテゴリ");
  assert(r.keywords.indexOf("16") >= 0 && r.keywords.indexOf("RDB") >= 0, "バージョン・タグを keywords に含む");
});

test("wbs.searchItems: 全PJ横断で未完の葉タスクを返し、親・完了は除外", (MK) => {
  // 観点: scoped な wbs を全 PJ 横断で走査し、集計行の親・完了タスクを除いた実作業を候補にする
  // 入力: 受注PJ に「親フェーズ(level0)」「画面設計(level1・佐藤・inprogress)」「完了作業(done)」
  // 期待: 画面設計のみ含み、親（集計行）と完了は除外。sub に PJ 名、担当者名が keywords に載る
  const W = MK.logic.wbs;
  const sato = MK.people.resolveOrCreate("佐藤");
  const a = MK.projects.create({ name: "受注PJ" });
  W.importData({ version: 1, uid: 10, tasks: [
    { id: 1, level: 0, name: "親フェーズ", status: "notstarted", deps: [] },
    { id: 2, level: 1, name: "画面設計", assigneeId: sato, status: "inprogress", note: "Figma", deps: [] },
    { id: 3, level: 1, name: "完了作業", status: "done", deps: [] },
  ] }, "replace", a.id);
  const rows = W.searchItems();
  assert(rows.some((r) => r.label === "画面設計"), "未完の葉を含む");
  assert(!rows.some((r) => r.label === "親フェーズ"), "親（集計行）は除外");
  assert(!rows.some((r) => r.label === "完了作業"), "完了は除外");
  const r = rows.find((r) => r.label === "画面設計");
  assert(/受注PJ/.test(r.sub), "sub に PJ 名");
  assert(r.keywords.indexOf("佐藤") >= 0, "担当者名を keywords に含む");
});
