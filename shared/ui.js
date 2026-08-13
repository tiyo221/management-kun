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
  // キーボードの無い端末に、押せないショートカットを案内しない（全ての削除トーストに載るため）。
  // 判定できるのはポインタの精度までで、キーボードの有無そのものは検出できない ── 細ポインタ＝
  // キーボードありという近似なので、外付けキーボード付きタブレット等では案内が出ない取りこぼしが
  // ある。ハンドラは常に登録されるので、案内が出なくてもショートカット自体は効く。
  // 都度評価する（同じ端末でも周辺機器の着脱で変わりうる）。
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
      // モーダル表示中も止めない。トースト（z-index 1000）はオーバーレイより前面にあり
      // マウスでは押せるので、キーボードだけ塞ぐと本来消したい非対称が戻る。
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
    // focusout はウィンドウのブラーでも発火する（フォーカスはトースト内のまま）。別タブへ切り替えた
    // だけで裏で消えないよう、次のタスクで実際にフォーカスが外へ出たかを確かめてから再開する。
    t.addEventListener("focusout", () => {
      setTimeout(() => { if (!t.contains(document.activeElement)) handle.resume(); }, 0);
    });
    btn.addEventListener("click", undo);
  };

  // 削除の取り消しトースト（undoToast の定型。CONVENTIONS §2.5-3）。
  // tryUndo は logic 側の復元（マスタの undoRemove / モジュールの undoDelete）で、復元できたかを
  // 返す規約。false のときは無言の no-op にせず、同じ文言で「戻せなかった」ことを伝える
  // （退避は他の変更が入った時点で破棄されるため、この経路は普通に起きる）。
  // onRestored は復元できたときだけ呼ぶ再描画。省略可（masters:changed 等で勝手に描き直る画面）。
  ui.undoDeleteToast = function (message, tryUndo, onRestored) {
    ui.undoToast(message, () => {
      if (!tryUndo()) { ui.toast("元に戻せませんでした（他の変更が入っています）", "error"); return; }
      if (onRestored) onRestored();
    });
  };

  // `{ remove(id)→boolean, undoRemove()→boolean }` を持つ API（共有マスタ）の削除一式。
  // 空振り（既に消えている＝false）ではトーストを出さない ── 出すと、その「元に戻す」が
  // 直前に消した別の1件を復元してしまう。
  // onChanged は再描画。省略できる（masters:changed 等で勝手に描き直る画面では渡さない）。
  // 渡された場合は空振りのときも呼ぶ ── 空振り＝ストアには無いのに画面には出ている状態なので、
  // 保存を伴わない＝通知も飛ばないぶん、ここで画面をストアに合わせ直す必要がある。
  ui.removeWithUndo = function (api, id, message, onChanged) {
    const removed = api.remove(id);
    if (onChanged) onChanged();
    if (!removed) return;
    ui.undoDeleteToast(message, () => api.undoRemove(), onChanged);
  };

  // 開いているモーダルの台帳（Issue #265）。閉じ忘れの後始末をモジュールごとの手書きに任せず、
  // ここで一括して畳めるようにする（開いたまま離脱すると overlay だけが残り、背後は差し替わって
  // いるため操作が宙に浮く）。close() 時に自分で抜けるので、閉じたものは残らない。
  const openModals = new Set();

  // 開いているモーダルを全て閉じる。シェルのビュー切替（unmount の直前）から呼ぶ。
  // persistent なモーダル（画面に紐づかない案内。保存失敗の警告など）は残す ── 保存の失敗は
  // その保存が起こした再描画（masters:changed）と同じ流れで案内が出るため、ここで一緒に畳むと
  // 「未保存のままバックアップを取れ」という肝心の案内が読まれる前に消える。
  // 走査はスナップショット（onClose の中で新しく開いたモーダルは、この掃除では畳まれない）。
  // onClose は「参照を手放す場所」であって、そこからモーダルを開かない。
  // 1枚ずつ例外を隔離する ── onClose はモジュール側が書くコールバックなので、投げないとは
  // 言い切れない。素通しにすると走査が止まり、例外が呼び出し元（route）まで抜けて、残りの
  // モーダルが開いたまま画面遷移だけが死ぬ。
  function closeEach(list) {
    list.forEach((m) => {
      try { m.close(); } catch (e) { console.error("モーダルの後始末に失敗:", e); }
    });
  }
  ui.closeAllModals = function () {
    closeEach(Array.from(openModals).filter((m) => !m.persistent));
    closeRowMenu(); // 行メニューは document.body 直下に浮くので、離脱時に一緒に畳む
  };

  // テスト専用: persistent も含めて全部閉じ、台帳を空にする（テスト間の分離）。view からは呼ばない。
  // closeAllModals と分けるのは、persistent の除外がシェルのビュー切替の都合であって
  // 「後始末」の意味ではないため ── 同じ関数を共用すると、片方の都合が他方を縛る。
  ui._resetModals = function () {
    closeEach(Array.from(openModals));
    openModals.clear();
    closeRowMenu();
  };

  // ---- 行の操作メニュー（⋯）。Issue #156（wbs）/ #266（daily）----
  // 一覧行に並べると密度が上がる低頻度操作を1つのボタンへ寄せるための小さなポップアップ。
  // 同時に開けるのは1つだけ（別の行で開いたら前のは閉じる）。外側クリック・Esc でも閉じる。
  // モーダル（overlay を敷いて背後を止める）ではないので openModals の台帳には載せず、
  // ここで1つだけ参照を持つ ── 代わりにビュー切替では closeAllModals から畳む（上）。
  const ROW_MENU_W = 168; // 幅を測れない環境（offsetWidth を持たない）での代替値（min-width 156 ＋ 余白）
  const ROW_MENU_GAP = 4; // 起点のボタンとの隙間
  let rowMenuNode = null;
  let rowMenuAnchor = null;
  // Esc で閉じる／↑↓ で項目を移る（role="menu" が読み上げ側に期待させる操作。spec §10.2）。
  // 端では折り返す（項目数が少ないので、行き止まりより回るほうが速い）。
  function onRowMenuKey(e) {
    if (e.key === "Escape") { closeRowMenu(); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if (!rowMenuNode) return;
    const items = rowMenuNode.children;
    if (!items.length) return;
    e.preventDefault();
    let i = Array.prototype.indexOf.call(items, document.activeElement);
    if (i < 0) i = e.key === "ArrowDown" ? -1 : 0;
    const next = items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1) + items.length) % items.length];
    if (next && next.focus) next.focus();
  }
  function closeRowMenu() {
    if (!rowMenuNode) return;
    const anchor = rowMenuAnchor;
    // 開いたときにメニュー内へフォーカスを移しているので、閉じたら呼び出し元のボタンへ戻す
    // （戻さないとフォーカスが body へ落ち、キーボードだけで次の行へ進めなくなる。spec §10.2）。
    // ただし戻すのは「フォーカスがまだメニュー内か、どこにも無いとき」だけ ── 外側クリックで
    // 閉じる経路では、利用者がいま押した先（タイトルのインライン編集の入力欄など）へ既に
    // フォーカスが移っている。そこへ割り込むと開いた入力が即 blur して編集が閉じる。
    const active = document.activeElement;
    const hadFocus = !active || active === document.body || rowMenuNode.contains(active);
    rowMenuNode.remove();
    rowMenuNode = null;
    rowMenuAnchor = null;
    document.removeEventListener("click", closeRowMenu);
    document.removeEventListener("keydown", onRowMenuKey);
    // 操作の結果その行ごと消える／作り直されることがあるため、まだ画面にあるときだけ戻す。
    if (hadFocus && anchor && anchor.focus && document.body.contains(anchor)) anchor.focus();
  }
  // anchor: 起点のボタン（この直下に開く）
  // items : [{ label, onClick, danger }]。null を混ぜてよい（条件で出し分ける呼び出し側のため）。
  //         onClick はメニューを閉じたあとに呼ぶ（再描画で自分の DOM を消しても安全なように）。
  ui.rowMenu = function (anchor, items) {
    closeRowMenu();
    const menu = el("div", { class: "mk-row-menu", role: "menu" });
    (items || []).forEach((it) => {
      if (!it) return;
      const b = el("button", { class: "mk-row-menu-item" + (it.danger ? " danger" : ""), text: it.label, role: "menuitem" });
      b.addEventListener("click", (e) => { e.stopPropagation(); closeRowMenu(); if (it.onClick) it.onClick(); });
      menu.appendChild(b);
    });
    const rect = anchor.getBoundingClientRect();
    const vw = (typeof window !== "undefined" && window.innerWidth) || 0;
    const vh = (typeof window !== "undefined" && window.innerHeight) || 0;
    // 起点の直下に開く。左は画面右端からはみ出さない位置へ寄せる（メニュー幅＝.mk-row-menu の
    // min-width ＋ 余白ぶん）。
    menu.style.top = (rect.bottom + ROW_MENU_GAP) + "px";
    menu.style.left = rect.left + "px";
    document.body.appendChild(menu);
    // 幅・高さは挿入しないと測れない。置いてから測り、画面に収まらない向きだけ寄せ直す
    // （日本語のラベルは長さの幅があり、min-width から見積もると 375px で右へはみ出す）。
    const w = menu.offsetWidth || ROW_MENU_W;
    if (vw) menu.style.left = Math.max(0, Math.min(rect.left, vw - w)) + "px";
    // 画面下端に近い行では下に収まらず、項目が見切れて押せない（daily の時間割は行数が多い）。
    const h = menu.offsetHeight || 0;
    if (vh && h && rect.bottom + ROW_MENU_GAP + h > vh) {
      menu.style.top = Math.max(0, rect.top - h - ROW_MENU_GAP) + "px";
    }
    rowMenuNode = menu;
    rowMenuAnchor = anchor;
    const first = menu.children[0];
    if (first && first.focus) first.focus(); // キーボードでも項目へ到達できるように（spec §10.2）
    // 購読は次のタスクへ回す ── いま処理中のクリックがそのまま document まで上がって、
    // 開いた瞬間に閉じるのを避ける。
    setTimeout(() => {
      if (rowMenuNode !== menu) return; // その間に閉じ直されていたら購読しない（解除漏れになる）
      document.addEventListener("click", closeRowMenu);
      document.addEventListener("keydown", onRowMenuKey);
    }, 0);
    // ハンドルは返さない ── 開けるのは常に1つなので、閉じる口は ui.closeRowMenu() に一本化する
    // （「その時点で開いている1つ」を閉じるハンドルを持ち回れると、別の行のメニューを閉じられる）。
  };
  // 開いていれば閉じる（開いていなければ何もしない）。再描画・unmount の後始末から呼ぶ ──
  // 起点のボタンごと作り直されると、浮いたメニューだけが宙に残る。
  ui.closeRowMenu = closeRowMenu;

  // opts: { title, body(string|Node), actions:[{label, variant, onClick(close)}], onClose(), persistent }
  // onClose は「どう閉じても」1度だけ呼ばれる（アクション／Esc／overlay クリック／closeAllModals）。
  // モーダルの寿命に紐づく参照（表示中の本体ノード等）を手放すのに使う。
  // persistent は「ビュー切替で畳まない」指定（既定 false）。閉じるのは利用者の操作だけになる。
  ui.modal = function (opts) {
    opts = opts || {};
    const overlay = el("div", { class: "mk-modal-overlay" });
    const box = el("div", { class: "mk-modal" });
    const head = el("div", { class: "mk-modal-head" }, [el("h3", { text: opts.title || "" })]);
    const body = el("div", { class: "mk-modal-body" });
    if (typeof opts.body === "string") body.innerHTML = opts.body; // 呼び出し側でエスケープ済み前提
    else if (opts.body) body.appendChild(opts.body);
    const foot = el("div", { class: "mk-modal-foot" });

    // close() は何度呼ばれても1回だけ効く（アクションで閉じてから Esc、閉じ済みのハンドルへ
    // closeAllModals、等が普通に起きる。onClose の二重発火を防ぐ）。
    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      openModals.delete(handle);
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      if (typeof opts.onClose === "function") opts.onClose();
    }
    // Esc は最前面の1枚だけ閉じる（台帳は挿入順＝重なり順なので末尾が最前面）。ハンドラは
    // モーダルごとに document へ張るため、素直に close() すると開いている全部が一度に畳まれ、
    // 背後に残す約束の persistent（保存失敗の案内）まで巻き込む。
    function onKey(e) {
      if (e.key !== "Escape") return;
      const top = Array.from(openModals).pop();
      if (top === handle) close(); // 利用者の操作なので persistent でも閉じてよい
    }
    const handle = { close, body, persistent: !!opts.persistent };

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
    openModals.add(handle);
    // 台帳のエントリそのものは返さない（呼び出し側が persistent を後から書き換えられないように）。
    return { close, body };
  };

  ui.confirm = function (message) {
    return new Promise((resolve) => {
      ui.modal({
        title: "確認",
        body: el("p", { text: message }),
        // 「閉じた＝キャンセル」で必ず決着させる。Esc・overlay クリック・一括クローズで閉じたとき、
        // 解決しないままだと待っている呼び出し側が永久に止まる（await の先が動かない）。
        onClose: () => resolve(false),
        // 各アクションは close() より先に resolve する ── close() が onClose を同期で呼ぶため、
        // 後に回すと「先に効いた resolve(false)」に負けて OK が伝わらない（Promise は初回で確定）。
        actions: [
          { label: "キャンセル", variant: "btn-secondary", onClick: (close) => { resolve(false); close(); } },
          { label: "OK", variant: "btn-primary", onClick: (close) => { resolve(true); close(); } },
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
    // flush＝内側の一覧を縁まで敷き詰める（余白・はみ出しの扱いは .card-flush が持つ）。
    return el("div", { class: "card" + (opts.flush ? " card-flush" : "") }, children || []);
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
  // クリックでその場編集するテキスト（一覧項目をモーダルを開かず直す・CONVENTIONS §2.5-2）。
  // 表示⇄入力を切り替えるラッパ要素を返す。Enter または blur で確定、Esc で取消。
  // opts:
  //   value        : 現在値（文字列）
  //   onCommit(next): 値が変わったときだけ呼ぶ（next は trim 済み）。false を返すと不正として元値へ戻す
  //                   （空必須項目の拒否などは呼び出し側で判定する。ここに業務ルールを持たない）
  //   placeholder  : 入力時／空表示のプレースホルダ（任意）
  ui.inlineEdit = function (opts) {
    opts = opts || {};
    let value = opts.value == null ? "" : String(opts.value);
    const wrap = el("span", { class: "mk-inline-edit" });
    const view = el("span", { class: "mk-inline-view", title: "クリックで編集" });
    function paintView() {
      view.textContent = value || opts.placeholder || "";
      view.classList.toggle("is-placeholder", !value && !!opts.placeholder);
    }
    function toView() { wrap.innerHTML = ""; wrap.appendChild(view); paintView(); }
    function toEdit() {
      const input = el("input", { class: "text-input mk-inline-input", type: "text", placeholder: opts.placeholder || "" });
      input.value = value;
      let settled = false; // Enter→blur の二重確定・Esc→blur での確定を防ぐ
      function commit() {
        if (settled) return; settled = true;
        const next = input.value.trim();
        if (next !== value) {
          const res = opts.onCommit ? opts.onCommit(next) : undefined;
          if (res !== false) value = next; // false＝拒否なので元値を保持
        }
        toView();
      }
      function cancel() { if (settled) return; settled = true; toView(); }
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        else if (e.key === "Escape") { e.preventDefault(); cancel(); }
      });
      input.addEventListener("blur", commit);
      wrap.innerHTML = ""; wrap.appendChild(input);
      input.focus();
      if (input.select) input.select();
    }
    view.addEventListener("click", toEdit);
    paintView();
    wrap.appendChild(view);
    return wrap;
  };
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

  // タブに添える件数バッジの束（CONVENTIONS §2.5-4 / Issue #299）。
  // 行内の操作でタブ自体を作り直さず、数字だけ差し替えるための入れ物。
  // todo / techstack / questions が同じ「登録 → 更新 → 破棄」を各自に持っていたので括った。
  // **括ったのはここまで**。「その行が今の絞り込みに残るか」の判定は、絞り込みの軸数も述語も
  // モジュールごとに違う（todo＝タブ＋検索＋並び順／techstack＝タブ＋カテゴリ＋検索／
  // questions＝タブ＋検索＋ナレッジの部分集合）ため、各 view に残す。行の差し替えまで共通化
  // すると §2.5-4 が避けている「差分管理のミニフレームワーク内製」になる。
  // 使い方: render で make() してタブへ挿し、行操作後に refresh(counts)、unmount で clear()。
  ui.countBadges = function () {
    const els = {};
    return {
      // key に対応するバッジ要素を作って覚える（同じ key で作り直すと新しい方を覚える）。
      make(key, count) {
        const b = el("span", { class: "badge badge-count", text: String(count || 0) });
        els[key] = b;
        return b;
      },
      // 件数マップ（logic の counts()）で覚えている全バッジを更新する。
      refresh(counts) {
        Object.keys(els).forEach((k) => { els[k].textContent = String((counts && counts[k]) || 0); });
      },
      // 覚えている参照を捨てる（unmount 用）。残すとデタッチ済みノードへ書き込み続ける。
      clear() { Object.keys(els).forEach((k) => delete els[k]); },
    };
  };

  MK.ui = ui;
})();
