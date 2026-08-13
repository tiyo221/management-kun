/* shared/ui.js の「振る舞いを持つ」ヘルパのテスト（Issue #252）。
   対象は状態遷移を持つ中核だけ ── 壊れると「別の削除を undo する」等のデータ破壊になるもの。
   レイアウト部品（sectionTitle / card 等）は手動スモークのままで、ここでは扱わない。 */
"use strict";
const { advanceTimers, fireEvent, setActiveElement, resetDom } = require("./harness");

// undoToast は戻り値を持たないため、生成したトースト DOM を host（#mk-toasts）から辿る。
function lastToast() {
  const host = global.document.getElementById("mk-toasts");
  return host && host.children.length ? host.children[host.children.length - 1] : null;
}
function ctrlZ() { return fireEvent(global.document, "keydown", { ctrlKey: true, key: "z" }); }
function input(type) { const n = global.document.createElement("input"); n.type = type; return n; }

test("ui.undoToast: 自動消滅後は Ctrl+Z で onUndo が呼ばれない（ハンドラ解除）", (MK) => {
  // 観点: 自動消滅（6秒）時に forget() が keydown を解除するので、以降のショートカットは無効
  // 入力: undoToast を出し 6秒進めて消滅 → Ctrl+Z を発火
  // 期待: onUndo が呼ばれない（解除漏れがあればここが呼ばれてしまう＝DoD の赤化条件）
  resetDom();
  let called = false;
  MK.ui.undoToast("削除しました", () => { called = true; });
  advanceTimers(6000); // 自動消滅を発火
  setActiveElement(null);
  ctrlZ();
  assert(!called, "自動消滅後は onUndo が呼ばれてはいけない");
});

test("ui.undoToast: 2つ目を出すと古いトーストの onUndo は呼ばれない（1件制限）", (MK) => {
  // 観点: アクティブな undo は常に1つ。2つ目の生成で1つ目は閉じ、keydown も解除される
  //       （§2.5-3。2つ並ぶと古い「元に戻す」が新しい削除を復元してしまう）
  // 入力: A→B の順に undoToast を出し、Ctrl+Z を発火
  // 期待: B の onUndo だけが呼ばれ、A は呼ばれない
  resetDom();
  let aCalled = false, bCalled = false;
  MK.ui.undoToast("A を削除", () => { aCalled = true; });
  MK.ui.undoToast("B を削除", () => { bCalled = true; });
  setActiveElement(null);
  ctrlZ();
  assert(bCalled, "新しい方の onUndo は呼ばれる");
  assert(!aCalled, "古い方の onUndo は呼ばれてはいけない");
});

test("ui.undoToast: テキスト入力中は Ctrl+Z を横取りしない／チェックボックスでは効く", (MK) => {
  // 観点: input(text)/textarea 上ではブラウザの文字取り消しに譲る。一覧行の checkbox は
  //       フォーカス先として多く、ここを塞ぐと undo ショートカットが黙って効かなくなる
  // 入力: activeElement を text / textarea / checkbox に切り替えて Ctrl+Z を発火
  // 期待: text・textarea では onUndo 呼ばれず、checkbox では呼ばれる
  resetDom();
  let called = false;
  MK.ui.undoToast("削除しました", () => { called = true; });

  setActiveElement(input("text"));
  ctrlZ();
  assert(!called, "text 入力中は onUndo を呼ばない");

  setActiveElement(global.document.createElement("textarea"));
  ctrlZ();
  assert(!called, "textarea 入力中は onUndo を呼ばない");

  setActiveElement(input("checkbox"));
  ctrlZ();
  assert(called, "checkbox にフォーカスがあるときは onUndo が効く");
});

