/* products マスタ（MK.products）— Product 次元の器（Issue #37）。people/projects と同格の横断マスタ。 */
"use strict";

test("products: create は planned 既定・counts 集計", (MK) => {
  // 観点: create で status 既定 planned・all/planned が増える、status 正規化
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
  const P = MK.products;
  P.create({ name: "既存" });
  P.replaceAll([{ id: "prod_x", name: "置換のみ", status: "active", tags: [] }]);
  eq(P.counts().all, 1);
  eq(P.all()[0].name, "置換のみ");
});

test("products: CSV 出力・取込（ラベル/キー・タグ分割・関連プロジェクト・全置換）", (MK) => {
  // 観点: buildCSVRows のヘッダ、applyCSV が全置換・ラベル/キー両対応・タグ空白区切り・関連プロジェクトの名前解決
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
  const old = P.all().find((x) => x.name === "旧レポート");
  eq(old.status, "sunset"); // 日本語ラベル「終息」→ sunset
  eq(old.projectIds, []);
  eq(P.buildCSVRows()[0], ["プロダクト名", "ステータス", "責任者", "概要", "リポジトリ", "タグ", "関連プロジェクト"]);
});

test("products: projectIds の正規化・存在しない Project 参照は relatedProjects で無視される（Issue #55）", (MK) => {
  // 観点: create/update で projectIds を正規化（配列化・重複除去）、Project 削除後も relatedProjects が破綻しない
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
