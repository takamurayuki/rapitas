# rapitas アーキテクチャ調査レポート

調査日: 2026-08-06 / 調査方法: 静的コード調査のみ(コード変更・実行なし)

## サマリ

- **調査対象コミット**: `5fa110d5e41798b97450fef5f583c23fcfef5134` (2026-08-05)
- **総評**: 依頼書の前提と実態は大きく 2 点で異なる — (1) エージェント実行の主体は Rust ではなく **TypeScript バックエンド(bun + Elysia)** であり、Rust/Tauri はシェルに徹している。(2) ロールは「5 中 3 稼働」ではなく **6 定義・モード依存で 3/4/5 稼働**(ただし reviewer は auto-run 経路で事実上到達不能)。その上で Cursor の知見との対応を見ると、rapitas は「決定的ゲート + 自己修復 reconciler の累積」という独自の耐久戦略を採っており、**単一の権威ある run 状態表現と副作用のイベント記録が欠けている**点が最大のギャップである。ストリーミングには rewind 語彙がなく、リトライで部分出力が重複表示される。一方、Workspace 抽象は現時点では過剰であり、ロールのツール化(順序移譲)は rapitas の防御構造(status 駆動の逆走ガード・fail-closed 予算・OS レベル読み取り専用サンドボックス)と正面衝突するため非推奨。
- **先行判断 3 点(コード量は小さいが、後続すべてのスキーマとチケット分割を規定する)**:
  0. **reviewer の去就決定** — 技術課題である前に**対外的な主張の正確性の問題**(「5 ロール稼働」と説明される comprehensive モードで reviewer は auto-run から一度も起動しない = 実質 4 ロール)。有効化(10〜40 行 + 自己参照ループへの上限ガード必須)か `WORKFLOW_ROLES` からの削除(+「4 実行ロール + 独立ゲート群」への説明変更)か。放置するほど「知っていて直さなかった」になる
  0'. **heartbeat/lease 列の設計**(下記アクション 1 の設計判断)
  0''. **run_id 境界の確定**(テーマ B の「run の境界定義」を参照。スキーマを触る前に決める)
- **優先度順の推奨アクション**:
  1. **実行主体の同一性の永続化(heartbeat/lease)** — `AgentExecution` に `owner_id`(worker/main のインスタンス識別子)+ `heartbeat_at` を追加。timestamp 起点比較(`createdAt < serverStartedAt`)の再発明ではなく lease 方式にする理由: 起点比較こそが今回のリークを生んだ構造であり、プロセス構成が変わるたびに再発する。副次効果として (a) worker 再起動リークの解消(heartbeat が N 秒古い running 行 = 死んでいる、起点不要)、(b) **テーマ A の所有権曖昧性(stop を両プロセスに投げる)が同じ列で解ける**、(c) `--resume` 対象を「heartbeat が死んでいて claudeSessionId がある行」と一意に表現できる — リークと所有権は別問題ではなく「実行主体の同一性が永続化されていない」という同一欠落の別症状
  2. **SSE 二重配信バグの単独修正**(`event-bridge.ts` の 2 重 broadcast × `*` 購読) — 最小差分・即効
  3. **`claudeSessionId` の毎フェーズ保存 + `--resume` 配管**によるフェーズ途中再開(既存配管あり、数十〜百行。1 の heartbeat 判定が前提)
  4. **`WorkflowTransition` の書き込み保証**(await/同一トランザクション化 → 失敗セマンティクス決定) — seq/runId 付与は**この後**。fire-and-forget のまま昇格させない
  5. **SSE への単調増加 seq 導入 → フロントの seq 付きログ構造化**(rewind の前提基盤。4 と器を共有)
  6. `report_blocked(reason)` の追加 — 新規機構ほぼ不要、既存 4 部品(durable-blocked-write / transition-recorder / blocked-cause / auto-run-notifications)の接続のみ

---

## 現状のアーキテクチャマップ(フェーズ0)

### 想定と実際が違った点(重要)

| 依頼書の想定 | 実際 |
|---|---|
| Rust がエージェントを走らせる(rg --type rust の手がかり) | **TS バックエンドが主体**。Tauri command にエージェント関連はゼロ(`main.rs:685-708`)。run 制御は全て HTTP(localhost:3001) |
| crate 分割されたワークスペース | Rust は単一 crate(シェル)。分割されているのは TS 側の backend/frontend/desktop |
| 5 ロール中 3 稼働 | **6 ロール定義**(`workflow-types.ts:14-23`: researcher/planner/reviewer/implementer/verifier/auto_verifier)。モードで 3(lightweight)/4(standard)/5(comprehensive)稼働。「5」の出所は `default-prompts-workflow.ts:4-5` の古いコメント("all five agent roles")と推定 |
| SQLite / ファイル / インメモリのどれか | **全部**: Prisma(dev=PostgreSQL / desktop=SQLite)+ SQLite 単体ファイル(knowledge-vectors.db 等)+ `.agent-pids/` 等のファイル + 2 プロセスのインメモリ Map |

