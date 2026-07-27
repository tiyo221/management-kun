/* サンプル投入バーの表示条件 MK.canOfferSample / MK.isEmptyExport（Issue #256・spec §3.6.2）—
   空のモジュールを「入れて試す → 要らなければ片付ける」でその場で判断できるようにするための述語。
   各モジュールの loadSample() は例外なく全置換のため、**空のときしか true にならない**ことが
   実データ消失を防ぐ唯一の砦になる。ここが緩むと todo 等の実データが黙って吹き飛ぶ。
   バーの描画自体はシェル（shared/shell-core.js）にあり DOM を伴うため、判定だけを切り出して検証する。 */
"use strict";

// 擬似モジュールの登録は reset() の対象外でスイート全体に残る。実ロジックへ委譲する def を
// 置きっぱなしにすると、全モジュールを走査する io.buildEnvelope / importEnvelope の既存テスト
// （test/shared.test.js・test/wbs-scope.test.js）が同じデータを二重に通ることになる。
// **finally で外す**のが肝で、素の呼び出しにすると assert が落ちた回だけ登録が残り、
// 「このファイルの失敗が、後から走る無関係なテストの失敗を連れてくる」ことになる。
function withModule(MK, id, def, fn) {
  MK.registerModule(id, def);
  try { fn(MK.modules[id]); }
  finally {
    delete MK.modules[id];
    const i = MK.moduleOrder.indexOf(id);
    if (i >= 0) MK.moduleOrder.splice(i, 1);
  }
}

// ---- MK.isEmptyExport（エクスポート形が空か）----

test("isEmptyExport: スカラだけ／空の入れ物だけなら空", (MK) => {
  // 観点: 全モジュールの空エクスポートは「version 等のスカラ＋空配列／空オブジェクト」の形。
  //       スカラを空判定に数えると version:1 で常に非空になり、バーが永久に出なくなる
  // 入力: 実モジュールの空エクスポートと同型の値
  // 期待: すべて true
  eq(MK.isEmptyExport({ version: 1, tasks: [] }), true);              // todo / wbs 系
  eq(MK.isEmptyExport({ version: 1, uid: 1, tasks: [] }), true);      // wbs（uid つき）
  eq(MK.isEmptyExport({ version: 1, skills: [], ratings: {} }), true); // skills（配列＋マップ）
  eq(MK.isEmptyExport({ version: 1, startTime: "09:00", items: [], routines: [], injected: {} }), true); // daily
});

test("isEmptyExport: 中身のある配列・オブジェクトがあれば非空", (MK) => {
  // 観点: 1件でもデータがあれば false（＝バーを出さない）。全置換の投入を防ぐ肝
  // 入力: 配列に1件／マップに1キー
  // 期待: どちらも false
  eq(MK.isEmptyExport({ version: 1, tasks: [{ id: "t1" }] }), false);
  eq(MK.isEmptyExport({ version: 1, skills: [], ratings: { "m1:s1": "3" } }), false);
});

test("isEmptyExport: null / 非オブジェクトは空扱い", (MK) => {
  // 観点: exportData が未初期化で null 等を返しても落ちない
  // 入力: null / undefined / 文字列
  // 期待: true（空扱い）
  eq(MK.isEmptyExport(null), true);
  eq(MK.isEmptyExport(undefined), true);
  eq(MK.isEmptyExport("x"), true);
});

// ---- MK.canOfferSample（バーを出してよいか）----

test("canOfferSample: 未登録・未搭載の id は false（例外にしない）", (MK) => {
  // 観点: 着脱で外した／存在しない id を問い合わせても壊れない（spec §9.5 の作法）
  // 入力: 登録していない id
  // 期待: 例外にならず false
  eq(MK.canOfferSample("__sb_absent__"), false);
});

test("canOfferSample: loadSample を持たないモジュールは false", (MK) => {
  // 観点: サンプルを持たないモジュール（dashboard のような横断集約ビュー）にバーを出さない
  // 入力: エクスポートは空だが loadSample が無い def
  // 期待: false
  withModule(MK, "__sb_no_sample__", { exportData: () => ({ version: 1, items: [] }), importData: () => {} }, () => {
    eq(MK.canOfferSample("__sb_no_sample__"), false);
  });
});

