/* シェル：設定・データ管理・移行（spec §3.6 / §7）。shell-core 等の後に読む（Issue #140）。
   全体 JSON バックアップ／取込、サンプル投入、起動画面、旧ツール移行、ストレージ使用量（Issue #76）、
   モジュール表示切替（Issue #35）、scoped 化前データの移行（§3.7.4）をまとめる。
   定数・main・ルーター・設定アクセサは S（window.MK.shell）経由で共有する。 */
(function () {
  "use strict";
  const MK = window.MK;
  const el = MK.util.el;
  const S = window.MK.shell;
  const { ZONES, META, LEGACY_KEYS, main } = S;
  const { route, getSettings, setSettings, isHiddenModule, setModuleHidden } = S;

  // ストレージ使用量の警告閾値（この比率を超えたら設定画面で警告する。Issue #76）。
  const USAGE_WARN_RATIO = 0.8;
  function formatBytes(b) {
    if (b < 1024) return b + " B";
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
    return (b / (1024 * 1024)).toFixed(2) + " MB";
  }

  // ---- 設定 ----
  function renderSettings() {
    main.appendChild(el("h2", { class: "mk-section-title", text: "設定" }));
    const card = el("div", { class: "card" });
    card.appendChild(el("h3", { text: "データ" }));
    card.appendChild(el("p", { class: "sub", text: "全データ（人・プロジェクト・各モジュール）を JSON で書き出し／取り込みできます。" }));
    const exp = el("button", { class: "btn btn-primary", text: "全体バックアップ（JSON）" });
    exp.addEventListener("click", exportAll);
    const imp = el("button", { class: "btn btn-secondary", text: "JSON を取り込む" });
    imp.addEventListener("click", importAll);
    card.appendChild(el("div", { class: "mk-toolbar" }, [exp, imp]));

    // サンプルデータ
    card.appendChild(el("h3", { text: "サンプルデータ" }));
    card.appendChild(el("p", { class: "sub", text: "動作確認用に、人・プロジェクト・各モジュールへサンプルを投入します（既存データは置き換わります）。" }));
    const sample = el("button", { class: "btn btn-secondary", text: "サンプルデータを読み込む" });
    sample.addEventListener("click", () => {
      MK.ui.confirm("既存データをサンプルで置き換えます。よろしいですか？").then((ok) => {
        if (!ok) return;
        MK.sample.load();
        MK.ui.toast("サンプルデータを読み込みました", "success");
        route(S.current);
      });
    });
    card.appendChild(sample);

    // 全データの初期化（危険操作・Issue #176）。サイドバーには置かず設定内のみ（誤消去防止）。
    card.appendChild(el("h3", { text: "全データの初期化" }));
    card.appendChild(el("p", { class: "sub", text: "人・プロジェクト・各モジュールを含む全データ（mk: で始まる保存領域）を削除して初期状態に戻します。取り消せません。旧ツールのデータは削除されません。" }));
    const clearBackup = el("button", { class: "btn btn-secondary", text: "初期化前に全体バックアップ（JSON）" });
    clearBackup.addEventListener("click", exportAll);
    const clear = el("button", { class: "btn btn-danger", text: "全データを初期化" });
    clear.addEventListener("click", () => {
      MK.ui.confirm("全データを削除して初期状態に戻します。取り消せません。よろしいですか？").then((ok) => {
        if (!ok) return;
        MK.store.clearAll();
        MK.ui.toast("全データを初期化しました", "success");
        route("home");
      });
    });
    card.appendChild(el("div", { class: "mk-toolbar" }, [clearBackup, clear]));

    // 起動画面（spec §3.6）
    card.appendChild(el("h3", { text: "起動画面" }));
    card.appendChild(el("p", { class: "sub", text: "オンにすると起動時に前回開いていたモジュールを表示します（オフのときは HOME）。" }));
    const startCb = el("input", { type: "checkbox" });
    startCb.checked = getSettings().startView === "last";
    startCb.addEventListener("change", () => setSettings({ startView: startCb.checked ? "last" : "home" }));
    const startLabel = el("label", { class: "mk-toolbar", style: "gap:var(--space-xs);cursor:pointer;" }, [startCb, el("span", { text: "起動時に前回のモジュールを開く" })]);
    card.appendChild(startLabel);

    // 旧ツール移行（検出されたら表示。spec §7.5）
    const legacy = Object.keys(LEGACY_KEYS).filter((k) => localStorage.getItem(k) != null);
    if (legacy.length) {
      card.appendChild(el("h3", { text: "旧ツールから移行" }));
      card.appendChild(el("p", { class: "sub", text: "検出: " + legacy.join(", ") }));
      const mig = el("button", { class: "btn btn-secondary", text: "旧データを取り込む" });
      mig.addEventListener("click", () => migrateLegacy(legacy));
      card.appendChild(mig);
    }
    main.appendChild(card);
    main.appendChild(renderBackupFreshness());
    main.appendChild(renderStorageUsage());
    main.appendChild(renderModuleVisibility());

    if (MK.store.errors.length) {
      const warn = el("div", { class: "card", style: "margin-top:var(--space-md);border-color:var(--color-error);" });
      warn.appendChild(el("h3", { text: "⚠ 破損データ" }));
      MK.store.errors.forEach((e) => warn.appendChild(el("div", { class: "sub", text: e.key + ": " + e.message })));
      main.appendChild(warn);
    }
  }

  // バックアップ鮮度の可視化（Issue #223 / §10.1）。localStorage 一本の永続化では
  // 「バックアップし忘れ」がデータ全損に直結するため、最終の全体バックアップからの経過日数を
  // 常時表示し、閾値超過（未実施を含む）で警告とエクスポート導線を出す。判定は MK.io に置く。
  // 現在描画中の鮮度カード。エクスポート後はここだけ差し替える（設定画面ごと再描画すると
  // スクロール位置が先頭へ戻り、押したボタンが視界から消えるため）。
  let freshnessCard = null;

  function renderBackupFreshness() {
    const f = MK.io.backupFreshness();
    const card = el("div", { class: "card", style: "margin-top:var(--space-md);" + (f.stale ? "border-color:var(--color-error);" : "") });
    card.appendChild(el("h3", { text: "バックアップ鮮度" }));
    card.appendChild(el("p", { class: "sub", text: "データはこのブラウザの保存領域にのみ存在します。ブラウザのデータ削除・端末移行に備え、定期的に全体バックアップ（JSON）を取得してください。" }));
    const when = f.lastBackupAt
      ? (f.days === 0 ? "今日" : f.days + "日前") + "（" + f.date + "）"
      : "未実施";
    card.appendChild(el("div", { style: "font-weight:600;", text: "最終バックアップ: " + when }));
    if (f.stale) {
      card.appendChild(el("p", {
        class: "sub",
        style: "margin-top:var(--space-xs);color:var(--color-error);",
        text: f.lastBackupAt
          ? "⚠ 最後のバックアップから " + MK.io.BACKUP_STALE_DAYS + " 日以上経過しています。全体バックアップ（JSON）を取得してください。"
          : "⚠ まだ一度もバックアップを取得していません。全体バックアップ（JSON）を取得してください。",
      }));
      const btn = el("button", { class: "btn btn-primary", text: "全体バックアップ（JSON）" });
      btn.addEventListener("click", exportAll);
      card.appendChild(btn);
    }
    freshnessCard = card;
    return card;
  }

  // 鮮度カードが表示中なら、その場で作り直して差し替える（設定画面以外では何もしない）。
  function refreshBackupFreshness() {
    const old = freshnessCard;
    if (!old || !old.parentNode) return;
    old.parentNode.replaceChild(renderBackupFreshness(), old);
  }

  // ストレージ使用量の可視化（Issue #76 / §10.1）。閾値超過で警告表示し、
  // バックアップ導線（全体 JSON）を案内する。
  function renderStorageUsage() {
    const u = MK.store.usage();
    const pct = Math.round(u.ratio * 100);
    const warn = u.ratio >= USAGE_WARN_RATIO;
    const card = el("div", { class: "card", style: "margin-top:var(--space-md);" + (warn ? "border-color:var(--color-error);" : "") });
    card.appendChild(el("h3", { text: "ストレージ使用量" }));
    card.appendChild(el("p", { class: "sub", text: "ブラウザの保存領域（localStorage・約 5MB）の使用量です。上限に近づいたら不要データの整理と JSON バックアップを検討してください。" }));
    card.appendChild(el("div", { style: "font-weight:600;", text: formatBytes(u.bytes) + " / 約 " + formatBytes(u.quota) + "（" + pct + "%・" + u.count + " キー）" }));
    // 使用量バー
    const track = el("div", { style: "margin-top:var(--space-xs);height:8px;border-radius:4px;background:var(--color-hairline);overflow:hidden;" });
    const fill = el("div", { style: "height:100%;width:" + Math.min(100, pct) + "%;background:" + (warn ? "var(--color-error)" : "var(--color-primary)") + ";" });
    track.appendChild(fill);
    card.appendChild(track);
    if (warn) {
      card.appendChild(el("p", { class: "sub", style: "margin-top:var(--space-xs);color:var(--color-error);", text: "⚠ 使用量が上限の " + Math.round(USAGE_WARN_RATIO * 100) + "% を超えています。全体バックアップ（JSON）を取得し、不要なデータを整理してください。" }));
    }
    return card;
  }

  // モジュールの表示・非表示トグル（ゾーンでグルーピング。Issue #35）。
  // 変更は即ナビ・HOME へ反映する。非表示にしてもデータ・マスタ連携は保持される。
  function renderModuleVisibility() {
    const card = el("div", { class: "card", style: "margin-top:var(--space-md);" });
    card.appendChild(el("h3", { text: "モジュールの表示" }));
    card.appendChild(el("p", { class: "sub", text: "ナビと HOME に表示するモジュールを選びます。非表示にしてもデータは保持されます。" }));
    ZONES.forEach((zone) => {
      const mods = (zone.modules || []).filter((id) => META[id]);
      if (!mods.length) return;
      card.appendChild(el("h4", { class: "mk-home-zone", text: zone.label }));
      const list = el("div", { class: "mk-stack" });
      mods.forEach((id) => {
        const m = META[id];
        const cb = MK.ui.checkbox(!isHiddenModule(id));
        cb.addEventListener("change", () => { setModuleHidden(id, !cb.checked); S.renderNav(); });
        const label = (m.icon ? m.icon + " " : "") + m.title + (MK.modules[id] ? "" : "・準備中");
        list.appendChild(el("label", { style: "display:flex;gap:var(--space-xs);align-items:center;cursor:pointer;" }, [cb, el("span", { text: label })]));
      });
      card.appendChild(list);
    });
    return card;
  }

  function exportAll() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    const fname = "management-kun-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + ".json";
    MK.io.download(fname, MK.io.buildEnvelope("all"));
    // 全体バックアップのみ鮮度に数える（Issue #223）。記録の保存に失敗（容量超過等）しても
    // 書き出し自体は成功しているので、そのことを混同させない文面で伝える（store 側の
    // エラートーストと並んでも矛盾しない）。
    const recorded = MK.io.markBackup();
    MK.ui.toast(recorded
      ? "バックアップを書き出しました"
      : "バックアップを書き出しました（実行日時は記録できませんでした）", recorded ? "success" : "info");
    refreshBackupFreshness(); // 鮮度表示を即時更新する（設定画面を開いているときだけ効く）
  }

  function importAll() {
    const file = el("input", { type: "file", accept: ".json,application/json" });
    file.addEventListener("change", () => {
      const f = file.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        let env;
        try { env = JSON.parse(reader.result); } catch (e) { MK.ui.toast("JSON の読み込みに失敗しました", "error"); return; }
        MK.ui.modal({
          title: "取り込み方法",
          body: el("p", { text: "既存データへの取り込み方法を選んでください。" }),
          actions: [
            { label: "キャンセル", variant: "btn-secondary", onClick: (c) => c() },
            { label: "マージ", variant: "btn-secondary", onClick: (c) => { doImport(env, "merge"); c(); } },
            { label: "置換", variant: "btn-primary", onClick: (c) => { doImport(env, "replace"); c(); } },
          ],
        });
      };
      reader.readAsText(f);
    });
    file.click();
  }
  function doImport(env, mode) {
    try {
      MK.io.importEnvelope(env, mode);
      MK.ui.toast("取り込みました（" + mode + "）", "success");
      route(S.current);
    } catch (e) {
      MK.ui.toast(String(e.message || e), "error");
    }
  }

  // 旧データ移行（MVP: 実装済みモジュールのみ。名寄せは自動作成・spec §7.5/§8.4）
  function migrateLegacy(keys) {
    let done = 0;
    keys.forEach((k) => {
      const moduleId = LEGACY_KEYS[k];
      if (!MK.modules[moduleId]) return; // 未実装／未搭載モジュールは対象外
      let raw;
      try { raw = JSON.parse(localStorage.getItem(k)); } catch (e) { return; }
      if (moduleId === "todo") {
        const tasks = (raw && raw.tasks ? raw.tasks : []).map((t) => ({
          id: t.id || MK.util.uid("t"),
          title: t.title || "",
          notes: t.notes || "",
          status: t.status || "inbox",
          contexts: Array.isArray(t.contexts) ? t.contexts : [],
          projectId: t.project ? MK.projects.resolveOrCreate(t.project) : (t.projectId || null),
          due: t.due || null,
          createdAt: t.createdAt || MK.util.nowISO(),
          updatedAt: t.updatedAt || MK.util.nowISO(),
          completedAt: t.completedAt || null,
        }));
        MK.modules.todo.importData({ version: 1, tasks }, "merge");
        done++;
      } else if (moduleId === "wbs") {
        const tasks = (raw && raw.tasks ? raw.tasks : []).map((t) => ({
          id: t.id,
          level: t.level || 0,
          name: t.name || "",
          assigneeId: t.assignee ? MK.people.resolveOrCreate(t.assignee) : (t.assigneeId || null),
          start: t.start || "",
          end: t.end || "",
          progress: Number(t.progress) || 0,
          status: t.status || "notstarted",
          note: t.note || "",
          deps: Array.isArray(t.deps) ? t.deps : [],
          collapsed: !!t.collapsed,
        }));
        // wbs は scoped（§3.7.4）。旧ツールのデータは PJ に紐付かないので既定 PJ（先頭・無ければ作成）へ寄せる。
        const dim = MK.scope.dimOf(MK.modules.wbs.scope);
        const targetId = dim ? MK.scope.ensureDefaultTarget(dim) : null;
        MK.modules.wbs.importData({ version: 1, uid: raw.uid || 1, tasks }, "replace", targetId);
        done++;
      } else if (moduleId === "skills") {
        // メンバー→People、スキル→新ID、評価キーを新IDへ付け替え
        const memMap = {};
        (raw.members || []).forEach((m) => { memMap[m.id] = MK.people.resolveOrCreate(m.name); });
        const skillMap = {};
        const skills = (raw.skills || []).map((s) => {
          const nid = MK.util.uid("sk");
          skillMap[s.id] = nid;
          return { id: nid, domain: s.domain || "", item: s.item || "", description: s.description || "", visible: s.visible !== false, core: !!s.core, targetLevel: s.targetLevel != null ? s.targetLevel : null, requiredCount: s.requiredCount != null ? s.requiredCount : null };
        });
        const ratings = {};
        Object.keys(raw.ratings || {}).forEach((k) => {
          const parts = k.split(":");
          const nm = memMap[parts[0]], ns = skillMap[parts[1]];
          if (nm && ns) ratings[nm + ":" + ns] = raw.ratings[k];
        });
        MK.modules.skills.importData({ version: 1, skills, ratings }, "replace");
        done++;
      }
      // 旧・単一HTMLタスクツール（task-tool-data-v1 → 旧 workload）の取込分岐は Issue #167 で撤去した
      // （workload モジュール退役。負荷タスクの受け皿が無いため取り込まない。旧 workload 内部の
      //  アロケーションは起動時の MK.allocations.migrateFromWorkload() が store から吸い上げる）。
    });
    setSettings({ migration: { fromLegacyDone: true } });
    MK.ui.toast(done ? (done + " 件のツールを取り込みました") : "取り込める実装済みモジュールがありませんでした", done ? "success" : "info");
    route(S.current);
  }

  // scoped 化前の単一キー（mk:module:<id>:v1）を対象別キーへ移行する（§3.7.4 / §7 / Issue #25）。
  // 起動時に一度走ればよい（migrateLegacyScoped が旧キーを消すため冪等）。旧データが無ければ
  // 何もしない＝新規ユーザーへ余計な既定 PJ を作らない。
  function migrateScopedData() {
    MK.scope.dims().forEach((dim) => {
      Object.keys(MK.modules).forEach((id) => {
        const d = MK.scope.dimOf(MK.modules[id].scope);
        if (!d || d.dim !== dim.dim) return;                                  // この次元の scoped モジュールのみ
        if (localStorage.getItem(MK.store.keyOf("module:" + id)) == null) return; // 旧キーなし＝移行不要
        const targetId = MK.scope.ensureDefaultTarget(dim);                   // 既定 PJ へ寄せる
        if (targetId) MK.scope.migrateLegacyScoped(id, targetId);
      });
    });
  }

  S.renderSettings = renderSettings;
  S.exportAll = exportAll;
  S.importAll = importAll;
  S.migrateScopedData = migrateScopedData;
})();