test("ui.undoToast: フォーカスがトースト内にある間は自動消滅せず、ウィンドウのブラーでも消えない", (MK) => {
  // 観点: Tab で読んでいる最中に消えない（focusin で pause）。focusout はウィンドウのブラーでも
  //       発火する（フォーカスはトースト内のまま）ため、実際に外へ出たかを次タスクで確かめてから再開する
  // 入力: undoToast → トースト内ボタンにフォーカス（focusin）→ 6秒経過 → focusout（フォーカスは内側のまま）→ さらに経過
  // 期待: いずれでも自動消滅しない（forget が走らない＝ボタンは無効化されない）
  resetDom();
  MK.ui.undoToast("削除しました", () => {});
  const t = lastToast();
  const btn = t.children[t.children.length - 1]; // 「元に戻す」ボタン（トースト内の要素）

  setActiveElement(btn);
  fireEvent(t, "focusin");   // pause: 自動消滅タイマーを止める
  advanceTimers(10000);
  assert(!btn.disabled, "フォーカス中は自動消滅しない");

  fireEvent(t, "focusout");  // ウィンドウのブラー相当（activeElement はトースト内のまま）
  advanceTimers(1);          // focusout 内の次タスク判定を発火（contains=true なので resume しない）
  advanceTimers(10000);
  assert(!btn.disabled, "フォーカスがトースト内に残る限り、ブラーでは消えない");
});

test("ui.undoDeleteToast: 復元できたら onRestored を呼び、できなければ失敗を伝える", (MK) => {
  // 観点: 削除トーストの定型。tryUndo の戻り値で「再描画」と「戻せなかった案内」を振り分ける
  //       （無言の no-op にしない・§2.5-3。失敗文言はここ1か所に持つ）
  // 入力: tryUndo が true を返すトーストで Ctrl+Z／tryUndo が false を返すトーストで Ctrl+Z
  // 期待: true 側は onRestored が呼ばれ追加のトーストが出ない。false 側は onRestored が呼ばれず
  //       エラートーストが1つ出る
  resetDom();
  let restored = 0;
  MK.ui.undoDeleteToast("削除しました", () => true, () => { restored++; });
  setActiveElement(null);
  ctrlZ();
  eq(restored, 1);
  eq(global.document.getElementById("mk-toasts").children.length, 0); // 成功時は何も出さない

  resetDom();
  let restored2 = 0;
  MK.ui.undoDeleteToast("削除しました", () => false, () => { restored2++; });
  setActiveElement(null);
  ctrlZ();
  eq(restored2, 0);
  const t = lastToast();
  assert(t && /\berror\b/.test(t.className || ""), "戻せなかったことをエラートーストで伝える");
});

test("ui.undoDeleteToast: onRestored 省略時も復元できれば何も出さない", (MK) => {
  // 観点: 再描画を呼び出し側に任せない画面（masters:changed で勝手に描き直る）向けに onRestored は省略可
  // 自明: 第3引数なしで Ctrl+Z を撃ち、例外にならずエラートーストも出ないことを見るだけ
  resetDom();
  let tried = 0;
  MK.ui.undoDeleteToast("削除しました", () => { tried++; return true; });
  setActiveElement(null);
  ctrlZ();
  eq(tried, 1);
  eq(global.document.getElementById("mk-toasts").children.length, 0);
});

test("ui.removeWithUndo: 削除できたときだけトーストを出し、空振りでも再描画は呼ぶ", (MK) => {
  // 観点: 空振り（remove が false）でトーストを出すと、その「元に戻す」が直前に消した別の1件を
  //       復元してしまう。一方で画面はストアに合わせ直す必要がある（消えた行を残さない）
  // 入力: remove が true を返す API と false を返す API で removeWithUndo を呼ぶ
  // 期待: true 側はトースト1つ・onChanged 1回。false 側はトースト0・onChanged 1回（画面は合わせ直す）
  resetDom();
  let changed = 0;
  MK.ui.removeWithUndo({ remove: () => true, undoRemove: () => true }, "x", "削除しました", () => { changed++; });
  eq(changed, 1);
  assert(lastToast(), "削除できたら取り消しトーストを出す");

  resetDom(); // トーストが1つも出なければ host（#mk-toasts）自体が生えない
  let changed2 = 0;
  MK.ui.removeWithUndo({ remove: () => false, undoRemove: () => true }, "x", "削除しました", () => { changed2++; });
  eq(changed2, 1);
  assert(!lastToast(), "空振りではトーストを出さない");
});

