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

test("util.mergeById: id 一致でアップサートし挿入順を保つ", (MK) => {
  // 観点: current を土台に incoming を id 単位で上書き・追加する。文字列 id では
  //       current の順を維持したまま既存を差し替え、新規は末尾に追加される
  // 入力: current=[a,b] / incoming=[b'(更新),c(新規)]
  // 期待: [a, b'(更新後), c] の順・件数3
  const current = [{ id: "a", v: 1 }, { id: "b", v: 2 }];
  const incoming = [{ id: "b", v: 20 }, { id: "c", v: 3 }];
  eq(MK.util.mergeById(current, incoming), [{ id: "a", v: 1 }, { id: "b", v: 20 }, { id: "c", v: 3 }]);
  // 空・未定義入力でも落ちず配列を返す
  eq(MK.util.mergeById(null, undefined), []);
  eq(MK.util.mergeById([{ id: "x" }], null), [{ id: "x" }]);
});

test("util.statusSet: label は key→ラベル、未知はキーを返す", (MK) => {
  // 観点: STATUSES から定型のラベル解決を束ねる。未知・空は従来の定型どおりキーをそのまま返す
  // 入力: 2値の STATUSES に対し既知キー・未知キー・空
  // 期待: 既知はラベル / 未知はそのキー文字列 / 空は空文字
  const set = MK.util.statusSet([{ key: "open", label: "未解決" }, { key: "done", label: "完了" }]);
  eq(set.label("open"), "未解決");
  eq(set.label("done"), "完了");
  eq(set.label("xxx"), "xxx");
  eq(set.label(""), "");
});

test("util.statusSet: normalize は key/ラベルを寛容に解釈し fallback へ寄せる", (MK) => {
  // 観点: 大小・前後空白を吸収して key へ寄せ、byLabel で日本語ラベル→key も引ける。未知は fallback
  // 入力: 大文字混じり・byLabel 対象ラベル・未知値・未指定（null）
  // 期待: 既知key正規化 / ラベルは対応key / 未知と null は fallback("open")
  const set = MK.util.statusSet(
    [{ key: "open", label: "未解決" }, { key: "resolved", label: "わかった" }],
    { fallback: "open", byLabel: { "未解決": "open", "わかった": "resolved" } }
  );
  eq(set.normalize("  OPEN "), "open");
  eq(set.normalize("わかった"), "resolved");
  eq(set.normalize("unknown"), "open");
  eq(set.normalize(null), "open");
  // fallback 未指定なら先頭キーへ寄せる
  eq(MK.util.statusSet([{ key: "a", label: "A" }, { key: "b", label: "B" }]).normalize("zzz"), "a");
});

test("util.statusSet: counts は all＋各キーを0初期化し getKey で集計、追加キーは呼び出し側で足せる", (MK) => {
  // 観点: 該当なしのキーも0で埋め、getKey で要素からキーを取り出す。返り値に追加キーを足しても不変
  // 入力: 3件（open×2, done×1）を status で集計
  // 期待: all=3 / open=2 / done=1 / 未出現キーも0 / knowledge を後付けできる
  const set = MK.util.statusSet([{ key: "open", label: "未解決" }, { key: "done", label: "完了" }]);
  const items = [{ status: "open" }, { status: "open" }, { status: "done" }];
  const c = set.counts(items, (it) => it.status);
  eq(c, { all: 3, open: 2, done: 1 });
  // 追加キー（モジュール固有集計）は返り値へ後付けできる
  c.knowledge = items.filter((it) => it.status === "done").length;
  eq(c.knowledge, 1);
  // 空・未指定でも落ちず 0 初期化のマップを返す
  eq(set.counts(null, (it) => it.status), { all: 0, open: 0, done: 0 });
});

test("io.csv: クォート・カンマ・改行を含むラウンドトリップ", (MK) => {
  // 観点: CSVは値中のカンマ・二重引用符・改行をエスケープでき、stringify→parse で完全に元へ戻る
  // 入力: セルに ","・引用符・改行 を含む2行
  // 期待: parse(stringify(rows)) が元の rows と一致（情報欠落なし）
  const rows = [["h1", "h2"], ["a,b", 'quote"x', "line\nbreak"]];
  eq(MK.io.csv.parse(MK.io.csv.stringify(rows)), rows);
});