### 構成

- **rapitas-backend**(bun/Elysia, :3001): API・Prisma・エージェント実行の主体。`workers/agent-worker.ts` を IPC 子プロセスとして 1 本起動し、Claude/Codex/Gemini CLI を spawn(`services/agents/claude-code/claude-execution-runner.ts:291`)。SSE 配信元。
- **rapitas-frontend**(Next.js 16, :3000): UI のみ。SSE + ポーリングで状態取得。
- **rapitas-desktop/src-tauri**(Rust): WebView ホスト・sidecar 管理(`release.rs`)・トレイ・ショートカット・音声・PTY。
- **rapitas-manager**(Flutter): 同一 SSE を購読する別クライアント(今回対象外)。

### 永続化(エージェント関連)

- `AgentSession`(`agents.prisma:25-46`): run の親。`mode='workflow-<role>'`、`worktreePath`、コスト集計。
- `AgentExecution`(`agents.prisma:106-135`): **1 フェーズ = 1 行**。`status`、`output`(全文 1 カラム)、`claudeSessionId`(--resume 用)、question 系。
- `AgentExecutionLog`(`agents.prisma:137-148`): チャンク + `sequenceNumber`。**seq 付き永続化は既に存在する**(が、ライブ配信は使っていない — テーマ C)。
- `WorkflowFile`/`WorkflowFileVersion`(`workflow.prisma:15-58`): 成果物 + 版スナップショット。
- `Task.workflowStatus`(`core.prisma:138`): ワークフローの「プログラムカウンタ」(可変 1 カラム)。
- `WorkflowTransition`(`workflow.prisma:130-155`): 唯一の append-only 遷移ログ。**runId/seq なし・fire-and-forget**(`transition-recorder.ts:8-9`)。
- ファイル: `.agent-pids/*.pid`、`logs/agent-executions/*.log`、`%TEMP%/rapitas-prompts/`、`.worktrees/task-*`。

### run のライフサイクル(手動実行)

`POST /tasks/:id/execute`(`execute-route.ts:103`)→ per-task mutex(`:132`)→ `executeSetup`(worktree + AgentSession)→ IPC → worker の `task-executor.ts:132`(AgentExecution 行作成)→ `:700` CLI spawn → close(`claude-execution-runner.ts:399`)→ `saveExecutionResult`(`:754`)→ `finally` でインメモリ掃除(`:785-791`)。HTTP は spawn 直後に返る(fire-and-forget)。**自動実行(ワークフロー)は別経路**で、メインプロセスの `AgentOrchestrator` を直接呼ぶ(`workflow-cli-executor.ts:137`)— この二重化がテーマ A の核心。

### ロールと遷移(フェーズ0 確認事項6)

遷移表は `workflow-mode-config.ts:313-334` の `buildTransitions` が DB トグルから毎回生成。lightweight = researcher→implementer→auto_verifier(3)、standard = +planner, verifier(4)、comprehensive = +reviewer(5)。**reviewer は auto-run のキューランナーが `plan_created` で必ず分岐して抜けるため到達不能**(`workflow-runner.ts:303-333`)— 手動実行ボタンでのみ起動可能で、しかも `nextStatus` が自分自身のため再入ループの素地がある(実運用での発生有無は未確認)。

---

## テーマ別の評価

### A. 状態の分離度

- **現状**: 「現在走っている run」は単一箇所では分からない。**三重〜四重管理**:
  1. DB `AgentExecution.status`(永続だがクラッシュ後は `running` のまま嘘をつく)
  2. worker プロセスの `AgentOrchestrator.activeExecutions`(`agent-orchestrator.ts:65-66`)
  3. メインプロセスの同クラス**別インスタンス**(ワークフロー実行用、`workflow-cli-executor.ts:137`)
  4. フロントの zustand `executingTasks`(`execution-state-store.ts:34`、非永続)+ `/tasks/:id/execution-status` の合成ビュー(`status-route.ts:82-122`: reset→none 読み替え、サブタスク execution への差し替え偽装)
  一覧 API は worker とメインの ID 集合を IPC で union してから DB を絞る(`agent-session-router.ts:107-138`)。停止は「所有者が分からないので両方に投げる」(`stop-task-agents.ts:31-54`)。この二重管理はコード内コメントで自覚的に文書化されている。
