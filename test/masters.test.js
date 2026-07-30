/* 共有マスタ CRUD ファクトリ（shared/masters.js・Issue #185）の削除 undo（Issue #279）。
   5マスタ共通の骨格なので、代表として people（name 必須・resolvable）と allocations（参照で成立）で確かめる。 */
"use strict";

test("masters: 削除→undoRemove で元の位置へ戻る", (MK) => {
  // 観点: remove が「消した1件＋元の位置」を退避し、undoRemove が同じ位置へ差し戻す（末尾ではない）
  // 入力: A/B/C を作成 → 真ん中の B を remove → undoRemove
  // 期待: remove 後は [A,C]、undoRemove は true を返し並びは [A,B,C] に戻る
  const P = MK.people;
  const a = P.create({ name: "A" }), b = P.create({ name: "B" }), c = P.create({ name: "C" });
  eq(P.remove(b.id), true); // 削除できたら true（view はこの戻り値でトーストを出すか決める）
  eq(P.all().map((m) => m.name), ["A", "C"]);
  eq(P.undoRemove(), true);
  eq(P.all().map((m) => m.name), ["A", "B", "C"]);
  eq(P.all().map((m) => m.id), [a.id, b.id, c.id]); // 同じ id が同じ並びで戻る（作り直しではない）
});

test("masters: 退避は create で破棄される", (MK) => {
  // 観点: 削除のあと1件追加すると undoRemove は復元せず false（位置がずれた配列へ古い退避を戻さない・§2.5-3）
  // 入力: X を create→remove → Y を create → undoRemove
  // 期待: false を返し、一覧は [Y] のまま（X は戻らない）
  const P = MK.people;
  const x = P.create({ name: "X" });
  P.remove(x.id);
  P.create({ name: "Y" });
  eq(P.undoRemove(), false);
  eq(P.all().map((m) => m.name), ["Y"]);
});

test("masters: 退避は update で破棄される", (MK) => {
  // 観点: create を挟まず update だけでも退避が捨てられる（各分岐を独立に検証する）
  // 入力: X/Y を create → X を remove → Y を update → undoRemove
  // 期待: false を返し、一覧は [Y] のまま（X は戻らない）
  const P = MK.people;
  const x = P.create({ name: "X" }), y = P.create({ name: "Y" });
  P.remove(x.id);
  P.update(y.id, { role: "PM" });
  eq(P.undoRemove(), false);
  eq(P.all().map((m) => m.name), ["Y"]);
});

test("masters: 退避は replaceAll で破棄される", (MK) => {
  // 観点: 全置換（JSON 復元・CSV 取込）のあとの undoRemove は復元せず false
  // 入力: X を create→remove → replaceAll([W]) → undoRemove
  // 期待: false を返し、一覧は [W] のまま（X は戻らない）
  const P = MK.people;
  const x = P.create({ name: "X" });
  P.remove(x.id);
  P.replaceAll([{ id: "m9", name: "W" }]);
  eq(P.undoRemove(), false);
  eq(P.all().map((m) => m.name), ["W"]);
});

test("masters: forgetAllUndo で全マスタの退避が捨てられる", (MK) => {
  // 観点: ストアを API の外から書き換える経路（全データ初期化・テストのリセット）用の退避破棄。
  //   これが無いと初期化後に「元に戻す」で1件だけ復活する
  // 入力: people と allocations でそれぞれ1件 remove → MK.masters.forgetAllUndo() → 各 undoRemove
  // 期待: どちらも false で、件数は0のまま
  const P = MK.people, A = MK.allocations;
  const m = P.create({ name: "A" });
  const a = A.create({ memberId: m.id, targetId: "p1", percent: 50 });
  P.remove(m.id);
  A.remove(a.id);
  MK.masters.forgetAllUndo();
  eq(P.undoRemove(), false);
  eq(A.undoRemove(), false);
  eq(P.all().length, 0);
  eq(A.all().length, 0);
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

test("masters: 存在しない id の remove は false を返し、直前の退避を潰さない", (MK) => {
  // 観点: 空振りの remove が「削除した」ことにならず（＝view がトーストを出さない）、退避も上書きしない
  //   （出してしまうと、その「元に戻す」が直前に消した別の1件を復元してしまう）
  // 入力: A を remove → 存在しない id を remove → undoRemove
  // 期待: 2回目の remove は false、undoRemove は true で A が戻る
  const P = MK.people;
  const a = P.create({ name: "A" });
  P.remove(a.id);
  eq(P.remove("no-such-id"), false);
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
  const two = A.create({ memberId: "m2", targetId: "p1", percent: 100 });
  A.remove(one.id);
  eq(A.all().map((x) => x.id), [two.id]);
  eq(A.undoRemove(), true);
  eq(A.all().map((x) => x.id), [one.id, two.id]);
});
