/* サンプル投入バーの表示条件 MK.canOfferSample（Issue #256）—
   空のモジュールを「入れて試す → 要らなければ片付ける」で判断できるようにするための述語。
   各モジュールの loadSample() は例外なく全置換のため、**空のときしか true にならない**ことが
   実データ消失を防ぐ唯一の砦になる。ここが緩むと todo 等の実データが黙って吹き飛ぶ。
   バーの描画自体はシェル（shared/shell-core.js）にあり DOM を伴うため、判定だけを切り出して検証する。 */
"use strict";

test("canOfferSample: 未登録・未搭載の id は false（例外にしない）", (MK) => {
  // 観点: 着脱で外した／存在しない id を問い合わせても壊れない（spec §9.5 の作法）
  // 入力: 登録していない id
  // 期待: 例外にならず false
  eq(MK.canOfferSample("__sb_absent__"), false);
});

test("canOfferSample: loadSample を持たないモジュールは false", (MK) => {
  // 観点: サンプルを持たないモジュール（dashboard のような横断集約ビュー）にバーを出さない
  // 入力: summary は空を返すが loadSample が無い def
  // 期待: false
  MK.registerModule("__sb_no_sample__", {
    summary: () => ({ empty: true, stats: [] }),
    exportData: () => ({}), importData: () => {},
  });
  eq(MK.canOfferSample("__sb_no_sample__"), false);
});

test("canOfferSample: exportData / importData を欠くモジュールは false", (MK) => {
  // 観点: 片付け（exportData で退避 → importData で復元）が成立しない相手には投入を勧めない。
  //       「入れたら戻せない」バーを出すと、空だから安全という前提が崩れる
  // 入力: loadSample はあるが exportData が無い def／importData が無い def
  // 期待: どちらも false
  MK.registerModule("__sb_no_export__", {
    summary: () => ({ empty: true, stats: [] }), loadSample: () => {}, importData: () => {},
  });
  MK.registerModule("__sb_no_import__", {
    summary: () => ({ empty: true, stats: [] }), loadSample: () => {}, exportData: () => ({}),
  });
  eq(MK.canOfferSample("__sb_no_export__"), false);
  eq(MK.canOfferSample("__sb_no_import__"), false);
});

test("canOfferSample: summary 未実装は false（空か判断できないので出さない）", (MK) => {
  // 観点: 空かどうかを問い合わせられない相手には出さない（安全側に倒す）
  // 入力: 3契約は揃うが summary 任意契約を実装しない def
  // 期待: false
  MK.registerModule("__sb_no_summary__", {
    loadSample: () => {}, exportData: () => ({}), importData: () => {},
  });
  eq(MK.canOfferSample("__sb_no_summary__"), false);
});

test("canOfferSample: データがあるモジュール（empty:false）には出さない", (MK) => {
  // 観点: 本 Issue の肝。loadSample は全置換なので、実データのあるモジュールに出したら
  //       ワンクリックでデータが消える。empty:false では絶対に true を返さないこと
  // 入力: 3契約が揃い summary が empty:false を返す def
  // 期待: false
  MK.registerModule("__sb_has_data__", {
    summary: () => ({ empty: false, stats: [{ label: "未完", value: 3 }] }),
    loadSample: () => {}, exportData: () => ({}), importData: () => {},
  });
  eq(MK.canOfferSample("__sb_has_data__"), false);
});

test("canOfferSample: 3契約が揃い空（empty:true）なら true", (MK) => {
  // 観点: 正常系。投入と片付けが対で成立し、かつ失うものが無いときだけ出る
  // 入力: loadSample / exportData / importData を持ち summary が empty:true の def
  // 期待: true
  MK.registerModule("__sb_ok__", {
    summary: () => ({ empty: true, stats: [] }),
    loadSample: () => {}, exportData: () => ({}), importData: () => {},
  });
  eq(MK.canOfferSample("__sb_ok__"), true);
});

test("canOfferSample: empty が真偽値でない（欠落・undefined）なら false", (MK) => {
  // 観点: summary の形が契約どおりでないモジュールを「空」と誤認しない（緩い真偽判定にしない）
  // 入力: stats だけ返して empty を持たない summary
  // 期待: false
  MK.registerModule("__sb_no_empty_key__", {
    summary: () => ({ stats: [] }),
    loadSample: () => {}, exportData: () => ({}), importData: () => {},
  });
  eq(MK.canOfferSample("__sb_no_empty_key__"), false);
});

test("canOfferSample: summary が例外を投げても false（呼び手へ伝播しない）", (MK) => {
  // 観点: 1モジュールの summary バグでモジュール画面全体が開けなくならない（readSummary 経由の握り）
  // 入力: summary が必ず throw する def
  // 期待: 例外を握って false
  MK.registerModule("__sb_throws__", {
    summary: () => { throw new Error("boom"); },
    loadSample: () => {}, exportData: () => ({}), importData: () => {},
  });
  eq(MK.canOfferSample("__sb_throws__"), false);
});

test("サンプル投入バー: 退避→投入→片付けで投入前（空）の状態へ戻る", (MK) => {
  // 観点: シェルが行う一連の流れ（exportData で退避 → loadSample → importData(replace) で復元）が
  //       実モジュールで往復すること。バーの出方も投入前 true → 投入後 false → 片付け後 true と切り替わる
  // 入力: todo の logic に委譲する def（modules/todo/view.js の登録と同じ形）
  // 期待: 投入でタスクが増え、片付けで 0 件（＝投入前）へ戻る
  const L = MK.logic.todo;
  MK.registerModule("__sb_roundtrip__", {
    summary: () => L.summary(),
    exportData: () => L.exportData(),
    importData: (d, m) => L.importData(d, m),
    loadSample: () => L.loadSample(),
  });
  const def = MK.modules["__sb_roundtrip__"];

  eq(MK.canOfferSample("__sb_roundtrip__"), true, "空なので投入バーが出る");
  const snapshot = def.exportData(); // シェルが投入前に取る退避
  def.loadSample();
  assert(L.tasks().length > 0, "サンプルが入っている");
  eq(MK.canOfferSample("__sb_roundtrip__"), false, "空でなくなったので投入バーは出ない");

  def.importData(snapshot, "replace"); // 片付け
  eq(L.tasks().length, 0);
  eq(MK.canOfferSample("__sb_roundtrip__"), true, "空へ戻ったので再び投入バーが出る");
});