test("io.backupFreshness: 未実施は stale・記録すると経過日数で判定", (MK) => {
  // 観点: 全体バックアップの鮮度は「未実施＝警告」から始まり、記録後は基準時刻との
  //       経過日数で判定される（閾値 BACKUP_STALE_DAYS 以上で警告）
  // 入力: 記録なし → markBackup("2026-07-01T09:00:00.000Z") 後に基準日を 7/03・7/15 で評価
  // 期待: 未実施は {days:null, stale:true} / 2日前は stale=false / 14日前は stale=true
  eq(MK.io.BACKUP_STALE_DAYS, 14);
  const none = MK.io.backupFreshness("2026-07-20T00:00:00.000Z");
  eq(none.lastBackupAt, null);
  eq(none.days, null);
  eq(none.stale, true);

  MK.io.markBackup("2026-07-01T09:00:00.000Z");
  const fresh = MK.io.backupFreshness("2026-07-03T09:00:00.000Z");
  eq(fresh.days, 2);
  eq(fresh.stale, false);
  eq(fresh.lastBackupAt, "2026-07-01T09:00:00.000Z");
  eq(MK.io.backupFreshness("2026-07-15T09:00:00.000Z").stale, true);
  eq(MK.io.backupFreshness("2026-07-15T09:00:00.000Z").days, 14);
});

test("io.backupFreshness: 経過日数は 24 時間単位でなく暦日差で数える", (MK) => {
  // 観点: 表示する日付（ローカル暦日）と経過日数を食い違わせない。時刻の前後に依らず
  //       「暦日が何日離れているか」で数え、閾値もその暦日差で切り替わる
  // 入力: 同日の朝→夜 / 前日の夜遅く→翌日の朝 / 閾値ちょうどの暦日差14日（時刻は基準より後）
  // 期待: 同日=0日 / 前日=1日（24時間未満でも1日前） / 暦日差14日は時刻に依らず stale
  const at = (iso) => { MK.io.markBackup(iso); };
  const d = (base) => MK.io.backupFreshness(base);
  at("2026-07-01T00:00:00");
  eq(d("2026-07-01T23:00:00").days, 0);
  at("2026-07-01T23:00:00");
  eq(d("2026-07-02T01:00:00").days, 1);
  at("2026-07-01T23:00:00");
  eq(d("2026-07-15T01:00:00").days, 14);
  eq(d("2026-07-15T01:00:00").stale, true);
});

test("io.buildEnvelope: エンベロープ生成自体は鮮度を更新しない", (MK) => {
  // 観点: 鮮度に数えるのは「全体バックアップの書き出し」だけ。部分エクスポートはもちろん、
  //       scope:"all" のエンベロープ生成（検索・内部利用）でも記録は動かない（記録は markBackup のみ）
  // 入力: buildEnvelope("all") と buildEnvelope("todo") を実行
  // 期待: どちらの後も未実施のまま（lastBackupAt=null）
  MK.io.buildEnvelope("all");
  MK.io.buildEnvelope("todo");
  eq(MK.io.backupFreshness("2026-07-20T00:00:00.000Z").lastBackupAt, null);
});

test("io.backupFreshness: 壊れた記録・未来日時でも落ちない", (MK) => {
  // 観点: 記録が壊れている（lastBackupAt が無い/不正）なら未実施扱いで警告し、
  //       時計ずれ等で未来日時が入っても負の経過日数にはしない（0日＝今日に丸める）
  // 入力: {version:1} だけの記録 / 不正文字列 / 基準時刻より後の日時
  // 期待: 前2つは {days:null, stale:true} / 未来日時は days=0・stale=false
  MK.store.write("backup", { version: 1 });
  eq(MK.io.backupFreshness("2026-07-20T00:00:00.000Z").stale, true);
  MK.store.write("backup", { version: 1, lastBackupAt: "not-a-date" });
  eq(MK.io.backupFreshness("2026-07-20T00:00:00.000Z").days, null);
  MK.io.markBackup("2026-07-25T00:00:00.000Z");
  const future = MK.io.backupFreshness("2026-07-20T00:00:00.000Z");
  eq(future.days, 0);
  eq(future.stale, false);
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