test("ui.removeWithUndo: 「元に戻す」で undoRemove を呼び、成功時だけ再描画する", (MK) => {
  // 観点: 復元の配線（undoDeleteToast への委譲）が効いていること
  // 入力: undoRemove が true を返す API で Ctrl+Z ／ false を返す API で Ctrl+Z
  // 期待: true 側は onChanged が2回目（削除時＋復元時）呼ばれる。false 側は1回のまま
  resetDom();
  let changed = 0;
  MK.ui.removeWithUndo({ remove: () => true, undoRemove: () => true }, "x", "削除しました", () => { changed++; });
  setActiveElement(null);
  ctrlZ();
  eq(changed, 2);

  resetDom();
  let changed2 = 0;
  MK.ui.removeWithUndo({ remove: () => true, undoRemove: () => false }, "x", "削除しました", () => { changed2++; });
  setActiveElement(null);
  ctrlZ();
  eq(changed2, 1);
});

test("ui.countBadges: make で覚えた要素を refresh で一括更新する", (MK) => {
  // 観点: 行操作でタブを作り直さず数字だけ差し替える器（§2.5-4 / #299）。todo / techstack /
  //       questions が共有するので、集計キーの扱いを変えたら3モジュール同時に退行する。
  // 入力: all / open / done を make → 新しい件数マップで refresh
  // 期待: 覚えている key はマップの値へ、マップに無い key は 0 へ（未知キーで NaN や undefined を出さない）
  resetDom();
  const badges = MK.ui.countBadges();
  const all = badges.make("all", 3), open = badges.make("open", 2), done = badges.make("done", 1);
  eq(all.textContent, "3");
  eq(open.textContent, "2");
  badges.refresh({ all: 5, open: 4, done: 1, knowledge: 9 }); // 覚えていない key は無視される
  eq(all.textContent, "5");
  eq(open.textContent, "4");
  eq(done.textContent, "1");
  badges.refresh({ all: 2 }); // 欠けた key は 0 へ倒す（前回の数字が残らない）
  eq(all.textContent, "2");
  eq(open.textContent, "0");
});

test("ui.countBadges: clear 後の refresh は何も触らない（unmount 後の書き込み防止）", (MK) => {
  // 観点: unmount で clear() を呼ぶ約束。捨てたあとに遅れて refresh が来ても、デタッチ済みの
  //       ノードへ書き込まない（インライン編集中にモジュールを切り替えると blur の確定が遅れて走る）。
  // 入力: make → clear → refresh
  // 期待: 例外を投げず、直前の要素の表示も変わらない
  resetDom();
  const badges = MK.ui.countBadges();
  const all = badges.make("all", 7);
  badges.clear();
  badges.refresh({ all: 99 });
  eq(all.textContent, "7");
});

test("ui.countBadges: 同じ key で make し直すと新しい要素を覚える（再描画のたびに作り直す）", (MK) => {
  // 観点: render() は毎回タブを組み直して make する。古い要素を掴んだままだと、画面に出ている
  //       新しいバッジが更新されない（数字が固まって見える）。
  // 入力: 同じ key で2回 make → refresh
  // 期待: 2つ目だけが更新される
  resetDom();
  const badges = MK.ui.countBadges();
  const first = badges.make("all", 1);
  const second = badges.make("all", 1);
  badges.refresh({ all: 8 });
  eq(second.textContent, "8");
  eq(first.textContent, "1");
});

// ---- モーダルのライフサイクル（Issue #265）----
// 開いているモーダルは ui 側の台帳で持ち、離脱時にシェルが一括で畳む。閉じ忘れると overlay だけが
// 残り、背後は差し替わっているため操作が宙に浮く（todo の詳細モーダルで実際に起きていた）。