- **シナリオ**: (a) ウィンドウ閉→トレイ常駐で run 継続(`main.rs:721-729` prevent_close)。(b) バックエンドクラッシュ→起動時 `stale-execution-recovery.ts:24-172` が `interrupted` 化 + task を todo へ + worktree ポインタ pruning + 通知。ただし**同一プロセス内で worker だけが再起動したケースは `createdAt < serverStartedAt` 条件により回収されない**(リークポイント)。(c) CLI 子プロセス死→ close/error/idle-monitor の 3 経路で検知。(d) 重複操作→4 層ガード(フロント ref mutex / per-task in-memory mutex + 409 / auto-run 排他 / 継続ロック)。ただしロックはプロセスメモリのみで、永続ロックは PR 作成の CAS(`Task.prCreationLockedAt`)だけ。
- **判定**: **要改善(中)** — 「永続化はあるが二重管理」。
- **ギャップ**: (1) run の同一性を表す ID がない(フェーズごとに AgentSession/AgentExecution が新規)。(2) インメモリ真実(2 プロセス)と DB 真実の権威が未定義。(3) worker 再起動時の running 行リーク。
- **改善案**: フル・イベントストア化(依頼書の想定図)の前に、(a) **heartbeat/lease 方式**による死活判定 — `AgentExecution` に `owner_id` + `heartbeat_at` を追加し、「heartbeat が N 秒古い running 行 = 死んでいる」で判定する。当初案の `createdAt < workerStartedAt` への条件拡張は**採らない**: 起点 timestamp 比較こそが今回のリークを生んだ構造であり、別の起点に替えても同じ失敗モードが再発する。lease 化により本テーマの所有権曖昧性(stop の両プロセス投げ)も `owner_id` で同時に解ける。(b) `AgentWorkerManager` の嘘の同期 API(`agent-worker-manager.ts:310-346`)の廃止(非同期版へ統一)、(c) run 一覧の突き合わせロジックを 1 サービスに集約(lease 導入後は「DB の lease が生きている行」が単一の真実になり、突き合わせ自体を縮退できる)。
- **見積**: (a) スキーマ 2 列 + heartbeat 書き込み(実行ループ内) + 判定側の置換で百行台。(b)(c) 合計で 3〜5 ファイル・百行台。フル単一状態表現化はテーマ B の器(下記)に依存。
- **リスク**: 突き合わせロジックの変更は `/agents/resumable-executions` と auto-resume 機能に直結。回収対象を広げすぎると「生きている run を interrupted 扱いする」誤爆(過去に類似事故の防衛コメントが多数ある領域)。

### B. 耐久実行

