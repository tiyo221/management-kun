/* 共有マスタ CRUD ファクトリ（shared/masters.js・Issue #185）の削除 undo（Issue #279）。
   5マスタ共通の骨格なので、代表として people（name 必須・resolvable）と allocations（参照で成立）で確かめる。 */
"use strict";

test("masters: 削除→undoRemove で元の位置へ戻る", (MK) => {
  // 観点: remove が「消した1件＋元の位置」を退避し、undoRemove が同じ位置へ差し戻す（末尾ではない）
  // 入力: A/B/C を作成 → 真ん中の B を remove → undoRemove
  // 期待: remove 後は [A,C]、undoRemove は true を返し並びは [A,B,C] に戻る
  const P = MK.people;
  const a = P.create({ name: "A" }), b = P.create({ name: "B" }), c = P.create({ name: "C" });
  P.remove(b.id);
  eq(P.all().map((m) => m.name), ["A", "C"]);
  eq(P.undoRemove(), true);
  eq(P.all().map((m) => m.name), ["A", "B", "C"]);
  eq(P.all()[1].id, b.id); // 同じ id が戻る（作り直しではない）
  assert(a && c);
});

test("masters: 退避は削除以外の変更（create / update / replaceAll）で破棄される", (MK) => {
  // 観点: 他の変更が入ったあとの undoRemove は復元せず false（位置がずれた配列へ古い退避を戻さない・§2.5-3）
  // 入力: create→remove→create のあと undoRemove。同様に update 後・replaceAll 後でも試す
  // 期待: いずれも false を返し、件数は変わらない
  const P = MK.people;
  const x = P.create({ name: "X" });
  P.remove(x.id);
  P.create({ name: "Y" });
  eq(P.undoRemove(), false);
  eq(P.all().map((m) => m.name), ["Y"]);

  const y = P.all()[0];
  P.remove(y.id);
  P.create({ name: "Z" });
  P.update(P.all()[0].id, { role: "PM" });
  eq(P.undoRemove(), false);

  const z = P.all()[0];
  P.remove(z.id);
  P.replaceAll([{ id: "m9", name: "W" }]);
  eq(P.undoRemove(), false);
  eq(P.all().map((m) => m.name), ["W"]);
});

test("masters: 保持するのは直前に消した1件だけ", (MK) => {
  // 観点: 退避は1つ（汎用 undo スタックは持たない・§2.5-3）
  // 入力: A/B を作成 → A を remove → B を remove → undoRemove を2回
  // 期待: 1回目は B が戻って true、2回目は退避が無く false（A は戻らない）
  const P = MK.people;
  const a = P.create({ name: "A" }), b = P.create({ name: "B" });
  P.remove(a.id);
  P.remove(b.id);
  eq(P.all().length, 0);
  eq(P.undoRemove(), true);
  eq(P.all().map((m) => m.name), ["B"]);
  eq(P.undoRemove(), false);
  eq(P.all().map((m) => m.name), ["B"]);
});

test("masters: 存在しない id の remove は直前の退避を潰さない", (MK) => {
  // 観点: 空振りの remove が退避を上書きしない（連打・二重クリックで undo が死なないこと）
  // 入力: A を remove → 存在しない id を remove → undoRemove
  // 期待: undoRemove は true で A が戻る
  const P = MK.people;
  const a = P.create({ name: "A" });
  P.remove(a.id);
  P.remove("no-such-id");
  eq(P.undoRemove(), true);
  eq(P.all().map((m) => m.name), ["A"]);
});

test("masters: 退避はマスタごとに独立（他マスタの操作で壊れない）", (MK) => {
  // 観点: 退避は define ごとのクロージャに持つ。people の退避が allocations の変更で破棄されない
  // 入力: 人を1件 remove → allocations で create（別マスタの変更）→ people.undoRemove
  // 期待: people は true で戻る（別マスタの変更は people の退避に影響しない）
  const P = MK.people, A = MK.allocations;
  const m = P.create({ name: "A" });
  P.remove(m.id);
  A.create({ memberId: m.id, targetId: "p1", percent: 50 });
  eq(P.undoRemove(), true);
  eq(P.all().map((x) => x.name), ["A"]);
});

test("masters: allocations でも削除 undo が効く（参照で成立するマスタ）", (MK) => {
  // 観点: 骨格が5マスタ共通であること（name を持たない allocations でも同じ挙動）
  // 自明: people と同型の remove→undoRemove を allocations で1往復させるだけ
  const A = MK.allocations;
  const one = A.create({ memberId: "m1", targetId: "p1", percent: 50 });
  A.create({ memberId: "m2", targetId: "p1", percent: 100 });
  A.remove(one.id);
  eq(A.all().length, 1);
  eq(A.undoRemove(), true);
  eq(A.all().map((x) => x.id), [one.id, A.all()[1].id]);
});