// body 直下の overlay（ui.modal は document.body へ挿す）。util.el は class を className へ入れるため、
// スタブでも実物でも読める className で拾う。
function overlays() {
  return global.document.body.children.filter((n) => String(n.className) === "mk-modal-overlay");
}

test("ui.closeAllModals: 開いている全モーダルを閉じ、onClose を通す（離脱時の一括クローズ）", (MK) => {
  // 観点: モジュールが unmount で手書きに閉じなくても、シェルの1呼び出しで overlay が残らない
  // 入力: 2つ開いて closeAllModals
  // 期待: body から overlay が消え、それぞれの onClose が1度ずつ呼ばれる
  resetDom();
  let closedA = 0, closedB = 0;
  MK.ui.modal({ title: "A", onClose: () => { closedA++; } });
  MK.ui.modal({ title: "B", onClose: () => { closedB++; } });
  eq(overlays().length, 2);
  MK.ui.closeAllModals();
  eq(overlays().length, 0);
  eq([closedA, closedB], [1, 1]);
});

test("ui.modal: close は何度呼んでも onClose は1回だけ（閉じ済みは台帳にも残らない）", (MK) => {
  // 観点: アクションで閉じたあとに Esc や一括クローズが来るのは普通に起きる。二重発火すると
  //       onClose で参照を捨てる側が「開き直した新しいモーダル」の参照まで消しかねない
  // 入力: close() を2回 → さらに closeAllModals
  // 期待: onClose は1回だけ
  resetDom();
  let closed = 0;
  const m = MK.ui.modal({ title: "A", onClose: () => { closed++; } });
  m.close();
  m.close();
  MK.ui.closeAllModals();
  eq(closed, 1);
});

test("ui.modal: Esc・overlay クリックで閉じても onClose が呼ばれる（どう閉じても後始末が走る）", (MK) => {
  // 観点: 後始末をアクションのハンドラに書くと、Esc や overlay クリックの経路で漏れる
  // 入力: Esc で閉じる／別のモーダルは overlay クリックで閉じる
  // 期待: どちらも onClose が呼ばれ、overlay が body から外れる
  resetDom();
  let byEsc = 0, byOverlay = 0;
  MK.ui.modal({ title: "A", onClose: () => { byEsc++; } });
  fireEvent(global.document, "keydown", { key: "Escape" });
  eq(byEsc, 1);
  eq(overlays().length, 0);

  MK.ui.modal({ title: "B", onClose: () => { byOverlay++; } });
  const ov = overlays()[0];
  fireEvent(ov, "click", { target: ov });
  eq(byOverlay, 1);
  eq(overlays().length, 0);
});

test("ui.modal: 閉じたあとの Esc は残ったモーダルだけに効く（keydown の解除漏れ防止）", (MK) => {
  // 観点: close() で document の keydown を外す約束。外し漏れると閉じ済みのモーダルの onClose が
  //       あとから走る（undoToast の解除漏れと同じ壊れ方）
  // 入力: A を閉じてから B を開き、Esc
  // 期待: B だけが閉じ、A の onClose は増えない
  resetDom();
  let a = 0, b = 0;
  const mA = MK.ui.modal({ title: "A", onClose: () => { a++; } });
  mA.close();
  MK.ui.modal({ title: "B", onClose: () => { b++; } });
  fireEvent(global.document, "keydown", { key: "Escape" });
  eq([a, b], [1, 1]);
  eq(overlays().length, 0);
});