- **現状**: ループは 3 層(ThemeAutoRunScheduler → WorkflowRunner の while(`workflow-runner.ts:209`) → advanceWorkflow = 1 フェーズ)。**フェーズ境界での再開は可能**(`Task.workflowStatus` がプログラムカウンタ、artifact 再利用 `isReusableArtifact` で research/plan はスキップ可)。**フェーズ途中の再開は不可能** — `claudeSessionId` は保存されるが、ワークフロー実行パスは `--resume` を渡さない(渡すのは質問継続と手動再開のみ: `continuation-agent-config.ts:61-62` / `resume-helpers.ts:117`)。副作用はイベントではなく上書き型状態(commit 非冪等、PR は DB CAS で冪等、WorkflowFile は upsert+版)。`WorkflowTransition` は fire-and-forget でループ上限カウンタの信頼性を自ら毀損している(`transition-recorder.ts:11-18` の自認コメント)。バージョンアップは `dev-restart-on-dry.ts:146-155` が示す通り「**実行中は再起動しない**」戦略で回避(タスク境界の静止点待ち)。
- **判定**: **要改善(中〜大)** — ただし依頼書の「起動したら走り切る前提」は半分だけ正しい(フェーズ粒度の再開は既にある)。
- **ギャップ**: (1) run をまたぐ ID がない。(2) 副作用のイベント記録がない(状態遷移の記録のみ)。(3) `workflowStatus` の書き手が 4 系統 + ループ外再入 2 箇所に分散し、防衛ガード(WF_STATUS_RANK 等)の累積で無害化している。(4) completion epilogue が 2 箇所に重複実装(`workflow-cli-executor.ts:752-941` と `workflow-handlers-files.ts:1039-1085`)。
- **run の境界定義(確定案)**: **1 run = 1 Task の 1 回のワークフロー走破(todo → completed / blocked / interrupted)**。フェーズごとの `AgentSession` / `AgentExecution` は run の子。中断後の再走破は**別の run_id**(これで「リトライ」と「継続」が履歴上区別できる)。artifact 再利用で research/plan をスキップした場合も、新 run の中に「スキップした」イベントを記録する。この定義を **4c(runId/seq 付与)より先に**置くこと — 後から意味を変えられない列になるため、スキーマを触る前に確定させる。
- **改善案**: 依頼書の「(run_id, seq, event_type, payload) 新設」は方向として正しいが、**新設よりも既存の `WorkflowTransition` を昇格させる方が摩擦が小さい**(runId/seq カラム追加、書き込みを fire-and-forget から保証付きへ、副作用イベント種別の追加)。並行して最小コスト・最大効果の **`--resume` 配管**(フェーズ実行パスで `claudeSessionId` を保存・再開時に渡す。失効検知 `session-resume-detector.ts:17-40` は既存。resume 対象は heartbeat/lease 導入後「lease が死んでいて claudeSessionId がある行」と一意に表現できる)。
- **見積**: `--resume` 配管 = 数十〜百行(`task-executor.ts` 周辺)。イベントログ昇格 = スキーマ + recorder 強化で数百行。**フル reducer 化はループ本体(workflow-runner 581 行 + orchestrator 1221 行 + cli-executor 1172 行)と副作用層に波及し数千行 + 同規模のテスト改修** — 一括では非推奨、reconciler と並行運転の段階導入が前提。
- **リスク**: 遷移の書き手 4 系統の統合は、エージェントのプロンプト(curl で保存させる設計)にまで遡る。ループ上限カウンタの移行期は二重計上/過少計上の両リスク。

### C. ストリーミング

- **現状**: 仮説どおり**追記のみ・rewind 語彙なし**。経路は CLI stdout → parser Worker → 4 方向ファンアウト(メモリ全文 / ファイル / DB チャンク / SSE イベント)→ IPC → SSE 2 チャンネル → フロント共有 EventSource → 到着順 append(`useExecutionStreamSSE.ts:114`)。識別子は executionId/sessionId のみで step/attempt/seq なし。SSE の `id` は `Date.now()-random` で全順序なし。リトライ時は出力を無効化する処理が 1 行もなく(`agent-retry.ts:141-159`)、フェーズリトライではフロントが意図的に旧ログを保持(追記)するため**重複表示**になる。画面復帰は SSE 追いつきではなく DB 差分フェッチ(バイトオフセット)。サーバ側のチャンネル履歴 + lastEventId 再送機構は存在するが、フロントが `*` 購読 + lastEventId 不使用のため**実質デッドコード**。
- **追加発見(バグ)**: `event-bridge.ts:104` と `:111` が同一データを `execution:{id}` と `session:{id}` に 2 回 broadcast し、フロントは `*` 購読で**両方受信** → 1 チャンクが 2 回 append される(静的解析。実測未確認)。ポーリング側にのみ連続重複ガードがあるのが傍証。
- **判定**: **要改善(中)**。
- **ギャップ**: (run_id, step_id, seq) の欠如、「この step の出力を破棄せよ」の表現不能、過去イベント再生の不能。
- **改善案**: 依頼書の方向どおり「イベントストアの上の薄い層」化。既に動いている `AgentExecutionLog.sequenceNumber` + `agent-audit-router.ts:66-72` の afterSequence カーソルを**ライブ経路に転用**するのが最短。実装順: (1) 二重 broadcast 修正(単独先行可)→ (2) バックエンド全経路に seq 採番(後方互換)→ (3) フロント logsRef を `{seq,text}[]` 化 + lastEventId 購読 → (4) rewind イベント + `rewindTo(seq)`。
- **見積**: バックエンド 7 ファイル / 200〜250 行 + マイグレーション 1(スキーマ 3 箇所同期)、フロント 5 ファイル / 180〜230 行、既存テスト 6 本改修。中規模。
- **リスク**: SSE/ポーリングのカーソル二重系(seq vs バイトオフセット)の整合。`useExecutionStreamSSE` の追記仕様は過去の「フェーズ境界で出力が消えた」不具合への対処なので、置換時に同症状の回帰に注意。

### D. ハーネスの厚み

