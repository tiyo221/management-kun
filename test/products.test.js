/* products マスタ（MK.products）— Product 次元の器（Issue #37）。people/projects と同格の横断マスタ。 */
"use strict";

test("products: create は planned 既定・counts 集計", (MK) => {
  // 観点: create で status 既定 planned・all/planned が増える、status 正規化
  // 入力: 3件作成（status 未指定／"active"／未知 "bogus"）
  // 期待: counts は all=3・planned=2（未指定と未知が planned に寄る）・active=1
  const P = MK.products;
  P.create({ name: "Aプロダクト" });
  P.create({ name: "Bプロダクト", status: "active" });
  P.create({ name: "Cプロダクト", status: "bogus" }); // 未知 → planned
  const c = P.counts();
  eq(c.all, 3);
  eq(c.planned, 2);
  eq(c.active, 1);
});

test("products: update は status 正規化・updatedAt 更新、remove", (MK) => {
  // 観点: update で status 変更・未知値は planned、remove で消える
  // 入力: 1件作成→update で status="sunset"→update で未知 "??"→remove
  // 期待: sunset に更新／未知は planned へ正規化／remove 後は get=null・all=0
  const P = MK.products;
  const a = P.create({ name: "旧レポート" });
  P.update(a.id, { status: "sunset" });
  eq(P.get(a.id).status, "sunset");
  P.update(a.id, { status: "??" });
  eq(P.get(a.id).status, "planned");
  P.remove(a.id);
  eq(P.get(a.id), null);
  eq(P.counts().all, 0);
});

test("products: resolve / resolveOrCreate（名寄せ）", (MK) => {
  // 観点: 完全一致で resolve、無ければ resolveOrCreate が新規作成
  // 入力: 「顧客ポータル」作成後、resolve / resolveOrCreate に既存名・未知名・空名を渡す
  // 期待: 既存名は既存 id、未知名は新規作成して実体を持つ、既存名の resolveOrCreate は既存 id、空名は null
  const P = MK.products;
  const a = P.create({ name: "顧客ポータル" });
  eq(P.resolve("顧客ポータル").id, a.id);
  eq(P.resolve("存在しない"), null);
  const id = P.resolveOrCreate("新規プロダクト");
  assert(id && P.get(id), "resolveOrCreate は id を返し実体が存在する");
  eq(P.resolveOrCreate("顧客ポータル"), a.id); // 既存に一致
  eq(P.resolveOrCreate("   "), null); // 空名は null
});

test("products: replaceAll は全置換", (MK) => {
  // 観点: replaceAll で既存を破棄して差し替え（バックアップ復元用）
  // 入力: 「既存」1件を作った後、replaceAll に別の1件を渡す
  // 期待: 既存は破棄され all=1、残るのは差し替えた「置換のみ」
  const P = MK.products;
  P.create({ name: "既存" });
  P.replaceAll([{ id: "prod_x", name: "置換のみ", status: "active", tags: [] }]);
  eq(P.counts().all, 1);
  eq(P.all()[0].name, "置換のみ");
});

test("products: CSV 出力・取込（ラベル/キー・タグ分割・関連プロジェクト・全置換）", (MK) => {
  // 観点: buildCSVRows のヘッダ、applyCSV が全置換・ラベル/キー両対応・タグ空白区切り・関連プロジェクトの名前解決
  // 入力: 3行（顧客ポータル=責任者/タグ/関連PJ あり／旧レポート=ラベル「終息」・責任者空／プロダクト名空）
  // 期待: 取込2件（名前空はスキップ）。タグは空白分割で配列化、責任者/関連PJ は People/Projects へ resolveOrCreate、
  //       「終息」→sunset、責任者空は ownerId=null、出力ヘッダ既定順・責任者列は People 名で往復
  const P = MK.products;
  const rows = [
    ["プロダクト名", "ステータス", "責任者", "概要", "リポジトリ", "タグ", "関連プロジェクト"],
    ["顧客ポータル", "active", "佐藤", "契約者向け", "repo/x", "web ui", "基幹刷新"],
    ["旧レポート", "終息", "", "移行中", "", "legacy", ""],
    ["", "active", "", "空行", "", "", ""], // プロダクト名なしはスキップ
  ];
  const n = P.applyCSV(rows);
  eq(n, 2);
  eq(P.counts().all, 2);
  const portal = P.all().find((x) => x.name === "顧客ポータル");
  eq(portal.status, "active");
  eq(portal.tags, ["web", "ui"]);
  assert(portal.projectIds.length === 1 && MK.projects.get(portal.projectIds[0]).name === "基幹刷新", "関連プロジェクト名が resolveOrCreate で解決される");
  assert(portal.ownerId && MK.people.get(portal.ownerId).name === "佐藤", "責任者名が People へ resolveOrCreate で解決される（Issue #56）");
  const old = P.all().find((x) => x.name === "旧レポート");
  eq(old.status, "sunset"); // 日本語ラベル「終息」→ sunset
  eq(old.projectIds, []);
  eq(old.ownerId, null); // 責任者が空の行は ownerId も null
  eq(P.buildCSVRows()[0], ["プロダクト名", "ステータス", "責任者", "概要", "リポジトリ", "タグ", "関連プロジェクト"]);
  const portalRow = P.buildCSVRows().find((r) => r[0] === "顧客ポータル");
  eq(portalRow[2], "佐藤"); // 出力も People 名で往復する
});

