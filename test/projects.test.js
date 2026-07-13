/* projects マスタ（MK.projects）— CSV 取込／出力（Issue #58）。 */
"use strict";

test("projects: CSV 出力・取込（往復・名空スキップ・状態正規化）", (MK) => {
  // 観点: buildCSVRows のヘッダ、applyCSV が全置換・名空はスキップ・状態のキー/ラベル両対応
  // 入力: 5行（active／archived／"アーカイブ"(ラベル)／"bogus"(未知)／名前空）を applyCSV
  // 期待: 取込 4件（名前空はスキップ）、ラベルは archived に、未知は active に正規化、ヘッダは既定列順
  const P = MK.projects;
  const rows = [
    ["プロジェクト名", "表示色", "状態", "備考"],
    ["新規開発", "#123456", "active", "進行中"],
    ["旧案件", "", "archived", "終了"],
    ["ラベル指定", "", "アーカイブ", ""], // 日本語ラベル → archived
    ["不明状態", "", "bogus", ""], // 未知 → active
    ["", "", "active", "空行"], // 名前なしはスキップ
  ];
  const n = P.applyCSV(rows);
  eq(n, 4);
  eq(P.all().length, 4);
  eq(P.all().find((p) => p.name === "新規開発").status, "active");
  eq(P.all().find((p) => p.name === "旧案件").status, "archived");
  eq(P.all().find((p) => p.name === "ラベル指定").status, "archived");
  eq(P.all().find((p) => p.name === "不明状態").status, "active");
  eq(P.buildCSVRows()[0], ["プロジェクト名", "表示色", "状態", "備考"]);
});

test("projects: CSV round-trip（出力→取込でフィールドが保たれる）", (MK) => {
  // 観点: buildCSVRows → applyCSV で主要フィールドが往復する
  // 自明: 出力した行をそのまま取り込み、color/status/note が保たれるだけの素朴なラウンドトリップ
  const P = MK.projects;
  P.create({ name: "往復PJ", color: "#abcdef", status: "archived", note: "メモ" });
  const rows = P.buildCSVRows();
  P.applyCSV(rows);
  const p = P.all().find((x) => x.name === "往復PJ");
  eq(p.color, "#abcdef");
  eq(p.status, "archived");
  eq(p.note, "メモ");
});
