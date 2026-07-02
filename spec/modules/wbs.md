# wbs — WBS / ガント（旧 wbs-tool）（モジュール個別仕様）

統合上の位置づけ・共通マスタとの関係・固有データの所在を定める。共通の取り決め（アーキテクチャ・データ規格・名寄せ・デザイン）は [`spec.md`](../../spec.md)（共通仕様）を正とする。機能の詳細挙動は旧ツールの仕様を正とする。

- 参照（機能詳細の正）: [wbs-tool/spec.md](../../../wbs-tool/spec.md)
- localStorage: `mk:module:wbs:v1`
- ゾーン: **デリバリー**

## 役割
階層 WBS + ガント + 依存（FS）+ クリティカルパス（軽量版・backlog）。

## 共通マスタ関係
`assignee`（文字列）を **Member 参照（`assigneeId`）へ移行**（[`spec.md`](../../spec.md) §4.4）。未解決の文字列は「未割当の表示名」として暫定保持し（`assigneeNameRaw`）、マスタ登録を促す（§8.6）。Project マスタとの関連は任意。

## 固有データ
- `tasks[]`（level / deps / progress / status 等）、`uid`。`mk:module:wbs:v1`。
- モジュール内部 ID は数値 `uid++` を維持する（`deps` が数値参照のため変更しない。[`spec.md`](../../spec.md) §4.7）。

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
| `wbs-tool-data-v1` `{uid, tasks}` ＋ 列幅 | `mk:module:wbs:v1`、`assignee` → Member 名寄せ |

移行フロー全体は [`import-migration.md`](../import-migration.md) §7、名寄せは §8 を参照。