test("products: ownerId は People 参照・削除後は ownerPerson で無視される（Issue #56）", (MK) => {
  // 観点: create/update で ownerId 正規化、People 削除後も ownerPerson が破綻しない
  // 入力: People「田中」を owner に持つ製品を作成→People を削除→update で ownerId=""
  // 期待: 生存中は ownerPerson が「田中」、People 削除後は null（破綻せず無視）、空文字は ownerId=null に正規化
  const P = MK.products;
  const owner = MK.people.create({ name: "田中" });
  const a = P.create({ name: "検索基盤", ownerId: owner.id });
  eq(P.ownerPerson(a).name, "田中");

  MK.people.remove(owner.id);
  eq(P.ownerPerson(P.get(a.id)), null); // 削除済み参照は無視され破綻しない

  P.update(a.id, { ownerId: "" });
  eq(P.get(a.id).ownerId, null); // 空文字は null に正規化
});

test("products: migrateOwnerToPeople は旧・自由文字列 owner を People へ名寄せ移行する（Issue #56）", (MK) => {
  // 観点: owner あり・ownerId 未設定のみ対象、同名は People に集約、冪等
  // 入力: People「鈴木」がいる状態で、owner="鈴木"(ownerId 無)と owner=""(対象外)の2製品を用意し migrate 実行
  // 期待: 移行1件で「鈴木」製品の ownerId が既存 People id に集約、owner 空の製品は null のまま、再実行は 0（冪等）
  const P = MK.products;
  const existing = MK.people.create({ name: "鈴木" });
  const a = P.create({ name: "旧仕様プロダクト" });
  P.replaceAll([Object.assign({}, a, { owner: "鈴木" }), { id: "prod_y", name: "無名責任者プロダクト", owner: "", ownerId: null, tags: [] }]);

  const moved = P.migrateOwnerToPeople();
  eq(moved, 1);
  eq(P.all().find((x) => x.name === "旧仕様プロダクト").ownerId, existing.id); // 同名 People に集約
  eq(P.all().find((x) => x.name === "無名責任者プロダクト").ownerId, null); // owner が空なら対象外

  eq(P.migrateOwnerToPeople(), 0); // 再実行しても増えない（冪等）
});

test("products: projectIds の正規化・存在しない Project 参照は relatedProjects で無視される（Issue #55）", (MK) => {
  // 観点: create/update で projectIds を正規化（配列化・重複除去）、Project 削除後も relatedProjects が破綻しない
  // 入力: projectIds=[proj, proj, "  "] で作成→Project 削除→update で projectIds="not-an-array"
  // 期待: 作成時に重複・空除去で [proj] のみ、Project 削除後は relatedProjects=[]（破綻せず）、配列以外は [] に正規化
  const P = MK.products;
  const proj = MK.projects.create({ name: "刷新PJ" });
  const a = P.create({ name: "検索基盤", projectIds: [proj.id, proj.id, "  "] });
  eq(a.projectIds, [proj.id]); // 重複・空文字は除去
  eq(P.relatedProjects(a).map((x) => x.id), [proj.id]);

  MK.projects.remove(proj.id);
  eq(P.relatedProjects(P.get(a.id)), []); // 削除済み参照は無視され破綻しない

  P.update(a.id, { projectIds: "not-an-array" });
  eq(P.get(a.id).projectIds, []); // 配列以外は空配列に正規化
});

test("products: エンベロープに products が入り、置換取込で復元される", (MK) => {
  // 観点: buildEnvelope("all") に products が含まれ、importEnvelope(replace) で戻る
  // 入力: 製品1件を作り envelope を作成→replaceAll([]) で消去→その envelope を replace 取込
  // 期待: envelope.products に1件含まれ、取込後に all=1・名前「バックアップ対象」が復元
  const P = MK.products;
  P.create({ name: "バックアップ対象", status: "active" });
  const env = MK.io.buildEnvelope("all");
  assert(Array.isArray(env.products) && env.products.length === 1, "envelope.products に1件");
  P.replaceAll([]);
  eq(P.counts().all, 0);
  MK.io.importEnvelope(env, "replace");
  eq(P.counts().all, 1);
  eq(P.all()[0].name, "バックアップ対象");
});
