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