test("canOfferSample: exportData / importData を欠くモジュールは false", (MK) => {
  // 観点: 片付け（exportData で退避 → importData で復元）が成立しない相手には投入を勧めない。
  //       「入れたら戻せない」バーを出すと、空だから安全という前提が崩れる。実例は resource で、
  //       実データが共有マスタ（allocations / demands）にあり loadSample が replaceAll で置き換える
  // 入力: loadSample はあるが exportData が無い def／importData が無い def
  // 期待: どちらも false
  withModule(MK, "__sb_no_export__", { loadSample: () => {}, importData: () => {} }, () => {
    eq(MK.canOfferSample("__sb_no_export__"), false);
  });
  withModule(MK, "__sb_no_import__", { loadSample: () => {}, exportData: () => ({ version: 1, items: [] }) }, () => {
    eq(MK.canOfferSample("__sb_no_import__"), false);
  });
});

test("canOfferSample: 3契約が揃い投入先が空なら true", (MK) => {
  // 観点: 正常系。投入と片付けが対で成立し、かつ失うものが無いときだけ出る
  // 入力: loadSample / exportData / importData を持ち、エクスポートが空の def
  // 期待: true
  withModule(MK, "__sb_ok__", {
    exportData: () => ({ version: 1, items: [] }), importData: () => {}, loadSample: () => {},
  }, () => {
    eq(MK.canOfferSample("__sb_ok__"), true);
  });
});

test("canOfferSample: データがあるモジュールには出さない", (MK) => {
  // 観点: 本 Issue の肝。loadSample は全置換なので、実データのあるモジュールに出したら
  //       ワンクリックでデータが消える。1件でもあれば絶対に true を返さないこと
  // 入力: エクスポートに1件だけ入っている def
  // 期待: false
  withModule(MK, "__sb_has_data__", {
    exportData: () => ({ version: 1, items: [{ id: "x" }] }), importData: () => {}, loadSample: () => {},
  }, () => {
    eq(MK.canOfferSample("__sb_has_data__"), false);
  });
});

test("canOfferSample: exportData が例外を投げても false（呼び手へ伝播しない）", (MK) => {
  // 観点: 1モジュールのバグでモジュール画面全体が開けなくならない（readSummary と同じ握り）
  // 入力: exportData が必ず throw する def
  // 期待: 例外を握って false
  withModule(MK, "__sb_throws__", {
    exportData: () => { throw new Error("boom"); }, importData: () => {}, loadSample: () => {},
  }, () => {
    eq(MK.canOfferSample("__sb_throws__"), false);
  });
});

test("canOfferSample: scoped は対象ごとに判定する（他対象のデータに引きずられない）", (MK) => {
  // 観点: 空判定に summary().empty（＝モジュール全体）を使わない理由そのもの。wbs は全 PJ 横断で
  //       empty を出すため、他の PJ に1件あるだけで「空の PJ を開いてもバーが出ない」になる。
  //       投入先は表示中の対象なので、判定も対象別でなければ主要シナリオ（新しい PJ でまず試す）が死ぬ
  // 入力: PJ-A にだけデータがある scoped 相当の def へ、対象 id を変えて問い合わせる
  // 期待: PJ-A は false、空の PJ-B は true
  const data = { A: { version: 1, tasks: [{ id: 1 }] }, B: { version: 1, tasks: [] } };
  withModule(MK, "__sb_scoped__", {
    exportData: (targetId) => data[targetId], importData: () => {}, loadSample: () => {},
  }, () => {
    eq(MK.canOfferSample("__sb_scoped__", "A"), false);
    eq(MK.canOfferSample("__sb_scoped__", "B"), true);
  });
});

