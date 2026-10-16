# shutdown-error 仕様書

> 自動生成ファイル — `bun run gen:shutdown-error` で再生成。手動編集不可。  
> ソース: `scripts/gen-shutdown-error-artifacts.ts`

## 定数

| 定数 | 値 | レイヤー |
| --- | --- | --- |
| `SHUTDOWN_ERROR_MESSAGE` | `'Server is shutting down'` | Orchestrator 系プレフィックス |
| `WORKER_SHUTDOWN_ERROR_MESSAGE` | `'Manager is shutting down'` | Agent-Worker IPC 完全一致 |

## アクション一覧 (SHUTDOWN_ACTIONS)

| アクション | 生成されるエラーメッセージ |
| --- | --- |
| `start new execution` | `Server is shutting down, cannot start new execution` |
| `continue execution` | `Server is shutting down, cannot continue execution` |
| `resume execution` | `Server is shutting down, cannot resume execution` |

## HTTP ステータスコードマッピング

> ⚠️ 現状は未統一。下記は設計上の期待値であり、各 route が個別に HTTP ステータスを決定している。
> 503 を返す統一 middleware の実装は別起票（懸念バックログ）で追跡する。

| エラー種別 | 期待 HTTP ステータス | 実装状況 |
| --- | --- | --- |
| Orchestrator シャットダウン | 503 Service Unavailable | 未統一（各 route 次第） |
| Worker シャットダウン | 503 Service Unavailable | 未統一（各 route 次第） |

## 検出ロジック (isShutdownError)

| 入力 | 結果 | 理由 |
| --- | --- | --- |
| `Error('Manager is shutting down')` | `true` | `WORKER_SHUTDOWN_ERROR_MESSAGE` 完全一致 |
| `Error('Server is shutting down')` | `true` | `SHUTDOWN_ERROR_MESSAGE` 前方一致 |
| `Error('Server is shutting down, cannot start new execution')` | `true` | `Server is shutting down` 前方一致 |
| `Error('Server is shutting down, cannot continue execution')` | `true` | `Server is shutting down` 前方一致 |
| `Error('Server is shutting down, cannot resume execution')` | `true` | `Server is shutting down` 前方一致 |
| `Error('Manager is shutting down — extra text')` | `false` | Worker メッセージは完全一致のみ |
| `'Server is shutting down'` (string) | `false` | `instanceof Error` ではない |
| `null` / `undefined` | `false` | `instanceof Error` ではない |
