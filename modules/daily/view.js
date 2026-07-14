/* モジュール daily（デイリー＝今日のタイムボクシング）— ビュー（描画・イベント）。
   計算/CRUD は MK.logic.daily に委譲。CONVENTIONS §1 / spec/modules/daily.md */
(function () {
  "use strict";
  const MK = window.MK;
  const el = MK.util.el;
  const ui = MK.ui;
  const L = () => MK.logic.daily;

  // 所要時間の選択肢（分）。刻みはプリセット選択（自由入力にはしない・Issue #213 決定）。
  const MIN_OPTS = [15, 30, 45, 60, 90, 120].map((m) => ({ value: String(m), label: fmtDur(m) }));
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

  function render() {
    if (!root) return;
    if (!date) date = MK.util.todayISO();
    root.innerHTML = "";
    root.appendChild(ui.sectionTitle("デイリー"));
    root.appendChild(ui.stack([dayBar(), addBar(), listCard(), footer()]));
  }

  // 日ナビ（◀ / 日付 / ▶ / 今日）＋ 開始時刻
  function dayBar() {
    const today = MK.util.todayISO();
    const label = el("div", { class: "grow", style: "font-weight:600;font-size:16px;" },
      [dateLabel(date)]);
    const startInput = ui.input({ type: "time", value: L().startTime() });
    startInput.style.maxWidth = "120px";
    startInput.addEventListener("change", () => { L().setStartTime(startInput.value); render(); });
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
    const input = ui.input({ placeholder: "今日の候補を入力して Enter", onEnter: (v) => { if (L().addManual(date, v, Number(newMin))) render(); } });
    const minSel = ui.select(MIN_OPTS, newMin, (v) => { newMin = v; });
    minSel.style.maxWidth = "110px";
    return ui.toolbar([
      input,
      minSel,
      ui.button("追加", { variant: "btn-primary", onClick: () => { if (input.value.trim() && L().addManual(date, input.value, Number(newMin))) render(); } }),
      ui.button("ToDo から引く", { onClick: openPullModal }),
    ]);
  }

  // 時間割（自動積み上げ）。並び順がそのまま時刻になる。
  function listCard() {
    const host = ui.card([], { flush: true });
    const sched = L().schedule(date);
    if (!sched.rows.length) {
      host.appendChild(ui.emptyState({
        title: "今日の候補がまだありません",
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
    chips.push(el("span", { class: "chip", text: it.source === "todo" ? "📥 ToDo" : "✍ 手書き" }));
    const title = el("div", { class: it.done ? "mk-done" : "", text: it.title });
    const grow = el("div", { class: "grow" }, [title, el("div", { class: "sub" }, chips)]);

    const minSel = ui.select(MIN_OPTS, String(it.minutes), (v) => { L().setMinutes(it.id, Number(v)); render(); });
    minSel.style.maxWidth = "110px";

    return el("li", { class: "mk-row" }, [
      cb, time, grow, minSel,
      ui.button("↑", { variant: "btn-ghost", onClick: () => { L().moveItem(it.id, -1); render(); } }),
      ui.button("↓", { variant: "btn-ghost", onClick: () => { L().moveItem(it.id, 1); render(); } }),
      ui.button("✕", { variant: "btn-ghost", onClick: () => { L().removeItem(it.id); render(); } }),
    ]);
  }

  // 合計・終了時刻・はみ出し警告＋「残りを明日へ送る」
  function footer() {
    const sched = L().schedule(date);
    const rows = L().dayItems(date);
    const remaining = rows.filter((it) => !it.done).length;
    const bar = ui.toolbar([]);
    if (rows.length) {
      const info = el("div", { class: "grow sub" }, [
        "合計 " + fmtDur(sched.totalMin) + " ／ 終了 " + sched.endLabel,
        sched.overflow ? el("span", { class: "chip", style: "margin-left:var(--space-xs);color:var(--color-error);", text: "⚠ 日をまたぎます" }) : null,
      ]);
      bar.appendChild(info);
    } else {
      bar.appendChild(el("div", { class: "grow" }));
    }
    const nextDay = dateLabel(MK.util.addDays(date, 1));
    bar.appendChild(ui.button("残り" + (remaining ? remaining + "件" : "") + "を " + nextDay + " へ送る", {
      onClick: () => {
        if (!remaining) { MK.ui.toast("繰り越す未完了タスクはありません", "info"); return; }
        const to = MK.util.addDays(date, 1);
        MK.ui.confirm("未完了 " + remaining + " 件を翌日（" + dateLabel(to) + "）へ繰り越しますか？").then((ok) => {
          if (!ok) return;
          const n = L().rolloverTo(date, to);
          render();
          MK.ui.toast(n + " 件を翌日へ繰り越しました", "success");
        });
      },
    }));
    return bar;
  }

  function openPullModal() {
    const cands = L().pullableTodos(date);
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
          L().pullFromTodo(date, c.id, Number(newMin));
          closeModal();
          render();
          MK.ui.toast("「" + c.title + "」を今日の候補に追加しました", "success");
        });
        list.appendChild(row);
      });
      body = list;
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

  MK.registerModule("daily", {
    title: "デイリー",
    icon: "🗓️",
    description: "今日やることを時間割にして1日を組み立てる",
    scope: "global",
    mount(container) { date = MK.util.todayISO(); root = el("div"); container.appendChild(root); render(); },
    unmount() { root = null; },
    summary() { return L().summary(); },
    exportData() { return L().exportData(); },
    importData(data, mode) { L().importData(data, mode); },
    loadSample() { L().loadSample(); },
  });
})();
