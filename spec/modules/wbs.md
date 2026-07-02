# wbs — WBS / ガント（旧 wbs-tool）（モジュール個別仕様）

統合上の位置づけ・共通マスタとの関係・固有データの所在を定める。共通の取り決め（アーキテクチャ・データ規格・名寄せ・デザイン）は [`spec.md`](../../spec.md)（共通仕様）を正とする。機能の詳細挙動は旧ツールの仕様を正とする。

- 参照（機能詳細の正）: [wbs-tool/spec.md](../../../wbs-tool/spec.md)
- localStorage: `mk:module:wbs:<projectId>:v1`（**project-scoped**。§3.7.4）。PJ ごとに物理分離する。
- ゾーン: **デリバリー**
- スコープ: `scope: { dim: "project" }`。シェルが現在の PJ 文脈を `ctx.scope` / 対象別 `ctx.store` で渡す（§3.7.3）。単一 PJ では縮退して従来どおり1つの WBS に見える（§3.7.2）。マスタ参照（担当メンバー）は横断のまま（PJ 外メンバーも参照可・§3.7.3）。

## 役割
階層 WBS + ガント + 依存（FS）+ クリティカルパス（軽量版・backlog）。

## 共通マスタ関係
`assignee`（文字列）を **Member 参照（`assigneeId`）へ移行**（[`spec.md`](../../spec.md) §4.4）。未解決の文字列は「未割当の表示名」として暫定保持し（`assigneeNameRaw`）、マスタ登録を促す（§8.6）。Project マスタとの関連は任意。

## 固有データ
- `tasks[]`（level / deps / progress / status 等）、`uid`。保存は PJ ごとの `mk:module:wbs:<projectId>:v1`（§3.7.4）。
- モジュール内部 ID は数値 `uid++` を維持する（`deps` が数値参照のため変更しない。[`spec.md`](../../spec.md) §4.7）。`uid` は PJ（対象別キー）ごとに独立して採番する。

## レイアウト
統合アプリの幅（~950px）ではテーブルがガントより広くなるため、**テーブルの上下にガントを積む**構成とする（旧ツールの左右並び＋縦スクロール同期は広幅向けの将来拡張）。ガントのバーにタスク名を載せ、単独でも読めるようにする。

## CSV
共通 CSV 規約（[`import-migration.md`](../import-migration.md) §4.6）で入出力する。担当者は**名前**、先行は WBS 番号で参照し、取込時に §8 名寄せへ通す。

| 列 |
|---|
| `WBS番号, タスク名, 担当者, 開始, 終了, 進捗, ステータス, 先行, 備考` |

## 旧データ移行
| 旧キー / 形状 | 移行先 |
|---|---|
| `wbs-tool-data-v1` `{uid, tasks}` ＋ 列幅 | 既定 PJ の `mk:module:wbs:<projectId>:v1`、`assignee` → Member 名寄せ |
| `mk:module:wbs:v1`（scoped 化前の単一キー） | 既定 PJ の `mk:module:wbs:<projectId>:v1` へ移送（起動時に自動・冪等） |

- **projectId 未確定分の扱い**: 旧データは PJ に紐付かないため、**既定 PJ へ寄せる**（先頭 PJ。無ければ「既定プロジェクト」を作成）。単一 PJ 環境ではそのままその1つに収まり、縮退で自然に見える。
- scoped 化前の単一キーの移送は `MK.scope.migrateLegacyScoped`（起動時に一度実行・旧キーを消すため冪等）。移送先キーが既にある場合は上書きしない。
- JSON エンベロープは PJ ごとに `modules.wbs.targets[<projectId>]` で束ねる（§4.2 との整合）。旧エンベロープ（単一 `modules.wbs.data`）は取込時に既定 PJ へ寄せる。

移行フロー全体は [`import-migration.md`](../import-migration.md) §7、名寄せは §8 を参照。