test("ui.closeAllModals: persistent なモーダルは畳まない（保存失敗の案内が消えない）", (MK) => {
  // 観点: 書込失敗の案内は、保存を起こした操作と同じ流れで再描画（masters:changed / route）を
  //       呼ぶため、ビュー切替の一括クローズに巻き込むと読まれる前に消える（§10.1 の導線が失われる）
  // 入力: 通常のモーダルと persistent なモーダルを開いて closeAllModals
  // 期待: 通常だけ閉じ、persistent は残る（閉じるのは利用者の操作＝close() だけ）
  resetDom();
  let closedNormal = 0, closedPersistent = 0;
  MK.ui.modal({ title: "通常", onClose: () => { closedNormal++; } });
  const keep = MK.ui.modal({ title: "保存領域が上限に達しました", persistent: true, onClose: () => { closedPersistent++; } });
  MK.ui.closeAllModals();
  eq([closedNormal, closedPersistent], [1, 0]);
  eq(overlays().length, 1);
  keep.close(); // 利用者の操作では閉じる
  eq(closedPersistent, 1);
  eq(overlays().length, 0);
});

// ui.confirm は Promise を返すため、この2件だけ非同期テスト（test が返した Promise をランナーが待つ）。
// 検証するのは手元に控えた解決値だけで、DOM は見ない（続きは全テストの本体が走ったあとに動くため）。
test("ui.confirm: OK は true で決着する（onClose の resolve(false) に負けない）", (MK) => {
  // 観点: close() が onClose を同期で呼ぶので、アクション側は resolve を close より先に呼ぶ必要がある
  //       （逆順に戻すとここが false になる＝この順序依存の見張り）
  // 入力: confirm を出して OK ボタン（フッタの btn-primary）を押す
  // 期待: true
  resetDom();
  const p = MK.ui.confirm("よろしいですか");
  const foot = overlays()[0].children[0].children[2]; // overlay > box > [head, body, foot]
  foot.children[1]._listeners.click[0]({}); // OK
  return p.then((ok) => { assert(ok === true, "OK は true で決着する（got " + ok + "）"); });
});

test("ui.confirm: 一括クローズで閉じたら false で決着する（呼び出し側が止まらない）", (MK) => {
  // 観点: Esc / overlay / 一括クローズで閉じたとき決着しないと、await している側が永久に進まない
  // 入力: confirm を出して closeAllModals
  // 期待: false（＝キャンセル扱い。全呼び出し側が false で早期 return する）
  resetDom();
  const p = MK.ui.confirm("よろしいですか");
  MK.ui.closeAllModals();
  return p.then((ok) => { assert(ok === false, "閉じたら false で決着する（got " + ok + "）"); });
});

test("ui.modal: Esc は最前面の1枚だけ閉じる（背後の persistent を巻き込まない）", (MK) => {
  // 観点: keydown ハンドラはモーダルごとに document へ張るため、素直に閉じると Esc 1回で全部畳まれ、
  //       「ビュー切替でも残す」約束の persistent（保存失敗の案内）まで消える
  // 入力: persistent を出し、その上に通常モーダルを重ねて Esc を2回
  // 期待: 1回目で上の1枚だけ閉じる。2回目で残った persistent が閉じる（利用者の操作では閉じてよい）
  resetDom();
  let closedKeep = 0, closedTop = 0;
  MK.ui.modal({ title: "保存領域が上限に達しました", persistent: true, onClose: () => { closedKeep++; } });
  MK.ui.modal({ title: "通常", onClose: () => { closedTop++; } });
  fireEvent(global.document, "keydown", { key: "Escape" });
  eq([closedTop, closedKeep], [1, 0]);
  eq(overlays().length, 1);
  fireEvent(global.document, "keydown", { key: "Escape" });
  eq(closedKeep, 1);
  eq(overlays().length, 0);
});

