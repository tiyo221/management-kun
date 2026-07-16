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
    if (!date) date = MK.util.todayISO();
    // その日を開いたら、該当曜日のルーチンを自動投入する（今日以降のみ・冪等）。schedule の前に呼び、
    // 投入直後の項目も同じ描画へ反映する。過去日・投入済みは logic 側が握るので条件分岐しない。
    L().ensureDayInjected(date);
    root.innerHTML = "";
    // 時間割は1描画につき1回だけ算出して、リストとフッタで使い回す（走査の重複を避ける）。
    const sched = L().schedule(date);
    root.appendChild(ui.sectionTitle("デイリー"));
    root.appendChild(ui.stack([dayBar(), staleBar(), addBar(), listCard(sched), footer(sched)]));
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
    const label = el("div", { class: "grow", style: "font-weight:600;font-size:16px;" },
      [dateLabel(date)]);
    const startInput = ui.input({ type: "time", value: L().startTime() });
    startInput.style.maxWidth = "120px";
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
    minSel.style.maxWidth = "110px";
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
    sched.rows.forEach((r) => list.appendChild(itemRow(r)));
    host.appendChild(list);
    return host;
  }

  function itemRow(r) {
    const it = r.item;
    const cb = el("input", { type: "checkbox" });
    cb.checked = it.done;
    cb.addEventListener("change", () => { L().toggleDone(it.id, cb.checked); render(); });

    const time = el("div", { class: "sub", style: "min-width:92px;font-variant-numeric:tabular-nums;", text: r.start + "–" + r.end });

    const chips = [];
    const srcLabel = it.source === "todo" ? "📥 ToDo" : it.source === "routine" ? "🔁 ルーチン" : "✍ 手書き";
    chips.push(el("span", { class: "chip", text: srcLabel }));
    const title = el("div", { class: it.done ? "mk-done" : "", text: it.title });
    const grow = el("div", { class: "grow" }, [title, el("div", { class: "sub" }, chips)]);

    const minSel = ui.select(minOptsFor(it.minutes), String(it.minutes), (v) => { L().setMinutes(it.id, Number(v)); render(); });
    minSel.style.maxWidth = "110px";

    return el("li", { class: "mk-row mk-daily-row" }, [
      cb, time, grow, minSel,
      ui.button("↑", { variant: "btn-ghost", onClick: () => { L().moveItem(it.id, -1); render(); } }),
      ui.button("↓", { variant: "btn-ghost", onClick: () => { L().moveItem(it.id, 1); render(); } }),
      ui.button("✕", { variant: "btn-ghost", title: "デイリーから外す", onClick: () => removeWithConfirm(it) }),
    ]);
  }

  // 削除は「手書き項目のときだけ」確認する。手書きはデイリーが唯一の実体なので消すと復旧できない
  // （CONVENTIONS §6）。todo 由来は todo に実体が残る＝「今日やらない」の取り消しが容易なので、
  // 日々の組み替えを妨げないよう確認を挟まない。
  function removeWithConfirm(it) {
    if (it.source !== "manual") { L().removeItem(it.id); render(); return; }
    MK.ui.confirm("「" + (it.title || "無題") + "」を削除しますか？（デイリーにしかない項目です）").then((ok) => {
      if (!ok) return;
      L().removeItem(it.id);
      render();
    });
  }

  // 合計・終了時刻・はみ出し警告＋「残りを明日へ送る」（その日に項目があるときだけ出す）
  function footer(sched) {
    if (!sched.rows.length) return null;
    // 繰り越せる残り＝未完了かつ非ルーチン。ルーチン由来は繰り越し対象外（翌日は翌日ぶんが投入される）
    // なので「残りN件を送る」の N に数えると、押しても送られず表示と挙動がズレる。除外して数える。
    const remaining = sched.rows.filter((r) => !r.item.done && r.item.source !== "routine").length;
    const bar = ui.toolbar([
      el("div", { class: "grow sub" }, [
        "合計 " + fmtDur(sched.totalMin) + " ／ 終了 " + sched.endLabel,
        sched.overflow ? el("span", { class: "chip", style: "margin-left:var(--space-xs);color:var(--color-error);", text: "⚠ 日をまたぎます" }) : null,
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
        const grow = el("div", { class: "grow", style: "cursor:pointer;" }, [
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
    _modal = MK.ui.modal({
      title: "ToDo（Next）から引く",
      body,
      actions: [{ label: "閉じる", variant: "btn-secondary", onClick: (c) => c() }],
    });
  }
  // ui.modal() は { close, body } を返す（shared/ui.js）。候補クリックで閉じるために保持する。
  let _modal = null;
  function closeModal() { if (_modal && typeof _modal.close === "function") _modal.close(); }

  // ---- ルーチン（定型業務）設定 ----
  let _routineModal = null;
  let newRoutineMin = "30";          // 追加フォームの所要時間（分・文字列）
  let newRoutineDays = [1, 2, 3, 4, 5]; // 追加フォームの選択曜日（既定は平日。0=日〜6=土）

  // 曜日チェック（0=日〜6=土。WEEK と同じ並び）。selected は number[]、onChange に新しい配列を渡す。
  // next は各チェックボックスの「生きた .checked 状態」から毎回組み立てる（初期 selected をクロージャに
  // 焼き込むと、body を組み直さない追加フォームで2つ目以降のトグルが1つ目の変更を巻き戻してしまう）。
  function dayChecks(selected, onChange) {
    const wrap = el("div", { class: "mk-toolbar", style: "gap:var(--space-xs);flex-wrap:wrap;" });
    const boxes = [];
    WEEK.forEach((label, i) => {
      const cb = ui.checkbox(selected.indexOf(i) >= 0);
      boxes[i] = cb;
      cb.addEventListener("change", () => {
        onChange(boxes.map((c, j) => (c.checked ? j : -1)).filter((j) => j >= 0));
      });
      wrap.appendChild(el("label", { class: "sub", style: "display:inline-flex;align-items:center;gap:2px;" }, [cb, label]));
    });
    return wrap;
  }

  // 既存ルーチン1行（タイトル・所要時間・曜日をその場で編集、✕で削除）。編集は即 updateRoutine へ。
  function routineRow(r, host) {
    const titleInput = ui.input({ value: r.title, onChange: (v) => {
      if (v.trim()) L().updateRoutine(r.id, { title: v }); else titleInput.value = r.title; // 空へは戻さない
    } });
    const minSel = ui.select(minOptsFor(r.minutes), String(r.minutes), (v) => { L().updateRoutine(r.id, { minutes: Number(v) }); });
    minSel.style.maxWidth = "110px";
    // 曜日は最低1つ必要（全外し＝normDays が「毎日」へ寄せるため、外したつもりが全曜日に化ける）。
    // 全外しは弾いて、rebuild で保存済みの選択へ戻す（操作と表示が食い違わないように）。
    const days = dayChecks(r.days || [], (next) => {
      if (!next.length) { MK.ui.toast("曜日を1つ以上選んでください", "error"); rebuildRoutineBody(host); return; }
      L().updateRoutine(r.id, { days: next }); rebuildRoutineBody(host); render();
    });
    const del = ui.button("✕", { variant: "btn-ghost", title: "ルーチンを削除", onClick: () => {
      MK.ui.confirm("ルーチン「" + (r.title || "無題") + "」を削除しますか？（投入済みの項目は残ります）").then((ok) => {
        if (!ok) return;
        L().removeRoutine(r.id);
        rebuildRoutineBody(host);
        render(); // 背後の時間割にも反映（投入済み項目は残るが、定義は消える）
      });
    } });
    return el("li", { class: "mk-row" }, [el("div", { class: "grow" }, [ui.toolbar([titleInput, minSel]), days]), del]);
  }

  // モーダル本体を組み直す（追加・編集・削除のたびに呼ぶ）。
  function rebuildRoutineBody(host) {
    host.innerHTML = "";
    const routs = L().routines();
    const parts = [el("div", { class: "sub", text: "登録すると、該当曜日の日（今日以降）を開いたとき自動で時間割に載ります。定義の変更・削除は投入済みの項目には影響しません。" })];
    if (routs.length) {
      const list = el("ul", { class: "mk-list" });
      routs.forEach((r) => list.appendChild(routineRow(r, host)));
      parts.push(list);
    } else {
      parts.push(ui.emptyState({ title: "ルーチンがまだありません", hint: "下の行で定型業務（タイトル・所要時間・曜日）を登録しましょう。" }));
    }
    // 追加フォーム
    const titleInput = ui.input({ placeholder: "定型業務のタイトル", onEnter: addFromForm });
    const minSel = ui.select(MIN_OPTS, newRoutineMin, (v) => { newRoutineMin = v; });
    minSel.style.maxWidth = "110px";
    function addFromForm() {
      if (!titleInput.value.trim()) return;
      if (!newRoutineDays.length) { MK.ui.toast("曜日を1つ以上選んでください", "error"); return; } // 全外し＝毎日化けを防ぐ
      L().addRoutine(titleInput.value, Number(newRoutineMin), newRoutineDays);
      newRoutineDays = [1, 2, 3, 4, 5]; // 追加後は既定（平日）へ戻す（前回選択の持ち越しで混乱しないように）
      rebuildRoutineBody(host);
      render(); // 今日が該当曜日なら背後の時間割へ即投入される
    }
    parts.push(ui.stack([
      el("div", { class: "sub", style: "margin-top:var(--space-sm);font-weight:600;", text: "新しいルーチンを追加" }),
      ui.toolbar([titleInput, minSel]),
      dayChecks(newRoutineDays, (next) => { newRoutineDays = next; }),
      ui.toolbar([ui.button("追加", { variant: "btn-primary", onClick: addFromForm })]),
    ]));
    parts.forEach((p) => host.appendChild(p));
  }

  function openRoutineModal() {
    const body = el("div");
    rebuildRoutineBody(body);
    _routineModal = MK.ui.modal({
      title: "🔁 ルーチン（定型業務）設定",
      body,
      actions: [{ label: "閉じる", variant: "btn-secondary", onClick: (c) => c() }],
    });
  }
  function closeRoutineModal() { if (_routineModal && typeof _routineModal.close === "function") _routineModal.close(); }

  MK.registerModule("daily", {
    title: "デイリー",
    icon: "🗓️",
    description: "今日やることを時間割にして1日を組み立てる",
    scope: "global",
    mount(container) { date = MK.util.todayISO(); root = el("div"); container.appendChild(root); render(); },
    // モジュール離脱時に開きっぱなしのモーダルを畳む（overlay が残ると、破棄済み root に対して
    // 候補クリックが走り書き込みだけ効いてしまうため）。
    unmount() { closeModal(); closeRoutineModal(); _modal = null; _routineModal = null; root = null; },
    summary() { return L().summary(); },
    exportData() { return L().exportData(); },
    importData(data, mode) { L().importData(data, mode); },
    loadSample() { L().loadSample(); },
  });
})();
