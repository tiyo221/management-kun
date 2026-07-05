/* localStorage 永続化・マイグレーション spec §4.1 / §4.5 / §10.1 */
(function () {
  "use strict";
  const MK = window.MK;

  const SCHEMA_VERSION = 1;

  // localStorage の概算上限（多くのブラウザで 1 オリジンあたり約 5MB）。使用量比の分母に使う。
  const QUOTA_BYTES = 5 * 1024 * 1024;

  function keyOf(ns) { return "mk:" + ns + ":v1"; }

  // localStorage の全キーを列挙する（未対応環境や例外時は空配列）。
  function allKeys() {
    const out = [];
    try {
      const n = localStorage.length;
      for (let i = 0; i < n; i++) out.push(localStorage.key(i));
    } catch (e) { /* 列挙不可な環境では使用量 0 として扱う */ }
    return out;
  }

  // 保存容量超過（QuotaExceededError）の判定。ブラウザ差異を吸収する（§10.1）。
  function isQuotaError(e) {
    if (!e) return false;
    return e.name === "QuotaExceededError"
      || e.name === "NS_ERROR_DOM_QUOTA_REACHED"
      || e.code === 22 || e.code === 1014;
  }

  const store = {
    SCHEMA_VERSION,
    keyOf,
    _cache: {},   // ns -> object | null
    errors: [],   // 破損キーの記録
    lastWriteError: null, // 直近の書込失敗（テスト・案内用。成功時は null）
    onWriteError: null,   // 書込失敗時のフック（シェルが差し込む。既定は toast）

    // 起動時に全 mk: キーを個別 try/parse（壊れても他へ波及させない・§10.1）
    load() {
      this.errors = [];
      const namespaces = ["people", "projects", "allocations", "settings"];
      Object.keys(MK.modules).forEach((id) => namespaces.push("module:" + id));
      namespaces.forEach((ns) => {
        const raw = localStorage.getItem(keyOf(ns));
        if (raw == null) { this._cache[ns] = null; return; }
        try {
          this._cache[ns] = this._migrate(ns, JSON.parse(raw));
        } catch (e) {
          this._cache[ns] = null;
          this.errors.push({ ns, key: keyOf(ns), message: String(e) });
          console.error("破損データ:", keyOf(ns), e);
        }
      });
    },

    // ns ごとのマイグレーション連鎖を昇順適用（§4.5）
    _migrate(ns, data) {
      const chain = MK.migrations[ns] || [];
      let cur = data;
      chain.forEach((step) => {
        const v = cur && cur.version ? cur.version : 1;
        if (v < step.to) { cur = step.up(cur); cur.version = step.to; }
      });
      return cur;
    },

    // 起動時の load() は既知モジュールの "module:<id>" のみ prewarm する。scoped の
    // 対象別キー "module:<id>:<targetId>"（§3.7.4）は対象が実行時に決まるため、キャッシュ
    // 未登録なら localStorage から遅延ロードする（破損は §10.1 と同じく個別に握りつぶす）。
    read(ns) {
      if (ns in this._cache) return this._cache[ns];
      const raw = localStorage.getItem(keyOf(ns));
      if (raw == null) { this._cache[ns] = null; return null; }
      try {
        this._cache[ns] = this._migrate(ns, JSON.parse(raw));
      } catch (e) {
        this._cache[ns] = null;
        this.errors.push({ ns, key: keyOf(ns), message: String(e) });
        console.error("破損データ:", keyOf(ns), e);
      }
      return this._cache[ns];
    },

    // 書込は握りつぶさない（§10.1）。容量超過（QuotaExceededError）を検知したら
    // その旨と JSON バックアップ導線を案内する。失敗しても _cache には新値が残るため、
    // アプリはクラッシュせず操作を継続でき、そのまま JSON へ書き出して退避できる。
    // 戻り値: 保存できたら true、失敗したら false。
    write(ns, value) {
      this._cache[ns] = value;
      try {
        localStorage.setItem(keyOf(ns), JSON.stringify(value));
        this.lastWriteError = null;
        return true;
      } catch (e) {
        const quota = isQuotaError(e);
        this.lastWriteError = { ns, key: keyOf(ns), message: String(e), quota };
        console.error("保存失敗:", keyOf(ns), e);
        if (typeof this.onWriteError === "function") {
          try { this.onWriteError(this.lastWriteError); } catch (_) { /* 案内自体の失敗は無視 */ }
        } else if (MK.ui) {
          MK.ui.toast(quota
            ? "保存領域が上限に達しました。設定から JSON バックアップを取得してください。"
            : "保存に失敗しました: " + ns, "error");
        }
        return false;
      }
    },

    // mk: プレフィックスキーの合計使用量（概算）。UTF-16 前提で 1 文字 2 バイトとして
    // キー名＋値の長さから概算する。ratio は QUOTA_BYTES（約5MB）比。
    usage() {
      let bytes = 0, count = 0;
      allKeys().forEach((k) => {
        if (k == null || k.indexOf("mk:") !== 0) return;
        const v = localStorage.getItem(k) || "";
        bytes += (k.length + v.length) * 2;
        count++;
      });
      return { bytes, count, quota: QUOTA_BYTES, ratio: bytes / QUOTA_BYTES };
    },

    // モジュール用スコープアクセサ（自分の名前空間のみ・spec §3.5）
    scope(ns) {
      const self = this;
      return {
        get() { return self.read(ns); },
        // write() の戻り値（保存成否）を呼び出し元へ伝播する。容量超過などで false に
        // なった場合、モジュール側は保存されなかったことを判定できる（Issue #76 / PR #98）。
        set(value) { return self.write(ns, value); },
      };
    },
  };

  MK.store = store;
})();