test("ui.closeAllModals: onClose が投げても残りを閉じ切る（画面遷移を巻き込まない）", (MK) => {
  // 観点: onClose はモジュール側が書くコールバック。素通しにすると走査が止まり、例外が route() まで
  //       抜けて unmount も main のクリアも走らない（残ったモーダルの上で遷移だけが死ぬ）
  // 入力: 1枚目の onClose が例外を投げる状態で closeAllModals
  // 期待: 例外は外へ出ず、2枚目も閉じて overlay が残らない
  resetDom();
  let closedSecond = 0;
  MK.ui.modal({ title: "投げる", onClose: () => { throw new Error("onClose の失敗"); } });
  MK.ui.modal({ title: "後続", onClose: () => { closedSecond++; } });
  MK.ui.closeAllModals();
  eq(closedSecond, 1);
  eq(overlays().length, 0);
});

// ---- ui.rowMenu（行の ⋯ メニュー。wbs #156 / daily #266 が同じ器を使う）----
// body 直下に浮くポップアップなので、閉じ忘れ＝画面に取り残しが出る。開閉の後始末だけを見張る。
function rowMenus() {
  return global.document.body.children.filter((n) => String(n.className) === "mk-row-menu");
}
function anchor() { return global.document.createElement("button"); }

test("ui.rowMenu: 同時に開くのは1つだけ（別の行で開くと前のは閉じる）", (MK) => {
  // 観点: 行ごとにハンドラを持つので、閉じずに開き直すと body にメニューが積み上がる
  // 入力: 別々の anchor で2回開く
  // 期待: body に残るのは1つ
  resetDom();
  MK.ui.rowMenu(anchor(), [{ label: "A" }]);
  MK.ui.rowMenu(anchor(), [{ label: "B" }]);
  eq(rowMenus().length, 1);
  eq(rowMenus()[0].children[0].textContent, "B");
  MK.ui.closeRowMenu();
});

test("ui.rowMenu: 項目を押すと先に閉じてから onClick が走る（null 項目は飛ばす）", (MK) => {
  // 観点: onClick は再描画（自分の行の作り直し）を含むため、開いたままだと浮いたメニューが取り残される。
  //       条件で出し分ける呼び出し側のために null を混ぜられることも契約（daily のピン解除/固定）
  // 入力: [null, 項目] で開き、項目をクリック
  // 期待: onClick の時点で既に閉じている（＝メニューは body に無い）
  resetDom();
  let openWhenClicked = null;
  MK.ui.rowMenu(anchor(), [null, { label: "実行", onClick: () => { openWhenClicked = rowMenus().length; } }]);
  eq(rowMenus()[0].children.length, 1); // null は項目にならない
  fireEvent(rowMenus()[0].children[0], "click", {});
  eq([openWhenClicked, rowMenus().length], [0, 0]);
});

test("ui.rowMenu: Esc と外側クリックで閉じ、購読も解除する", (MK) => {
  // 観点: document へ張るリスナを解除し損ねると、閉じたあとのクリック/Esc が空振りのまま残り続ける
  // 入力: 開く → タイマーを進めて購読させる → Esc → 再度 Esc/クリック
  // 期待: 1回目で閉じ、以降は document のリスナが残っていない
  resetDom();
  MK.ui.rowMenu(anchor(), [{ label: "A" }]);
  advanceTimers(0); // 購読は次のタスクで張られる（開いた瞬間のクリックで閉じないため）
  fireEvent(global.document, "keydown", { key: "Escape" });
  eq(rowMenus().length, 0);
  eq((global.document._listeners.click || []).length, 0);
  eq((global.document._listeners.keydown || []).length, 0);
  // 外側クリックでも閉じる
  MK.ui.rowMenu(anchor(), [{ label: "A" }]);
  advanceTimers(0);
  fireEvent(global.document, "click", {});
  eq(rowMenus().length, 0);
});

test("ui.rowMenu: closeAllModals で畳まれる（ビュー切替の取り残しを防ぐ）", (MK) => {
  // 観点: メニューは body 直下に fixed で浮くので、モジュールを離れても背後の差し替えでは消えない
  // 入力: 開いた状態でシェルの一括クローズを呼ぶ
  // 期待: body から消える
  resetDom();
  MK.ui.rowMenu(anchor(), [{ label: "A" }]);
  MK.ui.closeAllModals();
  eq(rowMenus().length, 0);
});