- **現状**: 遷移は「DB 設定から生成される決定的ステートマシン」(`buildTransitions`)。エージェントが順序に影響する余地はゼロ(間接的には「どのファイルを保存したか」のみ)。プロンプトは 4 層合成(DB/既定 systemPrompt + 権威的モード指示 + role 別 context ビルダー + プロンプト進化の承認済み追記)。ロール固有ツール制約は 3 系統(claude `--disallowedTools`(investigation ロールは Bash/Write/Edit 剥奪)、gemini allowlist、codex OS read-only sandbox)。**`Task` ツール(再帰サブエージェント)は明示的に denylist されている**(`claude-execution-runner.ts:106`、理由コメント付き)。プロンプト自己進化は「候補生成→人間承認→追記注入」まで完成(`prompt-evolution-worker.ts`)、対象は 5 ロールの追記文のみ(auto_verifier 欠落、成功指標の設計不整合あり)。
- **判定**: 新ロール追加(既存パターン) = **数百行(10² オーダー)/約 20 ファイル**。reviewer の auto-run 有効化だけなら 10〜40 行(ただし nextStatus 自己参照と保存経路非対称の設計課題つき)。
- **両方式の比較**(rapitas の実態に基づく):

| 観点 | 固定ワークフロー(現状) | ロールのツール化 |
|---|---|---|
| 順序の決定者 | DB トグル→決定的生成 | エージェント(非決定的) |
| 逆走防止 | `ALLOWED_FILE_TYPES_BY_STATUS` で構造的に不可能 | 参照点消失、プロンプト依存に降格 |
| ループ上限 | Transition カウント + **fail-closed**(数え損ね=予算枯渇扱い) | エージェントの記憶=圧縮/再起動で消える |
| 人間承認 | `plan_created` でキューが構造的に停止 | エージェントが求めるまで止まらない(承認がエージェント判断に従属) |
| 読み取り専用保証 | OS/CLI レベル(investigation mode) | プロセス分離を保たない限り消滅 |
| 遅延ジャッジ整合性 | status への CAS(task 494/503 の実害から導入) | 決定的保証手段なし |
| ゲート仕様の隠蔽 | 実現済み(回避学習の防止) | ツール定義/エラーで露出 |
| 柔軟性 | 3 モード × 3 トグルの範囲 | 任意 |

- **rapitas での妥当性判定**: **固定ワークフロー継続が妥当**。Cursor の「ハーネスを削る」知見は、rapitas では「決定的ゲートは残し、順序決定は渡さない」と読み替えるべき。理由は表の左列がすべて実害(task 番号付きコメント)から逆算された防御であり、順序移譲はその大半を無効化するため。ただし**ハイブリッドは現実的**: `request_review()`(= adversarial-diff-review + phase-critic、いずれも引数が (taskId, worktreePath)/(phase, content) の純関数)と `run_verification()`(= runAutomatedVerification の能動呼び出し化)の**ゲートのツール化**は摩擦が小さく、Cursor の方向性とも整合する。
- **却下根拠の性質(将来の再評価用)**: この論証が示すのは「順序移譲は**現在の実装では**防御群を壊す」であって、「順序移譲と防御が**論理的に**両立しない」ではない。防御が status にキーされているのは実装上の結合であり必然ではなく、状態非依存の不変条件(例:「必要な検証イベントが揃うまでマージ不可」という表明ベースのゲート)に防御を組み直せば両立は原理的に可能。却下の真の根拠は**その組み直しコストが単独開発の射程を超える**こと。つまり「原理的に不可能」ではなく「コストが見合わない」— 前提(開発体制・防御の実装形)が変われば見直してよい判断である。
- **自己進化プロンプトへの影響**: ツール化(順序移譲)を採る場合、進化対象は「追記文」から「ツール選択戦略」へ変わるが、現在の学習信号(AgentSession.mode='workflow-<role>' 単位の成功率 + Transition cause 分布)は**ロール概念がキー**であり、spawn 単位の計測設計を作り直さない限り学習ループが切れる。固定ワークフロー継続なら現行の進化パイプラインをそのまま強化(auto_verifier 追加、成功指標を role-evidence と同じ補正に)できる — ただし固定継続の決定により「ツール選択戦略の学習」という再解釈は消えたため、**自己進化の優先度自体を再検討すべき**。プロンプト↔ゲート実装の乖離検出(静的チェック)の方が先に価値がある可能性が高い(実装順序の「独立した改善項目」を参照)。
- **リスク**: reviewer 有効化時の自己参照ループ(maxIterations=20 のみが上限)。プロンプト進化の指標修正は既存の承認済み addendum の再評価を要する。

