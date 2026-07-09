/* グローバル検索（コマンドパレット）のマッチング純関数テスト（Issue #82・MK.search）。
   と、各モジュールの任意契約 def.searchItems() が返すレコードの検査。 */
"use strict";

// ---- MK.search.score: 一致スコアリング ----
test("search.score: 完全一致 > 前方一致 > 部分一致 > 補助テキストのみ", (MK) => {
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
  eq(MK.search.score("", { label: "何か" }), 0);
  eq(MK.search.score("   ", { label: "何か" }), 0);
});

test("search.score: 不一致は -1", (MK) => {
  eq(MK.search.score("zzz", { label: "todo", sub: "やること" }), -1);
});

test("search.score: 複数トークンは AND（全て含む必要）", (MK) => {
  const item = { label: "ログイン画面のバグ", sub: "wbs タスク" };
  assert(MK.search.score("ログイン バグ", item) >= 0, "両方含めば一致");
  eq(MK.search.score("ログイン 未実装", item), -1, "片方欠ければ不一致");
});

test("search.score: 正規化（大小文字・全角半角・空白）を吸収する", (MK) => {
  const item = { label: "ToDo　管理" }; // 全角スペース
  assert(MK.search.score("todo", item) >= 0, "大小無視");
  assert(MK.search.score("todo 管理", item) >= 0, "全角空白を吸収");
});

test("search.score: keywords も探索対象になる", (MK) => {
  const item = { label: "認証", keywords: ["oauth", "ログイン"] };
  assert(MK.search.score("oauth", item) >= 0, "keywords 一致");
});

// ---- MK.search.rank: 絞り込み＋並べ替え ----
test("search.rank: スコア降順で返し、不一致を除外する", (MK) => {
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
  const items = [{ label: "a" }, { label: "b" }, { label: "c" }];
  eq(MK.search.rank("", items, 2).map((x) => x.label), ["a", "b"]);
});

test("search.rank: 同スコアは元の順序で安定", (MK) => {
  const items = [{ label: "task-a" }, { label: "task-b" }];
  const r = MK.search.rank("task", items);
  eq(r.map((x) => x.label), ["task-a", "task-b"]);
});

test("search.rank: limit で件数を制限する", (MK) => {
  const items = [];
  for (let i = 0; i < 30; i++) items.push({ label: "task" + i });
  eq(MK.search.rank("task", items, 5).length, 5);
});

// ---- モジュールの任意契約 def.searchItems（logic 側） ----
test("todo.searchItems: 未完タスクのみを label/sub/keywords 付きで返す", (MK) => {
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
