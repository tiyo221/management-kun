/* JSON エンベロープ入出力・CSV spec §4.2 / §4.3 / §4.6 */
(function () {
  "use strict";
  const MK = window.MK;
  const io = {};

  // scope: "all" | "people" | "projects" | "products" | "allocations" | "demands" | "<moduleId>"
  io.buildEnvelope = function (scope) {
    scope = scope || "all";
    const env = {
      schema: "management-kun",
      schemaVersion: MK.store.SCHEMA_VERSION,
      exportedAt: MK.util.nowISO(),
      scope,
    };
    // 共有マスタはレジストリ（#187）を1ループで舐めて詰める。未ロードのマスタは
    // 登録されないので載らない（旧 `MK.products && …` ガードと同義）。
    MK.masters.registry.forEach((m) => { env[m.key] = m.api.all(); });
    env.modules = {};
    MK.moduleOrder.forEach((id) => {
      const mod = MK.modules[id];
      if (!mod || typeof mod.exportData !== "function") return;
      if (scope !== "all" && scope !== id) return;
      const dim = MK.scope.dimOf(mod.scope);
      if (dim) {
        // scoped モジュール（§3.7.4）: 対象（PJ）ごとにデータを束ねて出す。
        // 復元時に対象別キーへ戻せるよう、targets を targetId で引ける形にする。
        const targets = {};
        MK.scope.entities(dim).forEach((e) => { targets[e.id] = mod.exportData(e.id); });
        env.modules[id] = { version: 1, scope: { dim: dim.dim }, targets };
      } else {
        env.modules[id] = { version: 1, data: mod.exportData() };
      }
    });
    // マスタ単体 scope なら、自分以外のマスタを空配列へ落とし modules を外す（従来の5行ぶんを1ループに）。
    if (MK.masters.registry.some((m) => m.key === scope)) {
      MK.masters.registry.forEach((m) => { if (m.key !== scope) env[m.key] = []; });
      env.modules = {};
    }
    return env;
  };

  io.downloadText = function (filename, text, mime) {
    const blob = new Blob([text], { type: (mime || "text/plain") + ";charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = MK.util.el("a", { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  io.download = function (filename, obj) {
    io.downloadText(filename, JSON.stringify(obj, null, 2), "application/json");
  };

  io.importEnvelope = function (env, mode) {
    if (!env || env.schema !== "management-kun") {
      throw new Error("対応していない形式です（schema 不一致）");
    }
    if (env.schemaVersion > MK.store.SCHEMA_VERSION) {
      throw new Error("新しいバージョンのデータです。アプリを更新してください。");
    }
    mode = mode === "merge" ? "merge" : "replace";

    // 共有マスタの取込はレジストリ（#187）× mode の1ループに畳む。people/projects が先頭に
    // 並ぶ読込順のおかげで、後続マスタ／モジュールの名寄せ参照が成立する。未ロードのマスタは
    // レジストリに載らないので取込対象から自然に外れる（旧 `MK.products && …` ガードと同義）。
    MK.masters.registry.forEach((m) => {
      const list = env[m.key];
      if (!Array.isArray(list) || !list.length) return;
      if (mode === "replace") m.api.replaceAll(list);
      else list.forEach((it) => (m.api.get(it.id) ? m.api.update(it.id, it) : m.api.create(it)));
    });
    Object.keys(env.modules || {}).forEach((id) => {
      const mod = MK.modules[id];
      if (!mod || typeof mod.importData !== "function") return;
      const entry = env.modules[id] || {};
      const dim = MK.scope.dimOf(mod.scope);
      if (entry.targets && typeof entry.targets === "object") {
        // 対象別 scope のエンベロープ（§3.7.4）: PJ ごとに対象別キーへ戻す。
        // people/projects は先に取り込み済みなので targetId（PJ id）が一致する。
        Object.keys(entry.targets).forEach((tid) => mod.importData(entry.targets[tid], mode, tid));
      } else if (dim) {
        // 旧エンベロープ（scoped 化前の単一 data）を scoped モジュールへ取り込む場合は
        // 既定の対象（先頭 PJ・無ければ作成）へ寄せる（データを失わない・§7 / Issue #25）。
        const tid = MK.scope.ensureDefaultTarget(dim);
        if (tid) mod.importData(entry.data, mode, tid);
      } else {
        mod.importData(entry.data, mode);
      }
    });
  };

  // ---- バックアップ鮮度（Issue #223 / §10.1）----
  // localStorage 一本の永続化では「バックアップし忘れ」が最も痛い事故になるため、全体バックアップ
  // （scope:"all" の JSON 書き出し）の最終実行日時だけを `mk:backup:v1` に持ち、設定画面で
  // 「最終バックアップ: n日前」を表示する。部分エクスポート（モジュール／人／PJ 単位）は
  // 全量を守らないので数えない。閾値は定数で持つ（設定項目は作らない・YAGNI）。
  io.BACKUP_STALE_DAYS = 14;

  /** 全体バックアップの実行を記録する。at 省略時は現在時刻。@returns {string} 記録した ISO 日時 */
  io.markBackup = function (at) {
    const iso = at || MK.util.nowISO();
    MK.store.write("backup", { version: 1, lastBackupAt: iso });
    return iso;
  };

  /**
   * 全体バックアップの鮮度を返す。未実施・記録が壊れている場合は「未実施」（stale）として扱う。
   * @param {string} [now] - 基準時刻の ISO 文字列（省略時は現在時刻。テスト用）
   * @returns {{lastBackupAt: string|null, date: string|null, days: number|null, stale: boolean}}
   */
  io.backupFreshness = function (now) {
    const rec = MK.store.read("backup");
    const last = rec && typeof rec.lastBackupAt === "string" ? rec.lastBackupAt : null;
    const t = last ? Date.parse(last) : NaN;
    if (isNaN(t)) return { lastBackupAt: null, date: null, days: null, stale: true };
    const base = now ? Date.parse(now) : Date.now();
    // 未来日時（時計ずれ・他端末からの取込）は 0 日前に丸める
    const days = Math.max(0, Math.floor((base - t) / 86400000));
    return { lastBackupAt: last, date: MK.util.fmtDate(new Date(t)), days, stale: days >= io.BACKUP_STALE_DAYS };
  };

  // ---- CSV（RFC4180 準拠の簡易実装・BOM 対応）spec §4.6 ----
  io.csv = {
    parse(text) {
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // 先頭 BOM 除去
      const rows = [];
      let row = [], field = "", i = 0, inQuotes = false;
      while (i < text.length) {
        const c = text[i];
        if (inQuotes) {
          if (c === '"') {
            if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
            inQuotes = false; i++; continue;
          }
          field += c; i++; continue;
        }
        if (c === '"') { inQuotes = true; i++; continue; }
        if (c === ",") { row.push(field); field = ""; i++; continue; }
        if (c === "\r") { i++; continue; }
        if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
        field += c; i++;
      }
      if (field.length || row.length) { row.push(field); rows.push(row); }
      return rows;
    },
    stringify(rows) {
      const esc = (v) => {
        const s = String(v == null ? "" : v);
        return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      return "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n"); // 出力は BOM 付き
    },
  };

  /**
   * CSV ファイルを選択させ、パース済みの行データをコールバックへ渡す共通ヘルパ（§4.6.2）。
   * モジュール view の「CSV取込」から使い、ファイル選択・読込・パースの重複実装をなくす。
   * 読込/パース失敗時は握りつぶさずエラートーストを表示する。
   * @param {(rows: string[][]) => void} onRows - パース済み行データを受け取るコールバック
   * @returns {void}
   */
  io.pickCsvFile = function (onRows) {
    const fail = () => MK.ui.toast("CSV の読み込みに失敗しました", "error");
    const input = MK.util.el("input", { type: "file", accept: ".csv,text/csv" });
    input.addEventListener("change", () => {
      const f = input.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => { try { onRows(io.csv.parse(reader.result)); } catch (e) { fail(); } };
      reader.onerror = fail;
      reader.readAsText(f);
    });
    input.click();
  };

  MK.io = io;
})();