test("ui.closeRowMenu: 開いていなくても安全に呼べる（再描画・unmount の後始末から素通しで呼ぶ）", (MK) => {
  // 観点: view は render() / unmount() の冒頭で無条件に呼ぶ（開いているか view は知らない）。
  //       ここで投げると、メニューを使っていない画面の再描画まで巻き添えで死ぬ
  // 入力: 開かずに2回呼ぶ／開いて閉じたあとにもう1回呼ぶ
  // 期待: 例外なく、document のリスナも残らない
  resetDom();
  MK.ui.closeRowMenu();
  MK.ui.closeRowMenu();
  MK.ui.rowMenu(anchor(), [{ label: "A" }]);
  advanceTimers(0);
  MK.ui.closeRowMenu();
  MK.ui.closeRowMenu();
  eq(rowMenus().length, 0);
  eq((global.document._listeners.click || []).length, 0);
});

// フォーカス可能な起点ボタン（スタブに focus は無いので、呼ばれたことを記録する口を足す）。
function focusableAnchor() {
  const n = global.document.createElement("button");
  n.focus = () => { setActiveElement(n); n._focused = (n._focused || 0) + 1; };
  global.document.body.appendChild(n);
  return n;
}

test("ui.rowMenu: 閉じるときフォーカスは戻すが、外側の入力へ移っていたら奪わない", (MK) => {
  // 観点: 外側クリックで閉じる経路では、利用者が押した先（インライン編集の入力欄など）に既に
  //       フォーカスがある。そこへ割り込むと開いた入力が即 blur して編集が閉じる（#321 レビュー）
  // 入力: (1) メニュー内にフォーカスがある状態で閉じる (2) 外側の入力へ移った状態で閉じる
  // 期待: (1) 起点ボタンへ戻す (2) 戻さない
  resetDom();
  const a1 = focusableAnchor();
  MK.ui.rowMenu(a1, [{ label: "A" }]);
  setActiveElement(rowMenus()[0].children[0]); // メニュー内にフォーカス
  MK.ui.closeRowMenu();
  eq(a1._focused || 0, 1);

  const a2 = focusableAnchor();
  MK.ui.rowMenu(a2, [{ label: "A" }]);
  const outside = global.document.createElement("input");
  global.document.body.appendChild(outside);
  setActiveElement(outside); // 外側の入力へフォーカスが移った状態で閉じる
  MK.ui.closeRowMenu();
  eq([a2._focused || 0, global.document.activeElement === outside], [0, true]);
});

test("ui.rowMenu: ↑↓ で項目を移れる（role=menu の操作契約・端で折り返す）", (MK) => {
  // 観点: キーボードだけでメニューを使えること（spec §10.2）。role="menu" は ↑↓ を期待させる
  // 入力: 3項目で開き（先頭にフォーカス）、↓↓↓ と ↑
  // 期待: ↓ で 2→3→1（折り返し）、↑ で 3 番目へ戻る
  resetDom();
  const a = focusableAnchor();
  const items = [{ label: "A" }, { label: "B" }, { label: "C" }];
  MK.ui.rowMenu(a, items);
  advanceTimers(0); // keydown の購読は次のタスク
  const menu = rowMenus()[0];
  menu.children.forEach((c) => { c.focus = () => setActiveElement(c); });
  setActiveElement(menu.children[0]);
  // ノードそのものを eq に渡すと循環参照で比較できないので、位置（インデックス）で見る。
  const at = () => menu.children.indexOf(global.document.activeElement);
  const key = (k) => fireEvent(global.document, "keydown", { key: k });
  key("ArrowDown"); eq(at(), 1);
  key("ArrowDown"); eq(at(), 2);
  key("ArrowDown"); eq(at(), 0); // 端で折り返す
  key("ArrowUp"); eq(at(), 2);
  MK.ui.closeRowMenu();
});