### E. Workspace 抽象と自己診断

- **現状(E-1)**: 外部コマンド実行は `services/**` で 93 呼び出し / 15 ファイル(うち git-operations 82)。CLI spawn は 5 系統に重複実装(taskkill 6 箇所、`where` 6 箇所、`--version` 確認 5 箇所)。パス解決は 4 起点(getProjectRoot / process.cwd / RAPITAS_DATA_DIR / theme.workingDirectory)。分離は git worktree + preflight + primary ガード(CI でガードの存在自体を検査)だが、**非変更ロール(researcher/planner/reviewer)は worktree を作らず primary checkout の cwd で実行**(書き込みはツール剥奪で防止、cwd 共有は残る)。並列度既定 1 のため現状の衝突リスクは低い。
- **判定(E-1)**: **フル `interface Workspace` は過剰抽象化 — 不要**。リモート実装の予定がなく、テスト差し替えは関数注入/module mock で既に成立。`spawnStreaming`(idle 監視・stream-json と強結合)を含めると Workspace が実質エージェントランナーになる。
- **改善案(E-1)**: 抽象の代わりに重複除去 — (高) taskkill 6 箇所を既存 `killProcessTreeSafely` に一本化、(高) `resolveCliBinary(name)` に where/--version を集約(11 箇所)、(中) `GH_BIN` の `RAPITAS_GH_BIN` オーバーライド追加(1 行)、(中) `automated-verifier.ts:124` の git shell 文字列連結を execFile 化。
- **見積(E-1)**: 合計 100〜200 行の集約 + 置換。
- **現状(E-2)**: watchdog は 7 カテゴリ・20 機構超(idle/wall-clock kill、phase timeout 30 分、hang backstop 45 分、reconciler 8 パス、self-repair 3 種、auth fast-fail、worker/親生存監視、dev.js CPU/RSS)。全て監視側→エージェントの片方向。エージェント側からの申告は 3 経路(AskUserQuestion / question.md / 懸念起票)あるが、いずれも「質問」であり **blocked を自発的に書ける経路はない**(blocked は常にシステム側が書く)。黙った失敗の検知は非常に厚い(誠実性ゲート、GROUND TRUTH 注入、異プロバイダ陪審、改ざんトリップワイヤ、fail-closed 検証、カバレッジ強制)。
- **改善案(E-2)**: `report_blocked(reason)` は**既存 4 部品の接続だけで成立**: HTTP 受け口 → `writeBlockedStatusDurable`(リトライ + 通知エスカレーション込み)→ `recordTransition(cause='agent_self_report')`(blocked-cause 経由で UI 自動表示)→ `notifyOnce` パターンの通知。**必須の注意 2 点**: (1) hang backstop(45 分 force-stop + revert)の除外対象に加える(さもないと申告した瞬間に成果ごと revert される)、(2) investigation ロールは Bash/curl 禁止 + MCP ゼロのため、この経路は implementer/verifier 専用になる(investigation は question.md が既存の申告経路)。
- **見積(E-2)**: 受け口 + 接続 + スケジューラ述語で 100〜150 行。
- **プロンプトの確認バイアス**: 全体は良く抑制されている(「question.md は最後の手段」等)。**例外は `default-prompts-workflow-riv.ts:177, 179`** — implementer に「plan 外ファイル変更で停止」「設計判断で停止」を無条件要求。一方ゲート側は scope を advisory に緩和済み(`automated-verifier.ts:816-822`、#298 の実害による)で、**プロンプトとゲートが乖離している**。停止は無期限(hang backstop 対象外)かつ並列度 1 のため 1 停止 = テーマ全停止。この 2 行の条件付き緩和(「変更して verify.md に理由を記載、plan の意図と矛盾する場合のみ質問」)を推奨。
- **リスク**: report_blocked の cause を verify_repair 系と混ぜると `hasFreshVerifyRejection` 判定を汚染する。プロンプト緩和は scope 逸脱の増加と引き換え(ただしゲートは既に advisory)。

---

## 実装順序の提案

**先行判断 3 点**(いずれもコード量は小さいが、後続すべてのスキーマとチケット分割を規定する。実装より先に決着させる):
- **(i) reviewer の去就** — 有効化(+ 自己参照ループへの上限ガード)or `WORKFLOW_ROLES` から削除。対外説明の正確性の問題であり放置コストが時間とともに増える(サマリ 0 参照)
- **(ii) heartbeat/lease 列の設計** — `owner_id` + `heartbeat_at` の粒度・更新周期・失効閾値
- **(iii) run_id 境界の確定** — 「1 run = 1 Task の 1 回の走破」案(テーマ B 参照)

依存関係の要点: **A の lease 導入は B の `--resume` の前提条件**(leaked running 行が残ったまま resume を有効化すると、幽霊行への --resume / 生きているセッションの二重起動を区別できない)。**Transition の書き込み保証は seq 昇格の前提条件**(fire-and-forget のまま土台に昇格させると、後段すべてが「たまに欠損する履歴」の上に建つ)。C の seq 基盤は B のイベントログ昇格と器を共有できる。E は独立。並列度 ≥2 は下記「並列度を上げる前提条件」の 4 項目に依存。

1. **最優先(resume の前提)**: A の heartbeat/lease 導入(timestamp 起点比較の再発明はしない — テーマ A 改善案参照)
2. **即効・独立**: C-1 二重 broadcast 修正 / E の taskkill・CLI 解決の集約(重複排除 — 独立改善項目、下記参照) / E-2 プロンプト 2 行の緩和 / **prompt-evolution 指標修正 + 承認済み addendum の棚卸し**(付記 4 — 汚染の可能性があるためセットで必須)
3. **小型・高価値**(1 の後): B の `--resume` 配管(フェーズ途中再開) / E-2 `report_blocked`
4. **Transition の信頼性確保**(seq 昇格の前提。3 チケットに分解して順に):
   - 4a. `recordTransition` を await 化(または状態遷移と同一トランザクションへ)
   - 4b. 書き込み失敗時のセマンティクスを決定(遷移ごと失敗させるか、リトライキューに積むか)
   - 4c. その上で runId/seq を付与
5. **基盤**(2, 4a-b の後): C-2〜3 seq 採番 + フロント seq 化(= B のイベント基盤を兼ねる設計にする)
6. **中期**(4, 5 の後): 副作用イベントの追加。reconciler と並行運転
7. **長期・要判断**: フル reducer 化と completion epilogue 統合(数千行 + テスト同規模)。6 の運用実績を見てから判断
8. D は現状維持(reviewer の去就は先行判断 (i) で決着済みの前提)。ゲートのツール化(request_review/run_verification)は 6 と独立に着手可能。**reviewer を有効化する場合の注意**: nextStatus が自己参照(`plan_created`)のため、「maxIterations=20 以外に上限がない状態で自己ループ可能なロールを本番経路に入れる」ことになる — `WorkflowTransition` の cause カウントによる 1 プラン版あたり 1 回制限(既存の fail-closed パターン踏襲)を同時に入れること

### 並列度を上げる前提条件(横断的な依存)

「並列度既定 1 のため現状リスクは低い」を根拠に保留・軽減されている項目が本レポートに **4 つ**ある: (1) rewind プロトコルの完全実装(C)、(2) 非変更ロールの primary checkout cwd 共有(E-1)、(3) SSE の全順序欠如(複数ストリーム同時表示で顕在化)、(4) implementer 無条件停止のコスト(並列度 1 では 1 停止 = テーマ全停止という形で依存)。**並列度を 2 以上にする判断は単独の設定変更ではなく、この 4 項目が同時に活性化するトリガー**である。「並列度を上げるなら先にこの 4 つ」という依存を明示しておく。なおクラウド移行検討(別議論)のメリット筆頭は並列度だったため、**リモート実行に手を出す実質的な前提条件もこの 4 項目**ということになる。

### 独立した改善項目(却下とは別枠)

- **実行プリミティブの重複排除(E-1 由来)**: taskkill 6 箇所 / `where` 6 箇所 / `--version` 確認 5 箇所を各 1 系統へ集約。Workspace 抽象の却下とは独立に価値があり、**完了時点で将来 interface を切る差分がほぼゼロになる**(= 今やるべきは抽象化ではなく重複排除)。ロードマップ掲載に値する。
- **プロンプト↔実装の乖離検出(E-2 由来)**: implementer 2 行の乖離は「エラーにならず、進みの悪さとしてしか現れない」症状クラス(Cursor の「環境の不完全さは出力品質のわずかな劣化としてしか現れない」と同型)。ゲート定義からプロンプト記述を検証する**静的チェック**程度から始める。なお固定ワークフロー継続の決定により「自己進化プロンプト = ツール選択戦略の学習」という再解釈は成立しなくなったため、**自己進化プロンプトの位置づけは再検討が必要** — 乖離検出はそれより先に価値がある可能性が高い。

## 保留・却下すべき提案

| 提案 | 判断 | 理由 |
|---|---|---|
| **`interface Workspace` の導入(E-1)** | **却下** | リモート実装の予定がない現状、型の価値はテスト差し替えのみで、それは関数注入 + module mock で既に成立(`worktree-guard.ts:69` の WorktreeExecFn 等)。ストリーミング実行の強結合ライフサイクルを含めると抽象がエージェントランナー化する。真の問題は抽象の不在ではなく 5 系統の重複実装 — **重複排除自体は独立改善項目として採用**(実装順序の節を参照。完了すれば将来抽象を切る差分はほぼゼロになる) |
| **ロールのツール化(順序決定の移譲)(D)** | **却下**(ゲートのツール化のみ採用) | 逆走ガード・fail-closed ループ予算・承認ゲート・CAS 整合・OS レベル read-only の**全てが status 駆動**であり、順序移譲はこれらを同時に無効化する。`Task` ツールの denylist は明示的な設計判断(理由コメント付き)。Cursor の知見は「マシン状態の伝達をツール化」であり「制御フローの移譲」まで含意しない。**注**: 根拠は「原理的に不可能」ではなく「現実装との結合を組み直すコストが見合わない」(テーマ D の却下根拠の性質を参照) — 前提が変われば再評価対象 |
| **Temporal 型のフルイベントソーシング一括導入(B)** | **保留** | 触るべき本体 4,000〜5,000 行 + テスト同規模。「1 run = 1 短いワークフロー」への移行は方向として正しいが、run_id の境界定義すら未設計の現段階では、`WorkflowTransition` 昇格 → 並行運転 → 段階置換の順でしか安全に進められない |
| **「永続的ループをやめて短いワークフローの連鎖へ」の適用(B)** | **不要(既にほぼ達成)** | rapitas は既に「1 フェーズ = 1 プロセス spawn、完了で終了」の粒度。永続ループは runner のポーラだけで、これは Cursor の言う「バージョンアップ困難な長命ワークフロー」に該当しない。実際 `dev-restart-on-dry.ts` は静止点デプロイを実装済み |
| **rewind プロトコルの完全実装(クライアント巻き戻し)(C)** | **一部保留** | seq 導入と重複解消(実害あり)は推奨だが、「step retry で出力バッファ破棄」までの UI 価値は並列度既定 1 の現運用では限定的。並列度を上げる判断とセットで実施すべき |
| **エージェント自己修復(シークレット不足等の環境自己報告)の全面移植(E-2)** | **縮小採用** | rapitas の環境問題(auth 失効、quota、worktree 破損)は既に専用 fast-fail + 通知 + 自動フォールバックで個別対処済み。汎用 report_blocked は「上記に該当しない未知の詰まり」用の安全弁として小さく足すのが適切。investigation ロールには構造上届かない(ツール剥奪)ため、question.md との役割分担を維持 |

## 付記(調査中に発見した修正候補のバグ)

1. **SSE 同一チャンク二重配信**: `event-bridge.ts:104/:111` × `*` 購読(`realtime-service.ts:197`)。表示重複の直接原因になり得る(実測未確認)
2. **worker 再起動時の running 行リーク**: `recoverStaleExecutions` の `createdAt < serverStartedAt` 条件が同一プロセス内 worker 再起動をカバーしない
3. **reviewer の自己参照遷移**: `nextStatus: 'plan_created'`(自分と同じ)+ 手動実行経路でループの素地
4. **prompt-evolution の指標不整合 — 既存汚染の可能性あり**: 成功率が gate 差し戻しを completed と数える(role-evidence は補正済み)/ auto_verifier が対象外。**含意が重い**: 進化パイプラインは「ゲートに弾かれたセッション」を成功例として学習してきた可能性があり、その成果物(addendum)は人間承認を経て**現在稼働中のプロンプトに注入済み**。承認者に提示された根拠自体が誤っていたなら、承認はフィルタとして機能していない。したがって**指標修正と承認済み addendum の再評価はセットで必須**とする(現在何本承認済みか、各 addendum がどのセッション群を根拠に生成されたかの棚卸しを含む)。なお E-2 の implementer プロンプト乖離と合わせると「プロンプトが誤った方向に育つ経路」は 2 本(base の乖離 + 誤指標由来の addendum)あり、**「プロンプト↔ゲート実装の乖離検出」は両経路に効く共通の受け皿** — 独立改善項目としての優先度を一段引き上げる。
