/* 共有層（util / io.csv / people 名寄せ）のテスト */
"use strict";

test("util.normalizeKey: 全角・空白・大小を正規化", (MK) => {
  eq(MK.util.normalizeKey("  Ａ　Ｂ  "), "a b");
  eq(MK.util.normalizeKey("山田　太郎"), MK.util.normalizeKey("山田 太郎"));
});

test("util 日付ヘルパ", (MK) => {
  eq(MK.util.addDays("2026-06-01", 5), "2026-06-06");
  eq(MK.util.daysBetween("2026-06-01", "2026-06-08"), 7);
  // mondayOf は同じ週の月曜を返す（曜日に依らず冪等）
  const mon = MK.util.mondayOf("2026-06-03");
  eq(MK.util.mondayOf(mon), mon);
  eq(new Date(mon + "T00:00:00").getDay(), 1);
});

test("io.csv: クォート・カンマ・改行を含むラウンドトリップ", (MK) => {
  const rows = [["h1", "h2"], ["a,b", 'quote"x', "line\nbreak"]];
  eq(MK.io.csv.parse(MK.io.csv.stringify(rows)), rows);
});

test("people: 名寄せで全角空白違いを同一人物に集約", (MK) => {
  const id1 = MK.people.resolveOrCreate("山田 太郎");
  const id2 = MK.people.resolveOrCreate("山田　太郎"); // 全角スペース
  eq(id1, id2);
  eq(MK.people.all().length, 1);
});
