/* releases ロジック */
"use strict";

test("releases: 追加は productId とバージョンが必須", (MK) => {
  // 観点: 必須不足（productId なし / version なし）は null で保存されず、揃えば planned 既定で追加される
  // 入力: プロダクト1件を用意し、不足パターン2つ＋正常1つを addRelease
  const R = MK.logic.releases;
  const p = MK.products.create({ name: "顧客ポータル" });
  eq(R.addRelease({ version: "v1.0.0" }), null);
  eq(R.addRelease({ productId: p.id, version: "   " }), null);
  eq(R.counts().all, 0);
  const r = R.addRelease({ productId: p.id, version: "v1.0.0" });
  eq(r.status, "planned"); // 既定ステータス
  eq(R.counts().all, 1);
  eq(R.counts().planned, 1);
});

test("releases: status の遷移と正規化", (MK) => {
  // 観点: updateRelease で status を変更でき、未知値は planned に寄る
  const R = MK.logic.releases;
  const p = MK.products.create({ name: "P" });
  const r = R.addRelease({ productId: p.id, version: "v1" });
  R.updateRelease(r.id, { status: "done" });
  eq(R.releases()[0].status, "done");
  R.updateRelease(r.id, { status: "bogus" });
  eq(R.releases()[0].status, "planned");
});

test("releases: timeline はプロダクト/ステータス絞り込み＋時系列昇順・日付未定は末尾", (MK) => {
  // 観点: 実施日優先（actualDate || plannedDate）の昇順で並び、日付なしが末尾。productId/status で絞れる
  // 入力: 2プロダクトに日付違いの4件（1件は実施日がソートキー、1件は日付未定）
  const R = MK.logic.releases;
  const pa = MK.products.create({ name: "A" });
  const pb = MK.products.create({ name: "B" });
  R.addRelease({ productId: pa.id, version: "a2", plannedDate: "2026-03-01" });
  // a1 は予定 2026-04-01 だが実施 2026-01-15 → 実施日がソートキーで先頭に来る
  R.addRelease({ productId: pa.id, version: "a1", plannedDate: "2026-04-01", actualDate: "2026-01-15", status: "done" });
  R.addRelease({ productId: pb.id, version: "b1", plannedDate: "2026-02-01" });
  R.addRelease({ productId: pa.id, version: "a3" }); // 日付未定
  eq(R.timeline("all", "all").map((r) => r.version), ["a1", "b1", "a2", "a3"]);
  eq(R.timeline(pa.id, "all").map((r) => r.version), ["a1", "a2", "a3"]);
  eq(R.timeline(pa.id, "planned").map((r) => r.version), ["a2", "a3"]);
  // counts もプロダクトで絞れる
  eq(R.counts(pa.id).all, 3);
  eq(R.counts(pb.id).planned, 1);
});

test("releases: upcoming は起点日以降の予定を予定日昇順で返す", (MK) => {
  // 観点: planned かつ予定日ありのみが対象。起点日当日を含み、過去・完了・日付なしは含まない
  // 入力: 固定日付（テストを「今日」に依存させない）
  const R = MK.logic.releases;
  const p = MK.products.create({ name: "P" });
  R.addRelease({ productId: p.id, version: "past", plannedDate: "2025-12-01" });
  R.addRelease({ productId: p.id, version: "today", plannedDate: "2026-01-01" });
  R.addRelease({ productId: p.id, version: "later", plannedDate: "2026-02-01" });
  R.addRelease({ productId: p.id, version: "done", plannedDate: "2026-01-10", status: "done" });
  R.addRelease({ productId: p.id, version: "nodate" });
  eq(R.upcoming("2026-01-01").map((r) => r.version), ["today", "later"]);
});

test("releases: summary は予定件数と直近予定日", (MK) => {
  // 観点: empty はデータ皆無のみ true。stats[0]=予定件数、stats[1]=直近予定（無ければ —）
  // 入力: 未来日は today 起点の相対で作る（過去だけだと直近予定が — になるため）
  const R = MK.logic.releases;
  eq(R.summary().empty, true);
  const p = MK.products.create({ name: "P" });
  const future = MK.util.addDays(MK.util.todayISO(), 7);
  R.addRelease({ productId: p.id, version: "v1", plannedDate: "2025-01-01", actualDate: "2025-01-01", status: "done" });
  eq(R.summary().stats[1].value, "—"); // 完了のみ → 直近予定なし
  R.addRelease({ productId: p.id, version: "v2", plannedDate: future });
  const s = R.summary();
  eq(s.empty, false);
  eq(s.stats[0].value, 1); // planned は v2 のみ
  eq(s.stats[1].value, future);
});

test("releases: productName は削除済み Product 参照で空文字にフォールバック", (MK) => {
  // 観点: Product 削除後も productId は保持しつつ、名前解決は "" を返して表示側でガードできる
  const R = MK.logic.releases;
  const p = MK.products.create({ name: "消えるプロダクト" });
  const r = R.addRelease({ productId: p.id, version: "v1" });
  eq(R.productName(r), "消えるプロダクト");
  MK.products.remove(p.id);
  const kept = R.releases()[0];
  eq(kept.productId, p.id); // 参照は保持
  eq(R.productName(kept), "");
});

test("releases: importData の replace と merge", (MK) => {
  // 観点: replace は全置換、merge は id 一致で上書きしつつ既存を残す
  const R = MK.logic.releases;
  const p = MK.products.create({ name: "P" });
  const a = R.addRelease({ productId: p.id, version: "既存A" });
  R.importData({ releases: [
    { id: a.id, productId: p.id, version: "上書きA", plannedDate: "", actualDate: "", status: "done", note: "" },
    { id: "rel_x", productId: p.id, version: "新規B", plannedDate: "", actualDate: "", status: "planned", note: "" },
  ] }, "merge");
  eq(R.counts().all, 2);
  eq(R.releases().find((x) => x.id === a.id).version, "上書きA");
  R.importData({ releases: [{ id: "rel_y", productId: p.id, version: "置換のみ", plannedDate: "", actualDate: "", status: "planned", note: "" }] }, "replace");
  eq(R.counts().all, 1);
});

test("releases: loadSample はプロダクト未登録なら空で保存する", (MK) => {
  // 観点: Product マスタが空でも壊れず空データになる。プロダクトがあれば参照付きで投入される
  const R = MK.logic.releases;
  R.loadSample();
  eq(R.counts().all, 0);
  MK.products.create({ name: "P1" });
  MK.products.create({ name: "P2" });
  R.loadSample();
  assert(R.counts().all > 0);
  // 全件が実在プロダクトを指す
  assert(R.releases().every((r) => R.productName(r) !== ""));
});