test("canOfferSample: skills は People マスタに人がいても自分のデータが空なら true", (MK) => {
  // 観点: skills.summary().empty は People マスタが空かまで見る（ms.length === 0 && list.length === 0）。
  //       これを空判定に使うと「人が1人でもいると skills では永久にバーが出ない」になる。
  //       判定は投入先（自分の namespace）だけを見ること
  // 入力: People マスタに1人いる状態で、skills の logic に委譲する def
  // 期待: skills 自身のデータは空なので true
  MK.people.create({ name: "佐藤 花子" });
  const L = MK.logic.skills;
  withModule(MK, "__sb_skills__", {
    summary: () => L.summary(), exportData: () => L.exportData(),
    importData: (d, m) => L.importData(d, m), loadSample: () => L.loadSample(),
  }, () => {
    eq(MK.readSummary("__sb_skills__").empty, false, "summary().empty は人がいると false になる");
    eq(MK.canOfferSample("__sb_skills__"), true, "それでも自分のデータが空ならバーは出せる");
  });
});

// ---- 投入 → 片付けの往復（シェルが行う手順）----

test("サンプル投入バー: 退避→投入→片付けで投入前（空）の状態へ戻る", (MK) => {
  // 観点: シェルが行う一連の流れ（exportData で退避 → loadSample → importData(replace) で復元）が
  //       実モジュールで往復すること。バーの出方も投入前 true → 投入後 false → 片付け後 true と切り替わる
  // 入力: todo の logic に委譲する def（modules/todo/view.js の登録と同じ形）
  // 期待: 投入でタスクが増え、片付けで 0 件（＝投入前）へ戻る
  const L = MK.logic.todo;
  withModule(MK, "__sb_roundtrip__", {
    exportData: () => L.exportData(), importData: (d, m) => L.importData(d, m), loadSample: () => L.loadSample(),
  }, (def) => {
    eq(MK.canOfferSample("__sb_roundtrip__"), true, "空なので投入バーが出る");
    const before = def.exportData(); // シェルが投入前に取る退避
    def.loadSample();
    assert(L.tasks().length > 0, "サンプルが入っている");
    eq(MK.canOfferSample("__sb_roundtrip__"), false, "空でなくなったので投入バーは出ない");

    def.importData(before, "replace"); // 片付け
    eq(L.tasks().length, 0);
    eq(MK.canOfferSample("__sb_roundtrip__"), true, "空へ戻ったので再び投入バーが出る");
  });
});

test("サンプル投入バー: 投入後に変更が入ったら退避は無効（片付けで巻き添えにしない）", (MK) => {
  // 観点: CONVENTIONS §2.5-3「退避した1件は、他の変更が入った時点で破棄する」。サンプルを土台に
  //       自分のタスクを足したあとで片付けると、片付け（replace・取り消し不能）がその追記ごと消す。
  //       シェルは投入直後の姿を覚えておき、現在のデータと違えば退避を捨てる
  // 入力: 投入 → 投入直後のスナップショットを取る → タスクを1件追加
  // 期待: 追加前は一致（退避は有効）、追加後は不一致（退避は無効＝片付けを出さない）
  const L = MK.logic.todo;
  L.loadSample();
  const injected = JSON.stringify(L.exportData());
  eq(JSON.stringify(L.exportData()) === injected, true, "何もしなければ退避は有効なまま");

  L.addTask("サンプルの上に足した自分のタスク");
  eq(JSON.stringify(L.exportData()) === injected, false, "追記後は不一致＝退避を破棄する");
});

test("サンプル投入バー: 描画で自動投入するモジュール（daily）は mount 後に投入直後の姿を確定する", (MK) => {
  // 観点: バーはモジュール本体より先に描かれるため、投入クリックの時点で「投入直後の姿」を採ると
  //       mount 中の自動投入（daily の ensureDayInjected がその日のルーチンを items へ投入して保存）を
  //       取りこぼす。差分が出た瞬間に退避が無効になり、daily だけ片付けが必ず失敗する
  // 入力: loadSample 直後と、描画（ensureDayInjected）を通した後のエクスポート
  // 期待: クリック時点の姿は描画後と一致しない＝確定は mount 後でなければならない
  const L = MK.logic.daily;
  L.loadSample();
  const atClick = JSON.stringify(L.exportData());
  L.ensureDayInjected(MK.util.todayISO()); // 描画時に走る
  const afterMount = JSON.stringify(L.exportData());
  eq(atClick === afterMount, false, "クリック時点で確定するとルーチン自動投入を取りこぼす");
  assert(L.exportData().routines.length > 0, "サンプルにルーチン定義が含まれている");
  // 確定を mount 後に遅らせれば、以降の再描画では一致し続ける（＝片付けが効く）
  L.ensureDayInjected(MK.util.todayISO()); // 冪等なので二度目は変わらない
  eq(JSON.stringify(L.exportData()) === afterMount, true, "確定後の再描画では差分が出ない");
});

