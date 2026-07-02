/* 共有層（util / io.csv / people 名寄せ）のテスト */
"use strict";

test("util.normalizeKey: 全角・空白・大小を正規化", (MK) => {
  // 観点: 名寄せ用キーは全角/半角・前後空白・大小文字の違いを吸収して同一視できる
  // 入力: 前後空白＋全角英字の "  Ａ　Ｂ  " / 半角空白と全角空白違いの氏名
  // 期待: "a b" に正規化 / 空白種の違う氏名は同一キーになる
  eq(MK.util.normalizeKey("  Ａ　Ｂ  "), "a b");
  eq(MK.util.normalizeKey("山田　太郎"), MK.util.normalizeKey("山田 太郎"));
});

test("util 日付ヘルパ", (MK) => {
  // 観点: 日付加算・日数差・週頭(月曜)算出が正しく、mondayOf は曜日に依らず冪等
  // 入力: 6/1+5日 / 6/1〜6/8の差 / 6/3(週の途中)の月曜
  // 期待: 6/6 / 7日 / mondayOf(mondayOf(x))==mondayOf(x) かつ結果は月曜(getDay===1)
  eq(MK.util.addDays("2026-06-01", 5), "2026-06-06");
  eq(MK.util.daysBetween("2026-06-01", "2026-06-08"), 7);
  const mon = MK.util.mondayOf("2026-06-03");
  eq(MK.util.mondayOf(mon), mon);
  eq(new Date(mon + "T00:00:00").getDay(), 1);
});

test("io.csv: クォート・カンマ・改行を含むラウンドトリップ", (MK) => {
  // 観点: CSVは値中のカンマ・二重引用符・改行をエスケープでき、stringify→parse で完全に元へ戻る
  // 入力: セルに ","・引用符・改行 を含む2行
  // 期待: parse(stringify(rows)) が元の rows と一致（情報欠落なし）
  const rows = [["h1", "h2"], ["a,b", 'quote"x', "line\nbreak"]];
  eq(MK.io.csv.parse(MK.io.csv.stringify(rows)), rows);
});

test("people: 名寄せで全角空白違いを同一人物に集約", (MK) => {
  // 観点: 表記ゆれ（全角/半角空白）の氏名は同一人物として1件に名寄せされ、重複マスタを作らない
  // 入力: "山田 太郎"(半角) と "山田　太郎"(全角) を続けて resolveOrCreate
  // 期待: 同じ id が返り、people は1件だけ
  const id1 = MK.people.resolveOrCreate("山田 太郎");
  const id2 = MK.people.resolveOrCreate("山田　太郎");
  eq(id1, id2);
  eq(MK.people.all().length, 1);
});
