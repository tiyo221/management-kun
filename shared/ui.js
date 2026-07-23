/* 共通UI部品（モーダル・トースト・確認）spec §6.3 */
(function () {
  "use strict";
  const MK = window.MK;
  const el = (t, a, c) => MK.util.el(t, a, c);
  const ui = {};

  function toastHost() {
    let host = document.getElementById("mk-toasts");
    if (!host) {
      host = el("div", { id: "mk-toasts", class: "mk-toasts" });
      document.body.appendChild(host);
    }
    return host;
  }

  // node を表示し ms 後に自動で消す。戻り値の dismiss() で即時に消せる（保留中のタイマーを全て破棄する）。
  // pause()/resume() は自動消滅タイマーの停止・再開（フォーカスが入っている間は消さないため）。
  // onExpire: 自動消滅したときだけ呼ばれる（dismiss() で消したときは呼ばれない）。
  function showToast(node, ms, onExpire) {
    toastHost().appendChild(node);
    requestAnimationFrame(() => node.classList.add("show"));
    let fade = null;
    let timer = null;
    let done = false;
    const start = () => {
      timer = setTimeout(() => {
        done = true;
        node.classList.remove("show");
        fade = setTimeout(() => node.remove(), 300);
        if (onExpire) onExpire();
      }, ms);
    };
    start();
    return {
      dismiss() { done = true; clearTimeout(timer); clearTimeout(fade); node.remove(); },
      pause() { clearTimeout(timer); timer = null; },
      // 残り時間ではなく ms を丸ごと数え直す（フォーカスを外した時点から改めて読む時間を与える）。
      // 消滅後に resume() が来ても復活はさせない（消えたノードのタイマーを回さない）。
      resume() { if (!done && timer === null) start(); },
    };
  }

  ui.toast = function (message, type) {
    // ライブリージョンはテキストだけに付ける（読み上げ専用。操作要素は入れない）
    showToast(el("div", { class: "mk-toast " + (type || "info"), role: "status", "aria-live": "polite", text: message }), 3000);
  };

  // 画面全体を覆い、背面の操作を止めるオーバーレイ。生成側は ui.modal（.mk-modal-overlay）と
  // shared/shell-palette.js（.mk-palette-overlay）の2つで、どちらもここを参照する旨をコメントしてある。
  // 背面を占有しないポップオーバー（メニュー等）は含めない。
  // **ここに足してよいのは「開いている間だけ DOM に存在する」要素だけ**。常設のまま display で
  // 出し入れする要素（index.html の .mk-sidebar-overlay 等）を足すと querySelector が常に一致し、
  // Ctrl+Z が全環境で無言で効かなくなる。可視性まで見る作りにはしない（判定を単純に保つ）。
  const FRONT_OVERLAY_SELECTOR = ".mk-modal-overlay, .mk-palette-overlay";

  // テキスト入力中か（Ctrl+Z は文字入力の取り消しに使われるため、そこでは横取りしない）。
  // input は type で絞る ── 一覧行のチェックボックス（MK.ui.checkbox）はフォーカス先として多く、
  // ここを一律に「入力中」と見なすと undo のショートカットが黙って効かなくなる。
  const TEXT_INPUT_TYPES = ["", "text", "search", "url", "tel", "email", "password", "number",
    "date", "time", "datetime-local", "month", "week"];
  function isTextEntry(node) {
    if (!node) return false;
    if (node.isContentEditable) return true;
    const tag = (node.tagName || "").toLowerCase();
    if (tag === "textarea") return true;
    if (tag !== "input") return false;
    return TEXT_INPUT_TYPES.indexOf((node.type || "").toLowerCase()) >= 0;
  }

  // 取り消しトースト（破壊的操作は confirm ではなくこれを既定にする。CONVENTIONS §2.5-3）
  // message: 実行済みの操作を伝える文（例「削除しました」）／onUndo: 「元に戻す」押下時に呼ぶ復元処理
  // アクティブな undo トーストは常に1つに保つ。logic 側は「直前に消した1件」しか持たない規約（§2.5-3）
  // のため、2つ並ぶと古いトーストの「元に戻す」が新しい削除を復元してしまう。
  // トーストはページ末尾に生成され、フォーカスも移さないため、キーボードでは Tab で到達できない
  // （6秒では間に合わない）。表示中だけ有効なショートカットを代替導線にする（Issue #250・spec §10.2）。
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
  const undoHotkeyLabel = isMac ? "⌘Z" : "Ctrl+Z";
  // キーボードが無い端末（タッチのみ）にショートカットを案内しない。到達できない導線の案内が
  // 全ての削除トーストに載ってしまうため。都度評価する（iPad はキーボードの着脱で変わる）。
  const showsHotkey = () =>
    typeof matchMedia !== "function" || matchMedia("(hover: hover) and (pointer: fine)").matches;
  let activeUndo = null;
  ui.undoToast = function (message, onUndo) {
    if (activeUndo) activeUndo();
    const btn = el("button", { class: "btn btn-ghost", text: "元に戻す" });
    // 読み上げるのは本文だけ。ボタンをライブリージョン内に置くと支援技術から操作しづらくなる。
    // ショートカットは本文に書く（知られていない導線は無いのと同じ）。
    const hint = showsHotkey() ? "（" + undoHotkeyLabel + " で取り消し）" : "";
    const label = el("span", { role: "status", "aria-live": "polite", text: (message || "") + hint + "　" });
    const t = el("div", { class: "mk-toast info" }, [label, btn]);
    let close = null;
    const undo = () => {
      close();
      if (typeof onUndo === "function") onUndo();
    };
    function onKey(e) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.key !== "z" && e.key !== "Z") return;
      if (isTextEntry(document.activeElement)) return; // 入力中はテキストの取り消しに譲る
      // 前面オーバーレイがある間は譲る（背面で undo が走り、開いたままのダイアログが
      // 消えたデータを指す状態になるのを防ぐ）
      if (document.querySelector(FRONT_OVERLAY_SELECTOR)) return;
      e.preventDefault();
      undo();
    }
    // 自動消滅時: 参照を残さず、ボタンも即無効化し、ショートカットも解除する。ノードはフェードアウトの
    // 300ms 残るため、無効化しないとその隙間に押されて「次の削除」を undo してしまう（1つ制限をすり抜ける）。
    const forget = () => {
      btn.disabled = true;
      document.removeEventListener("keydown", onKey);
      if (activeUndo === close) activeUndo = null;
    };
    const handle = showToast(t, 6000, forget);
    close = () => { forget(); handle.dismiss(); };
    activeUndo = close;
    document.addEventListener("keydown", onKey);
    // Tab で到達した利用者が読んでいる最中に消えないよう、フォーカスがトースト内にある間は消さない。
    t.addEventListener("focusin", () => handle.pause());
    t.addEventListener("focusout", () => handle.resume());
    btn.addEventListener("click", undo);
  };

  // opts: { title, body(string|Node), actions:[{label, variant, onClick(close)}] }
  ui.modal = function (opts) {
    opts = opts || {};
    const overlay = el("div", { class: "mk-modal-overlay" }); // クラス名を変えるなら FRONT_OVERLAY_SELECTOR も直す
    const box = el("div", { class: "mk-modal" });
    const head = el("div", { class: "mk-modal-head" }, [el("h3", { text: opts.title || "" })]);
    const body = el("div", { class: "mk-modal-body" });
    if (typeof opts.body === "string") body.innerHTML = opts.body; // 呼び出し側でエスケープ済み前提
    else if (opts.body) body.appendChild(opts.body);
    const foot = el("div", { class: "mk-modal-foot" });

    function close() { overlay.remove(); document.removeEventListener("keydown", onKey); }
    function onKey(e) { if (e.key === "Escape") close(); }

    (opts.actions || []).forEach((a) => {
      foot.appendChild(el("button", {
        class: "btn " + (a.variant || "btn-secondary"),
        text: a.label,
        onClick: () => a.onClick && a.onClick(close),
      }));
    });

    box.appendChild(head);
    box.appendChild(body);
    if (foot.childNodes.length) box.appendChild(foot);
    overlay.appendChild(box);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    return { close, body };
  };

  ui.confirm = function (message) {
    return new Promise((resolve) => {
      ui.modal({
        title: "確認",
        body: el("p", { text: message }),
        actions: [
          { label: "キャンセル", variant: "btn-secondary", onClick: (close) => { close(); resolve(false); } },
          { label: "OK", variant: "btn-primary", onClick: (close) => { close(); resolve(true); } },
        ],
      });
    });
  };

  // ---- レイアウト・部品ヘルパ（view はこれを使い、部品を自作しない。CONVENTIONS §3）----
  ui.sectionTitle = function (text) { return el("h2", { class: "mk-section-title", text: text }); };
  ui.stack = function (children) { return el("div", { class: "mk-stack" }, children || []); };
  ui.toolbar = function (children) { return el("div", { class: "mk-toolbar" }, children || []); };
  ui.card = function (children, opts) {
    opts = opts || {};
    const attrs = { class: "card" };
    if (opts.flush) attrs.style = "padding:0;overflow:hidden;";
    return el("div", attrs, children || []);
  };
  // 空状態ガイド（Issue #41）。文字列は従来どおり1行表示。
  // オブジェクト { title, hint, action:{label, onClick, variant} } で「次の一手」を案内する。
  // 文言は呼び出し側（各モジュール）が持つ。器のレイアウト/トーンだけここで共通化する。
  ui.emptyState = function (arg) {
    if (arg == null || typeof arg === "string") return el("div", { class: "mk-empty", text: arg || "" });
    const box = el("div", { class: "mk-empty" });
    if (arg.title) box.appendChild(el("div", { class: "mk-empty-title", text: arg.title }));
    if (arg.hint) box.appendChild(el("div", { class: "mk-empty-hint", text: arg.hint }));
    if (arg.action) box.appendChild(ui.button(arg.action.label, { variant: arg.action.variant || "btn-primary", onClick: arg.action.onClick }));
    return box;
  };
  ui.statsRow = function (items) {
    return el("div", { class: "card" }, (items || []).map((it) =>
      el("div", { class: "mk-stat" }, [el("div", { class: "num", text: String(it.num) }), el("div", { class: "lbl", text: it.label })])));
  };
  ui.button = function (label, opts) {
    opts = opts || {};
    const b = el("button", { class: "btn " + (opts.variant || "btn-secondary"), text: label, title: opts.title });
    if (opts.onClick) b.addEventListener("click", opts.onClick);
    return b;
  };
  ui.field = function (label, control) { return el("div", { class: "field" }, [el("label", { text: label }), control]); };
  ui.input = function (opts) {
    opts = opts || {};
    const i = el("input", { class: "text-input", type: opts.type || "text", placeholder: opts.placeholder });
    i.value = opts.value == null ? "" : opts.value;
    if (opts.onChange) i.addEventListener("change", () => opts.onChange(i.value));
    if (opts.onEnter) i.addEventListener("keydown", (e) => { if (e.key === "Enter") opts.onEnter(i.value); });
    return i;
  };
  ui.textarea = function (value) { const t = el("textarea", { class: "text-input" }); t.value = value || ""; return t; };
  ui.checkbox = function (checked) { const c = el("input", { type: "checkbox" }); c.checked = !!checked; return c; };
  ui.select = function (options, value, onChange) {
    const s = el("select", { class: "text-input" });
    (options || []).forEach((o) => s.appendChild(el("option", { value: o.value, text: o.label })));
    if (value != null) s.value = value;
    if (onChange) s.addEventListener("change", () => onChange(s.value));
    return s;
  };
  ui.pillTabs = function (tabs, activeKey, onChange) {
    const bar = el("div", { class: "mk-toolbar" });
    (tabs || []).forEach((t) => {
      const b = el("button", { class: "pill-tab" + (t.key === activeKey ? " active" : ""), text: t.label });
      b.addEventListener("click", () => onChange(t.key));
      bar.appendChild(b);
    });
    return bar;
  };

  MK.ui = ui;
})();