test("サンプル投入バー: バーが出たあとに本体へ入力されたら、投入をやめる判定になる", (MK) => {
  // 観点: バーはシェルの main 直下でモジュール本体（root）とは兄弟のため、モジュール側の render()
  //       ではバーが消えない。バーが出たまま下のフォームから入力すると、押した瞬間に全置換の
  //       loadSample が入力したデータを消す。押下時に空か確かめ直せば、その回を取りやめられる
  // 入力: 空の状態で判定 → タスクを1件入力 → もう一度判定（＝押下時の再確認）
  // 期待: 描画時 true → 入力後 false（投入せず取りやめる）
  const L = MK.logic.todo;
  withModule(MK, "__sb_reguard__", {
    exportData: () => L.exportData(), importData: (d, m) => L.importData(d, m), loadSample: () => L.loadSample(),
  }, () => {
    eq(MK.canOfferSample("__sb_reguard__"), true, "描画時点では空＝バーが出る");
    L.addTask("重要なタスク");
    eq(MK.canOfferSample("__sb_reguard__"), false, "押下時にはもう空ではない＝投入しない");
  });
});

test("daily: サンプル投入は開始時刻（ユーザ設定）を保つ", (MK) => {
  // 観点: startTime は画面上部の time input から設定するユーザ設定。項目が 0 件でも空判定になるため、
  //       開始時刻だけ変えた初回状態でバーが出る。ここで既定へ書き戻すと設定が黙って 09:00 に戻る
  // 入力: 開始時刻を 08:30 にしてから loadSample
  // 期待: サンプルの項目・ルーチンは入るが、開始時刻は 08:30 のまま
  const L = MK.logic.daily;
  L.setStartTime("08:30");
  eq(MK.isEmptyExport(L.exportData()), true, "開始時刻だけの状態は空扱い＝バーが出る");
  L.loadSample();
  eq(L.startTime(), "08:30");
  assert(L.exportData().items.length > 0, "サンプルの項目は入っている");
});

test("サンプル投入バー: マスタが空だと oneonone / releases は投入しても空のまま", (MK) => {
  // 観点: 両モジュールの loadSample() は人・プロダクトが1件も無いと空を保存して return する。
  //       退避を残すと、入っていないのに「サンプルを表示しています」＋片付け導線だけが出て
  //       投入をやり直せなくなる。シェルは投入後に空判定し直し、空なら退避を残さない
  // 入力: マスタが空の状態で loadSample
  // 期待: 投入後も isEmptyExport が true（＝シェルは退避を残さない分岐へ入る）
  eq(MK.people.all().length, 0);
  eq(MK.products.all().length, 0);
  MK.logic.oneonone.loadSample();
  MK.logic.releases.loadSample();
  eq(MK.isEmptyExport(MK.logic.oneonone.exportData()), true);
  eq(MK.isEmptyExport(MK.logic.releases.exportData()), true);
});

test("サンプル投入バー: 投入後に JSON を取り込んでも退避は無効になる", (MK) => {
  // 観点: 上と同じ破棄条件の別経路。設定からの JSON 取込・一括サンプル投入で中身が入れ替わった
  //       あとに片付けると、取り込んだ実データが投入前の空へ巻き戻る
  // 入力: 投入 → 投入直後のスナップショット → 別データを replace で取り込む
  // 期待: 不一致（退避は無効）
  const L = MK.logic.todo;
  L.loadSample();
  const injected = JSON.stringify(L.exportData());

  L.importData({ version: 1, tasks: [{ id: "t_imported", title: "取り込んだ実データ", status: "next" }] }, "replace");
  eq(JSON.stringify(L.exportData()) === injected, false);
});
