/* モジュール daily（デイリー＝今日のタイムボクシング）— ビュー（描画・イベント）。
   計算/CRUD は MK.logic.daily に委譲。CONVENTIONS §1 / spec/modules/daily.md */
(function () {
  "use strict";
  const MK = window.MK;
  const el = MK.util.el;
  const ui = MK.ui;
  const L = () => MK.logic.daily;

  // 所要時間の選択肢（分）。刻みはプリセット選択（自由入力にはしない・Issue #213 決定）。
  const MIN_PRESETS = [15, 30, 45, 60, 90, 120];
  const MIN_OPTS = MIN_PRESETS.map((m) => ({ value: String(m), label: fmtDur(m) }));
  // 既存値がプリセット外（JSON 取込などで入りうる）でも、その値を選択肢に混ぜて正しく表示する。
  // 混ぜないと select が現在値を選べず、触った瞬間に別の値へ黙って書き換わる。
  function minOptsFor(minutes) {
    if (MIN_PRESETS.indexOf(minutes) >= 0) return MIN_OPTS;
    return MIN_PRESETS.concat([minutes]).sort((a, b) => a - b).map((m) => ({ value: String(m), label: fmtDur(m) }));
  }
  const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

  let root = null;
  let date = null; // 表示中の日（"YYYY-MM-DD"）。既定は本日
  let newMin = "30"; // 追加行で選択中の所要時間（分・文字列）
  // 部分更新（CONVENTIONS §2.5-4）用の差し替え対象ノード。時間割は cumulative（各行の時刻が前の行の
  // 所要時間に依存する）ため「行のみ」で閉じるのは完了チェックだけ。分数・固定時刻の変更は後続行の
  // 時刻・空き・食い込み・合計へ波及するので、スケジュール領域（リスト＋フッタ）を差し替える。
  let listNode = null;   // 時間割リストのカード（listCard の戻り）
  let footerNode = null; // 合計・繰り越しのフッタ（footer の戻り。項目0件なら null）
  // 並べ替えの直後に戻すフォーカス（{ id, op }。op は行内ボタンの data-op）。行は作り直されるので、
  // 押していたボタンは DOM から消える ── 戻さないとフォーカスが body へ落ち、キーボードでは
  // 続けて並べ替えられない（.mk-row-move は focus-within で前面化するので見た目も薄く戻る）。
  // wbs の pendingFocusId と同じ手当て（Issue #156 / #266）。
  let pendingFocus = null;

  // 所要時間（分）を "1時間30分" 形式へ。0 分は "0分"。
  function fmtDur(min) {
    const h = Math.floor(min / 60), m = min % 60;
    return (h ? h + "時間" : "") + (m || !h ? m + "分" : "");
  }
  // "YYYY-MM-DD" を "7/15（火）" 形式のラベルへ（曜日付き）。
  function dateLabel(iso) {
    const d = new Date(iso + "T00:00:00");
    return (d.getMonth() + 1) + "/" + d.getDate() + "（" + WEEK[d.getDay()] + "）";
  }
  // 閲覧中の日の呼び名。本日なら「今日」、それ以外は日付ラベル。文面と実際の書き込み先を
  // 一致させるために使う（◀/▶ で別の日を見ているのに「今日の候補」と言わない）。
  function dayWord() { return date === MK.util.todayISO() ? "今日" : dateLabel(date); }

  function render() {
    if (!root) return;
    // 行の ⋯ メニューは body 直下に浮くので、行ごと作り直す前に畳む（起点のボタンが消えると
    // メニューだけが取り残される）。閉じていれば何もしない。
    ui.closeRowMenu();
    if (!date) date = MK.util.todayISO();
    // その日を開いたら、該当曜日のルーチンを自動投入する（今日以降のみ・冪等）。schedule の前に呼び、
    // 投入直後の項目も同じ描画へ反映する。過去日・投入済みは logic 側が握るので条件分岐しない。
    L().ensureDayInjected(date);
    root.innerHTML = "";
    // 時間割は1描画につき1回だけ算出して、リストとフッタで使い回す（走査の重複を避ける）。
    const sched = L().schedule(date);
    listNode = listCard(sched);
    footerNode = footer(sched); // 項目0件なら null（el は null 子を飛ばす）
    root.appendChild(ui.sectionTitle("デイリー"));
    root.appendChild(ui.stack([dayBar(), staleBar(), addBar(), listNode, footerNode]));
  }

  // スケジュール領域（リスト＋フッタ）だけを再算出して差し替える（全再描画しない・CONVENTIONS §2.5-4）。
  // 分数・固定時刻の変更で後続行の時刻・空き・食い込み・合計が変わるため、行単位でなくこの領域を単位にする。
  // 上（日ナビ・追加行）は触らないので、入力途中や画面のスクロール位置を保てる。
  function refreshSchedule() {
    if (!listNode) return;
    ui.closeRowMenu(); // 行を作り直すので、開いている ⋯ メニューは畳む（render() と同じ理由）
    const sched = L().schedule(date);
    const newList = listCard(sched);
    listNode.replaceWith(newList);
    listNode = newList;
    replaceFooter(footer(sched), newList);
    restorePendingFocus();
  }

  // 並べ替えで消えたボタンの代わりに、作り直した行の同じボタンへフォーカスを戻す（§2.5-4）。
  // 対象の行が消えている（他画面で削除された等）ときは何もしない ── body へ落ちるだけで、
  // 無関係な行へ飛ばすよりはよい。
  function restorePendingFocus() {
    const want = pendingFocus;
    pendingFocus = null;
    if (!want || !listNode) return;
    const btn = listNode.querySelector('li[data-id="' + want.id + '"] [data-op="' + want.op + '"]');
    if (btn) btn.focus();
  }

  // フッタ（合計・繰り越し）だけを差し替える。完了チェックは時刻に影響しないので、残り件数の更新に使う。
  function refreshFooter() {
    if (!listNode) return;
    replaceFooter(footer(L().schedule(date)), listNode);
  }

  // 新しいフッタで現在のフッタを差し替える。項目の有無で null になり得るため、出現/消失の両向きを扱う。
  function replaceFooter(newFooter, listRef) {
    if (footerNode) {
      if (newFooter) { footerNode.replaceWith(newFooter); footerNode = newFooter; }
      else { footerNode.remove(); footerNode = null; }
    } else if (newFooter) {
      listRef.after(newFooter); footerNode = newFooter;
    }
  }

  // 取り残しの拾い直し導線。夜の締めを数日忘れても、日を遡って1日ずつ繰り越し直さずに済むようにする
  // （HOME の要対応「前日までの未処理 N件」をクリックすると本日が開くので、その解消手段をここに置く）。
  // 過去日を閲覧中は出さない（「今日へ送る」の意味が分かりにくくなるため）。
  function staleBar() {
    const today = MK.util.todayISO();
    if (date !== today) return null;
    const n = L().staleCount(today);
    if (!n) return null;
    return ui.toolbar([
      el("div", { class: "grow sub", text: "⚠ 前日までの未処理が " + n + " 件あります" }),
      ui.button("まとめて今日へ送る", {
        onClick: () => MK.ui.confirm("前日までの未処理 " + n + " 件を今日（" + dateLabel(today) + "）へまとめて送りますか？").then((ok) => {
          if (!ok) return;
          const moved = L().rolloverStaleTo(today);
          render();
          MK.ui.toast(moved + " 件を今日へ送りました", "success");
        }),
      }),
    ]);
  }

  // 日ナビ（◀ / 日付 / ▶ / 今日）＋ 開始時刻
  function dayBar() {
    const today = MK.util.todayISO();
    const label = el("div", { class: "grow mk-daily-date" }, [dateLabel(date)]);
    const startInput = ui.input({ type: "time", value: L().startTime() });
    startInput.classList.add("mk-daily-at");
    startInput.addEventListener("change", () => {
      // 空にされたら現状維持へ倒す（黙って既定の 09:00 に戻さない）。
      if (!startInput.value) { startInput.value = L().startTime(); return; }
      L().setStartTime(startInput.value);
      render();
    });
    return ui.toolbar([
      ui.button("◀", { variant: "btn-ghost", onClick: () => { date = MK.util.addDays(date, -1); render(); } }),
      label,
      ui.button("今日", { variant: date === today ? "btn-secondary" : "btn-primary", onClick: () => { date = today; render(); } }),
      ui.button("▶", { variant: "btn-ghost", onClick: () => { date = MK.util.addDays(date, 1); render(); } }),
      el("span", { class: "sub", text: "開始" }),
      startInput,
    ]);
  }

  // 追加行（手書きで候補を足す／todo の next から引く）
  function addBar() {
    const input = ui.input({ placeholder: dayWord() + "の候補を入力して Enter", onEnter: (v) => { if (L().addManual(date, v, Number(newMin))) render(); } });
    const minSel = ui.select(MIN_OPTS, newMin, (v) => { newMin = v; });
    minSel.classList.add("mk-daily-min");
    return ui.toolbar([
      input,
      minSel,
      ui.button("追加", { variant: "btn-primary", onClick: () => { if (input.value.trim() && L().addManual(date, input.value, Number(newMin))) render(); } }),
      ui.button("ToDo から引く", { onClick: openPullModal }),
      ui.button("🔁 ルーチン設定", { onClick: openRoutineModal }),
    ]);
  }

  // 時間割（自動積み上げ）。並び順がそのまま時刻になる。
  function listCard(sched) {
    const host = ui.card([], { flush: true });
    if (!sched.rows.length) {
      host.appendChild(ui.emptyState({
        title: dayWord() + "の候補がまだありません",
        hint: "上でやることを書いて追加するか、「ToDo から引く」で next のタスクを持ってきましょう。並べ替えると時間割が組み上がります。",
      }));
      return host;
    }
    const list = el("ul", { class: "mk-list" });
    // 空き行を含む描画順は schedule が組む（時刻の計算は logic 側・CONVENTIONS §1）。view は行の型で描き分けるだけ。
    sched.rows.forEach((r) => { list.appendChild(r.type === "gap" ? gapRow(r) : itemRow(r)); });
    host.appendChild(list);
    return host;
  }

  function itemRow(r) {
    const it = r.item;
    // タイトルはクリックでその場編集（Enter/blur 確定・Esc 取消・CONVENTIONS §2.5-2）。空は拒否して
    // 元値へ戻す（判定は logic の setTitle が持ち、view は戻り値に従う）。todo 由来なら setTitle が
    // todo 側のタイトルも直す（title は todo が正）。cb ハンドラが参照するので先に宣言する。
    const title = ui.inlineEdit({
      value: it.title,
      onCommit: (next) => {
        if (!L().setTitle(it.id, next)) { MK.ui.toast("タイトルを入力してください", "error"); return false; }
        // 行が握っているのは描画時のスナップショット。改名を書き戻さないと、直後に ✕ したとき
        // 取り消しトーストが旧タイトルを出す（削除は it.title を文言に使う）。
        it.title = next;
        return true;
      },
    });
    title.classList.toggle("mk-done", it.done);
    // 読み上げでチェックボックスがどのタスクのものか分かるよう、タイトルのノードと関連付ける。
    // 文字列を aria-label へ焼くとインライン編集での改名に追従しないので id で指す（Issue #266）。
    title.id = "mk-daily-title-" + it.id;
    const cb = el("input", { type: "checkbox", "aria-labelledby": title.id });
    cb.checked = it.done;
    // 完了チェックは時刻に影響しない（schedule は done を時間計算に使わない）ので行内で完結する。
    // 取り消し線を切り替え、残り件数だけフッタで更新する（全再描画しない・CONVENTIONS §2.5-4）。
    cb.addEventListener("change", () => { L().toggleDone(it.id, cb.checked); title.classList.toggle("mk-done", cb.checked); refreshFooter(); });

    // 固定時刻に間に合わず食い込んでいる（conflict）ときは算出時刻を警告色にする。
    const time = el("div", { class: "sub mk-daily-time" + (r.conflict ? " mk-error-text" : ""), text: r.start + "–" + r.end });
    if (r.conflict) time.title = "固定時刻 " + it.at + " に間に合わず食い込んでいます";

    // 開始時刻の固定（ピン）。値があるときだけチップで見せ、クリックでその場編集する（§2.5-2）。
    // 常時 time 入力を置くと、ほとんどの行で使わない入力欄が居座って行が過密になる（Issue #266）。
    // 未固定の行は ⋯ メニューの「開始時刻を固定」から同じ入力欄を呼ぶ。
    // ピンの追加/解除・変更は空き・食い込みを生むためスケジュール領域を差し替える（§2.5-4）。
    const pinSlot = el("span", { class: "mk-daily-pin" });
    function paintPin() {
      pinSlot.innerHTML = "";
      if (!it.at) return;
      // 食い込み時は警告チップ、通常固定は 📌 チップ。どちらもクリックで編集に入る。
      const chip = el("span", {
        class: "chip mk-clickable",
        text: r.conflict ? "⚠ " + it.at + " に食い込み" : "📌 " + it.at,
        title: "クリックで開始時刻を変更（空で解除）",
      });
      chip.addEventListener("click", () => editPin(null));
      pinSlot.appendChild(chip);
    }
    // returnTo: Esc で取り消したときにフォーカスを戻す先（⋯ から開いたときはその ⋯ ボタン）。
    // 戻すノードを持たない経路（チップのクリック＝ポインタ操作）は null でよい ── チップは
    // フォーカスを受けない span なので、戻す先がそもそも無い。
    function editPin(returnTo) {
      pinSlot.innerHTML = "";
      const input = ui.input({ type: "time", value: it.at || "", onChange: (v) => { L().setAt(it.id, v); refreshSchedule(); } });
      input.classList.add("mk-row-control");
      input.title = "開始時刻を固定（空で解除）";
      // 変えずに離れた／Esc なら元の表示へ戻す（変えた場合は onChange の再描画で行ごと作り直される）。
      input.addEventListener("blur", paintPin);
      input.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        paintPin(); // 入力欄ごと捨てるので、フォーカスは呼び出し元へ戻す（放置すると body へ落ちる）
        if (returnTo && returnTo.focus && document.body.contains(returnTo)) returnTo.focus();
      });
      pinSlot.appendChild(input);
      input.focus();
    }

    const srcLabel = it.source === "todo" ? "📥 ToDo" : it.source === "routine" ? "🔁 ルーチン" : "✍ 手書き";
    const chips = el("div", { class: "sub" }, [el("span", { class: "chip", text: srcLabel }), pinSlot]);
    paintPin();
    const grow = el("div", { class: "grow" }, [title, chips]);

    // 分数変更は後続行の時刻・合計へ波及するため、スケジュール領域だけ差し替える（全再描画しない・§2.5-4）。
    // 幅は .mk-row-control に委ねる（内容幅へ縮める）。直書きの max-width:110px では
    // 「1時間30分」の 120px に足りず、選択中のラベルが切れていた（#295 で判明）。
    const minSel = ui.select(minOptsFor(it.minutes), String(it.minutes), (v) => { L().setMinutes(it.id, Number(v)); refreshSchedule(); });
    minSel.classList.add("mk-row-control", "mk-row-select");

    // 並べ替えは同日内の順番の付け替えなので、変わるのは時間割リストと合計だけ（日ナビ・追加行は
    // 動かない）。全再描画せずスケジュール領域だけ差し替え、押していたボタンへフォーカスを戻す
    // （§2.5-4。追加行の入力途中を消さない／キーボードで続けて並べ替えられるように）。
    const moveOp = (op, fn) => { fn(); pendingFocus = { id: it.id, op: op }; refreshSchedule(); };

    // 主操作＝時間の割当（＝並べ替え）なので 1つ前/1つ後ろは行に残す（§2.5-1）。ただし常時濃く
    // 出すと行が騒がしいので、.mk-row-move が hover / focus のときだけ前面化する（wbs と同じ）。
    const move = el("span", { class: "mk-row-move" }, [
      iconBtn("↑", "1つ前へ移動", "up", () => moveOp("up", () => L().moveItem(it.id, -1))),
      iconBtn("↓", "1つ後ろへ移動", "down", () => moveOp("down", () => L().moveItem(it.id, 1))),
    ]);
    // 低頻度の操作（端への一括移動・固定時刻・削除）は ⋯ へ寄せる（Issue #266 の方針検討）。
    const menuBtn = iconBtn("⋯", "その他の操作", "menu", () => {
      ui.rowMenu(menuBtn, [
        { label: "↥ 先頭（朝イチ）へ移動", onClick: () => moveOp("menu", () => L().moveItemToTop(it.id)) },
        { label: "↧ 末尾へ移動", onClick: () => moveOp("menu", () => L().moveItemToEnd(it.id)) },
        // 固定済みの行にも「変更」を残す ── チップのクリックだけにするとポインタ無しでは
        // 「解除してから固定し直す」しか手が無くなる（spec §10.2 キーボードで到達可能）。
        { label: it.at ? "📌 開始時刻を変更" : "📌 開始時刻を固定", onClick: () => editPin(menuBtn) },
        it.at ? { label: "📌 固定を解除", onClick: () => { L().setAt(it.id, ""); refreshSchedule(); } } : null,
        { label: "✕ デイリーから外す", danger: true, onClick: () => removeItemWithUndo(it) },
      ]);
    });

    // data-id / data-op は差し替え後にフォーカスを戻すための目印（restorePendingFocus）。
    return el("li", { class: "mk-row mk-row-dense", "data-id": it.id }, [cb, time, grow, minSel, move, menuBtn]);
  }

  // 記号だけのボタン。読み上げに何のボタンか伝わるよう title と同じ文言を aria-label にも入れる。
  // op は行を作り直したあとに同じボタンを見つけるための目印（省略可）。
  // クリックは止めない（stopPropagation しない）── 行に click ハンドラは無く、逆に止めると
  // 開いている ⋯ メニューの「外側クリックで閉じる」（document 購読）に届かなくなる。
  function iconBtn(label, title, op, onClick) {
    const b = ui.button(label, { variant: "btn-ghost", title: title, onClick: onClick });
    b.setAttribute("aria-label", title);
    if (op) b.setAttribute("data-op", op);
    return b;
  }

  // ピンの手前にできる空き時間を薄い行で見せる（Outlook のように固定予定まで間が空くのを可視化する）。
  function gapRow(r) {
    return el("li", { class: "mk-row mk-daily-gap" }, [
      el("div", { class: "sub mk-daily-time", text: r.start + "–" + r.end }),
      el("div", { class: "grow sub", text: "空き " + fmtDur(r.minutes) }),
    ]);
  }

  // 削除は由来（手書き / ルーチン / todo）で作法を分けず、確認を挟まず即実行して取り消しトーストを
  // 出す（CONVENTIONS §2.5-3）。以前は「その日には取り消せない項目だけ確認する」と分岐していたが、
  // undo 既定のもとでは復旧しにくいものほど取り消し導線を出すべきで、判断の向きが逆だった。
  // 同じ ✕ が項目によって挙動を変えるのは予測もしづらい（Issue #280）。
  // 復元は元の位置へ戻すため全再描画する（1回の明示操作なのでコスト許容・§2.5-4 の但し書き）。
  function removeItemWithUndo(it) {
    const removed = L().removeItem(it.id);
    render(); // 空振り（既に消えている）でも画面をストアへ合わせ直す（幽霊行を残さない）
    if (!removed) return; // 空振りでトーストを出すと、その取り消しが別の1件を復元しかねない
    // 復元先は消した項目が持つ日。別の日を開いている間に戻すと画面に何も出ず「戻せなかった」ように
    // 見えるため、戻すときは表示中の日をその日へ合わせる（飛んだことが分かるよう一言出す）。
    MK.ui.undoDeleteToast("「" + (it.title || "無題") + "」を削除しました", () => L().undoDelete(), () => {
      const jumped = it.date && it.date !== date;
      if (it.date) date = it.date;
      render();
      if (jumped) MK.ui.toast(dateLabel(date) + " へ戻しました", "info");
    });
  }

  // 合計・終了時刻・はみ出し警告＋「残りを明日へ送る」（その日に項目があるときだけ出す）
  function footer(sched) {
    if (!sched.rows.length) return null;
    // 繰り越せる残り＝未完了かつ非ルーチン。ルーチン由来は繰り越し対象外（翌日は翌日ぶんが投入される）
    // なので「残りN件を送る」の N に数えると、押しても送られず表示と挙動がズレる。除外して数える。
    const remaining = sched.rows.filter((r) => r.type === "item" && !r.item.done && r.item.source !== "routine").length;
    const bar = ui.toolbar([
      el("div", { class: "grow sub" }, [
        "合計 " + fmtDur(sched.totalMin) + " ／ 終了 " + sched.endLabel,
        sched.overflow ? el("span", { class: "chip mk-daily-warn-chip", text: "⚠ 日をまたぎます" }) : null,
        sched.hasConflict ? el("span", { class: "chip mk-daily-warn-chip", text: "⚠ 固定時刻に食い込み" }) : null,
      ]),
    ]);
    // 繰り越し元/先は確認ダイアログを開く前に両方キャプチャする（片方だけ後読みすると、
    // 確認中に日ナビが動いたとき「7/15 の残りを 7/17 へ」のようなズレになる）。
    const from = date, to = MK.util.addDays(date, 1);
    const btn = ui.button("残り" + (remaining ? remaining + "件" : "") + "を " + dateLabel(to) + " へ送る", {
      onClick: () => {
        MK.ui.confirm("未完了 " + remaining + " 件を翌日（" + dateLabel(to) + "）へ繰り越しますか？").then((ok) => {
          if (!ok) return;
          const n = L().rolloverTo(from, to);
          render();
          MK.ui.toast(n + " 件を翌日へ繰り越しました", "success");
        });
      },
    });
    if (!remaining) btn.disabled = true; // 未完了ゼロなら押しても意味がないので無効化する
    bar.appendChild(btn);
    return bar;
  }

  function openPullModal() {
    const cands = L().pullableTodos();
    let body;
    if (!cands.length) {
      body = ui.emptyState({
        title: "引ける ToDo がありません",
        hint: "デイリーへ引けるのは ToDo の Next タスクだけです（今日やる候補）。ToDo で Next に動かすとここに出ます。",
      });
    } else {
      const list = el("ul", { class: "mk-list" });
      cands.forEach((c) => {
        const meta = c.projectName ? [el("span", { class: "chip", text: "📁 " + c.projectName })] : [];
        const grow = el("div", { class: "grow mk-clickable" }, [
          el("div", { text: c.title }),
          meta.length ? el("div", { class: "sub" }, meta) : null,
        ]);
        const row = el("li", { class: "mk-row" }, [grow]);
        grow.addEventListener("click", () => {
          // logic は引き込めないとき null を返す（next でなくなった／他の日に載った等）。契約を尊重する。
          const added = L().pullFromTodo(date, c.id, Number(newMin));
          closeModal();
          render();
          if (!added) { MK.ui.toast("「" + c.title + "」は引き込めませんでした", "error"); return; }
          MK.ui.toast("「" + c.title + "」を" + dayWord() + "の候補に追加しました", "success");
        });
        list.appendChild(row);
      });
      // どの所要時間で入るかを明示する（追加行の選択値を暗黙に使うため、気づけないと混乱する）。
      body = ui.stack([
        el("div", { class: "sub", text: "所要時間 " + fmtDur(Number(newMin)) + " で追加します（追加後に各行で変更できます）" }),
        list,
      ]);
    }
    const handle = MK.ui.modal({
      title: "ToDo（Next）から引く",
      body,
      actions: [{ label: "閉じる", variant: "btn-secondary", onClick: (c) => c() }],
      // 手放すのは「自分が入れた参照」だけ（開き直したあとに古い方が閉じても、新しいモーダルを消さない）。
      onClose: () => { if (_modal === handle) _modal = null; },
    });
    _modal = handle;
  }
  // ui.modal() は { close, body } を返す（shared/ui.js）。ここで保持するのは候補クリックで
  // 閉じるためだけ ── 離脱時のクローズはシェルが一括で行う（MK.ui.closeAllModals・Issue #265）。
  let _modal = null;
  function closeModal() { if (_modal) _modal.close(); }

  // ---- ルーチン（定型業務）設定 ----
  let _routineBody = null;           // 表示中のモーダル本体（開き直すと作り直されるので都度差し替える）
  let newRoutineTitle = "";          // 追加フォームの入力途中タイトル（rebuild で消えないよう退避）
  let newRoutineMin = "30";          // 追加フォームの所要時間（分・文字列）
  let newRoutineDays = [1, 2, 3, 4, 5]; // 追加フォームの選択曜日（既定は平日。0=日〜6=土）
  let newRoutineAt = "";             // 追加フォームの固定時刻（"HH:MM" or 空＝流動）

  // 曜日チェック（0=日〜6=土。WEEK と同じ並び）。selected は number[]、onChange に新しい配列を渡す。
  // next は各チェックボックスの「生きた .checked 状態」から毎回組み立てる（初期 selected をクロージャに
  // 焼き込むと、body を組み直さない追加フォームで2つ目以降のトグルが1つ目の変更を巻き戻してしまう）。
  function dayChecks(selected, onChange) {
    const wrap = el("div", { class: "mk-toolbar" }); // gap / flex-wrap は .mk-toolbar が持つ
    const boxes = [];
    WEEK.forEach((label, i) => {
      const cb = ui.checkbox(selected.indexOf(i) >= 0);
      boxes[i] = cb;
      cb.addEventListener("change", () => {
        onChange(boxes.map((c, j) => (c.checked ? j : -1)).filter((j) => j >= 0));
      });
      wrap.appendChild(el("label", { class: "sub mk-check-label inline tight" }, [cb, label]));
    });
    return wrap;
  }

  // 既存ルーチン1行（タイトル・所要時間・曜日をその場で編集、✕で削除）。編集は即 updateRoutine へ。
  function routineRow(r, host) {
    const titleInput = ui.input({ value: r.title, onChange: (v) => {
      if (v.trim()) L().updateRoutine(r.id, { title: v }); else titleInput.value = r.title; // 空へは戻さない
    } });
    const minSel = ui.select(minOptsFor(r.minutes), String(r.minutes), (v) => { L().updateRoutine(r.id, { minutes: Number(v) }); });
    minSel.classList.add("mk-daily-min");
    // 開始時刻の固定（ピン）。空にすると解除して流動へ戻す。変更は今後の投入に効く（投入済み項目はスナップショットのまま）。
    const atInput = ui.input({ type: "time", value: r.at || "", onChange: (v) => { L().updateRoutine(r.id, { at: v }); render(); } });
    atInput.classList.add("mk-daily-at");
    atInput.title = "開始時刻を固定（空で解除）";
    // 曜日は最低1つ必要（全外し＝normDays が「毎日」へ寄せるため、外したつもりが全曜日に化ける）。
    // 全外しは弾いて、rebuild で保存済みの選択へ戻す（操作と表示が食い違わないように）。
    const days = dayChecks(r.days || [], (next) => {
      if (!next.length) { MK.ui.toast("曜日を1つ以上選んでください", "error"); rebuildRoutineBody(host); return; }
      L().updateRoutine(r.id, { days: next }); rebuildRoutineBody(host); render();
    });
    // 削除は確認なしで即実行し、取り消しトーストを出す（§2.5-3）。投入済みの項目は残るので、
    // 消えるのは定義だけ ── その旨はトースト本文で伝える（従来 confirm 文言が担っていた情報）。
    const del = ui.button("✕", { variant: "btn-ghost", title: "ルーチンを削除", onClick: () => {
      // 組み直すのは「今表示しているモーダル本体」。削除時点の host をクロージャで掴むと、トースト
      // 表示中（6秒）に閉じて開き直してから取り消したとき、外れた古いノードを組み直すだけになる。
      const refresh = () => {
        if (_routineBody && _routineBody.isConnected) rebuildRoutineBody(_routineBody);
        render(); // 背後の時間割にも反映
      };
      // 削除→（空振りでも）再描画→取り消しトースト、の手順は共有ヘルパに任せる（§2.5-3 の定型）。
      // 「（Ctrl+Z で取り消し）」がヘルパ側で後ろに付くため、補足は括弧を重ねず地の文で書く。
      MK.ui.removeWithUndo(
        { remove: (id) => L().removeRoutine(id), undoRemove: () => L().undoDelete() },
        r.id,
        "ルーチン「" + (r.title || "無題") + "」を削除しました。投入済みの項目は残ります",
        refresh
      );
    } });
    return el("li", { class: "mk-row" }, [el("div", { class: "grow" }, [ui.toolbar([titleInput, minSel, atInput]), days]), del]);
  }

  // モーダル本体を組み直す（追加・編集・削除のたびに呼ぶ）。
  // 説明・一覧・追加フォームの間隔は .mk-stack に委ねる（インラインで余白を置かない・CONVENTIONS §2.1）。
  function rebuildRoutineBody(host) {
    host.className = "mk-stack";
    host.innerHTML = "";
    const routs = L().routines();
    const parts = [el("div", { class: "sub", text: "登録すると、該当曜日の日（今日以降）を開いたとき自動で時間割に載ります。固定時刻を入れるとその時刻に固定して並びます（空なら流動）。定義の変更・削除は投入済みの項目には影響しません。" })];
    if (routs.length) {
      const list = el("ul", { class: "mk-list" });
      routs.forEach((r) => list.appendChild(routineRow(r, host)));
      parts.push(list);
    } else {
      parts.push(ui.emptyState({ title: "ルーチンがまだありません", hint: "下の行で定型業務（タイトル・所要時間・曜日）を登録しましょう。" }));
    }
    // 追加フォーム。既存ルーチンの曜日トグルは本体全体を rebuild するため、入力途中のタイトルは
    // モジュールスコープの newRoutineTitle へ退避し、rebuild 後も復元する（入力が消えないように）。
    const titleInput = ui.input({ value: newRoutineTitle, placeholder: "定型業務のタイトル", onEnter: addFromForm });
    titleInput.addEventListener("input", () => { newRoutineTitle = titleInput.value; });
    const minSel = ui.select(MIN_OPTS, newRoutineMin, (v) => { newRoutineMin = v; });
    minSel.classList.add("mk-daily-min");
    // 固定時刻（任意）。入れると投入時にその時刻へ固定される。空なら流動。
    const atInput = ui.input({ type: "time", value: newRoutineAt });
    atInput.classList.add("mk-daily-at");
    atInput.title = "開始時刻を固定（任意・空で流動）";
    atInput.addEventListener("input", () => { newRoutineAt = atInput.value; });
    function addFromForm() {
      if (!titleInput.value.trim()) return;
      if (!newRoutineDays.length) { MK.ui.toast("曜日を1つ以上選んでください", "error"); return; } // 全外し＝毎日化けを防ぐ
      L().addRoutine(titleInput.value, Number(newRoutineMin), newRoutineDays, newRoutineAt);
      newRoutineTitle = "";             // 追加できたら入力途中の退避もクリア
      newRoutineDays = [1, 2, 3, 4, 5]; // 追加後は既定（平日）へ戻す（前回選択の持ち越しで混乱しないように）
      newRoutineAt = "";                // 固定時刻も既定（流動）へ戻す
      rebuildRoutineBody(host);
      render(); // 今日が該当曜日なら背後の時間割へ即投入される
    }
    parts.push(
      el("div", { class: "sub mk-strong", text: "新しいルーチンを追加" }),
      ui.toolbar([titleInput, minSel, atInput]),
      dayChecks(newRoutineDays, (next) => { newRoutineDays = next; }),
      ui.toolbar([ui.button("追加", { variant: "btn-primary", onClick: addFromForm })])
    );
    parts.forEach((p) => host.appendChild(p));
  }

  function openRoutineModal() {
    newRoutineTitle = ""; // 開くたびに入力途中の退避はクリア（前回の閉じ残りを持ち込まない）
    newRoutineAt = "";    // 固定時刻の入力途中もクリア
    const body = el("div");
    _routineBody = body;
    rebuildRoutineBody(body);
    MK.ui.modal({
      title: "🔁 ルーチン（定型業務）設定",
      body,
      actions: [{ label: "閉じる", variant: "btn-secondary", onClick: (c) => c() }],
      // 閉じたら本体の参照も手放す（どう閉じても＝Esc・overlay・離脱時の一括クローズでも通る。
      // 開き直せば openRoutineModal が入れ直す）。手放すのは自分が入れた本体だけ ── 開き直した
      // あとに古いモーダルが閉じたとき、新しい本体まで消すと rebuild が効かなくなる。
      onClose: () => { if (_routineBody === body) _routineBody = null; },
    });
  }

  MK.registerModule("daily", {
    title: "デイリー",
    icon: "🗓️",
    description: "今日やることを時間割にして1日を組み立てる",
    scope: "global",
    mount(container) { date = MK.util.todayISO(); root = el("div"); container.appendChild(root); render(); },
    // 開きっぱなしのモーダルはシェルが離脱時に畳む（MK.ui.closeAllModals）。その close が
    // onClose を通すので、_modal / _routineBody はここへ来るまでに手放されている。
    unmount() { ui.closeRowMenu(); root = null; listNode = null; footerNode = null; pendingFocus = null; },
    summary() { return L().summary(); },
    exportData() { return L().exportData(); },
    importData(data, mode) { L().importData(data, mode); },
    loadSample() { L().loadSample(); },
  });
})();
