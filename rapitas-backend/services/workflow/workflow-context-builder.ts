/**
 * Workflow Context Builder
 *
 * Assembles the prompt context string passed to each workflow role's agent.
 * Reads previously created workflow files and combines them with task metadata
 * and role-specific instructions. Does not execute agents or write files.
 */
import { prisma } from '../../config/database';
import { readWorkflowFile } from './workflow-file-utils';
import { buildMemoryContext } from './workflow-memory-context';
import { buildHypothesisContext } from './workflow-hypothesis-context';
import { buildRejectedPlanContext } from './workflow-rejected-plan-context';
import { buildCriticFeedback } from './phase-critic';
import type { WorkflowRole } from './workflow-types';

/**
 * Build the prompt context string appropriate for the given workflow role.
 *
 * Each role receives a tailored prompt that includes task metadata and any
 * previously generated workflow artifacts (research.md, plan.md, etc.).
 *
 * @param taskId - The task ID for context references. / コンテキスト参照用タスクID
 * @param role - The workflow role about to execute. / 実行するワークフロールール
 * @param dir - Absolute path to the workflow directory containing prior artifacts. / 既存成果物を含むワークフローディレクトリの絶対パス
 * @param task - Task title and description. / タスクのタイトルと説明
 * @param language - Output language for instructions. / 指示の出力言語
 * @returns Assembled context string ready to be appended to the agent prompt. / エージェントプロンプトに付加するコンテキスト文字列
 */
export async function buildRoleContext(
  taskId: number,
  role: WorkflowRole,
  dir: string,
  task: { title: string; description: string | null },
  language: 'ja' | 'en' = 'ja',
  mode: 'lightweight' | 'standard' | 'comprehensive' = 'comprehensive',
): Promise<string> {
  const texts = {
    ja: {
      taskInfo: `# タスク情報\n- **タイトル**: ${task.title}\n- **説明**: ${task.description || '(なし)'}\n- **タスクID**: ${taskId}`,
      researcher: {
        instruction: '上記のタスクについてコードベースを調査してください。',
        // NOTE: Premise audit (R2, roadmap) — LLMs critique premises well when
        // explicitly told to and almost never otherwise (PCBench); restating
        // claims as neutral questions counters sycophantic agreement.
        premiseAudit:
          '## 前提監査（必須・最初に実施）\n' +
          'タスク記述を鵜呑みにせず、調査の最初に前提を検証してください:\n' +
          '1. タスク記述が暗黙に仮定していること（原子仮定）を3〜7個列挙する。各仮定は依頼文の言い回しから切り離し、「〜は本当に成り立つか？」という**中立的な疑問文**に言い換える。\n' +
          '2. 各仮定をコードベースの実物・実測で検証し、`成立 / 不成立 / 未確認` を根拠 (file:line やコマンド結果) 付きで判定する。\n' +
          '3. 結果を research.md 冒頭の `## 前提監査` セクション（箇条書きまたは表）として必ず記載する。\n' +
          '4. **中核的な仮定が不成立**の場合（例: 報告された不具合が再現しない、依頼が前提とする機能・状態が存在しない、既に別の形で解決済み）、plan/実装に進まず `## 結論: 修正不要` で終了し、根拠に「前提誤り: どの仮定がなぜ不成立か」を明記する。\n' +
          '5. 前提は崩れたが調査中に**実在する別の問題**を発見した場合は、その事実を前提監査に記録した上で、実在する問題の調査として続行する。',
        items:
          '調査項目:\n- 既存コードの構造と依存関係\n- 変更が必要なファイルの特定\n- 類似実装の有無\n- リスクと影響範囲の評価',
        output:
          '調査結果をresearch.mdとしてMarkdown形式でまとめてください。\n\n' +
          '**重要**: 調査の結果、タスクの要件が既存コードで**既に満たされており修正が不要**だと判断した場合は、research.md の最後に必ずこの見出し行を入れてください: `## 結論: 修正不要`（直後に1〜2行で根拠を記載）。これにより plan/実装フェーズに進まず research 段階で完了でき、不要な再計画ループ（plan_invalid_replan）や重複PRを避けられます。本当に変更が必要な場合はこの行を書かないでください。',
      },
      planner: {
        researchHeader: '# リサーチャーの調査結果 (research.md)',
        instruction:
          '上記の調査結果を基に、実装計画をplan.mdとしてMarkdown形式で作成してください。\n\nチェックリスト形式で実装手順を記述し、変更予定ファイル一覧、リスク評価、完了条件を含めてください。',
      },
      reviewer: {
        researchHeader: '# 調査結果 (research.md)',
        planHeader: '# 実装計画 (plan.md)',
        instruction:
          '上記の計画をレビューし、リスク・不明点・改善提案をquestion.mdとしてMarkdown形式で作成してください。5つ以上の指摘事項を含めてください。',
      },
      implementer: {
        researchHeader: '# 調査結果 (research.md)',
        planHeader: '# 承認済み実装計画 (plan.md)',
        reviewHeader: '# レビュー指摘事項 (question.md)',
        // Lightweight workflow has no plan.md — implement straight from the
        // research and task instead of "following the plan".
        leadWithPlan:
          '上記の計画に従って実装を完了してください。計画に記載されたファイルの作成・編集を行い、コードを実装してください。',
        leadNoPlan:
          '上記の調査結果とタスク内容に基づいて実装を完了してください。必要なファイルの作成・編集を行い、コードを実装してください。',
        constraints:
          '## 実装者の責務 (厳守)\n' +
          '- あなたの仕事はコード変更だけです。**verify.md / research.md / plan.md は絶対に保存しないでください。**\n' +
          '- `curl` / `Invoke-RestMethod` / `wget` を使って `http://127.0.0.1:3001/workflow/...` を叩くことを禁じます。検証は次フェーズの verifier ロールが行います。\n' +
          '- 同様に `PUT /tasks/:id/status` などタスクステータスを変更する API も呼ばないでください。状態遷移は Rapitas 側が自動で行います。\n' +
          '- ワークフロー API を叩いても **400 で拒否されます** (status guard)。回避策の探索はせず、コード変更が終わったらそこで終了してください。\n' +
          '- 実装が完了したら、変更内容のサマリ (どのファイルを何のために変えたか) を最後のメッセージに残して終了してください。Rapitas が後段で verify.md を自動生成します。\n' +
          '- **テスト検証はファイル単位** (`bun test <1ファイル>`) で行ってください。bun の `mock.module` は**プロセスグローバル**なので、同じモジュールを mock する複数のテストファイルを**同時実行すると mock が衝突して偽の失敗**になります。これは bun の制約でありコードのバグではありません。**各ファイルが単体で通れば十分**です。複数テストファイルを「同時に通す」ためにモックの順序変更や beforeAll 化を延々と試みないでください（解決不能であり、時間を浪費します）。',
      },
      verifier: {
        planHeader: '# 実装計画 (plan.md)',
        diffHeader: '# 変更差分 (git diff)',
        instruction:
          '上記の計画と実装結果を検証し、verify.mdとしてMarkdown形式でレポートを作成してください。\n\n' +
          '計画チェックリストの消化状況、テスト結果、品質メトリクスを含めてください。\n\n' +
          '## 検証フェーズの厳守事項\n' +
          '### テスト結果は必ず実測値を記載してください (虚偽報告厳禁)\n' +
          '- `npm test` / `pnpm test` / `vitest` を実際に実行し、**最終行の集計** (`Tests N passed | M failed`、`Test Files X passed | Y failed`、終了コード) を verify.md に **コピペ** してください。\n' +
          '- テストコマンドが exit code 非0 で終わった場合、**「全テスト通過」と書くことを禁止** します。落ちたテスト名と失敗理由を箇条書きで列挙してください。\n' +
          '- テストが落ちている場合、verify.md の冒頭に `**❌ 検証失敗**` を必ず記載し、`## テスト失敗の概要` セクションで以下を記述:\n' +
          '  - 失敗テスト数 / 全テスト数\n' +
          '  - 各失敗テストのファイル名 + テスト名\n' +
          '  - スタックトレースまたは expected/received の差分\n' +
          '  - 推測される原因 (実装が plan と乖離した点)\n' +
          '- テスト実行が **環境エラー** (依存欠落、ネットワーク不通等) で完走しなかった場合は、その旨を `## テスト未完走` セクションに明記してください。「成功」とは決して書かないでください。\n' +
          '- bun のテストは **ファイル単位で実行・判定** してください (`bun test <1ファイル>`)。`mock.module` はプロセスグローバルのため、同じモジュールを mock する複数ファイルを**同時実行すると偽の失敗**が出ます。**各ファイルが単体で通れば「通過」と判定**してください（同時実行の失敗は bun の制約であり実装の不具合ではありません。検証ゲートも個別ファイルで実行します）。\n' +
          '\n### 変更が無い場合（既に実装済み・修正不要）の扱い ★重要\n' +
          '- まず `git diff` で実装者の変更を確認してください。**差分が空**（実装者がコードを変更していない）の場合、多くは「タスクの要件が既存コードで**既に満たされていた**」ことを意味します。\n' +
          '- その場合は verify.md に必ず明示的な**修正不要の結論**を記載してください（全体判定を `✅ 検証成功（修正不要）` とし、本文に `## 結論: 修正不要` 見出し ＋「既存実装で対応済み」である根拠を1〜2行）。**この justification が無いと完了ゲートが「無言のスキップ」と誤判定し、タスクを不当にブロック**します。\n' +
          '- 逆に、本当にやるべき変更が未実装（実装漏れ）で差分が空の場合は「修正不要」とは書かず、`❌ 検証失敗` とし残課題に未実装項目を明記して実装者へ差し戻してください。\n' +
          '\n### 必須セクション\n' +
          '```markdown\n' +
          '# 検証レポート\n' +
          '## 検証結果サマリ (✅ 検証成功 / ❌ 検証失敗 / ⚠️ 一部失敗 のいずれか)\n' +
          '## チェックリスト消化状況 (plan.md の各項目に ✅/❌)\n' +
          '## テスト結果 (実コマンド + 終了コード + 集計)\n' +
          '## 品質メトリクス (lint / type-check / build の結果)\n' +
          '## 残課題 / フォローアップ\n' +
          '## 仮説評価 (上記「仮説台帳」に検証待ち仮説がある場合のみ必須)\n' +
          '```\n' +
          '冒頭は必ず `# 検証レポート` で開始し、テストが1件でも落ちていれば `❌ 検証失敗` または `⚠️ 一部失敗` を選択してください。\n' +
          '上記「仮説台帳」に検証待ち仮説が列挙されている場合、`## 仮説評価` セクションで各仮説を1行 `- [#id] 成立|不成立: 根拠(file:line/テスト/計測)` で判定してください（成立は予測が実際に的中した場合のみ。確証が無ければ記載せず検証待ちのまま残す）。',
      },
    },
    en: {
      taskInfo: `# Task Information\n- **Title**: ${task.title}\n- **Description**: ${task.description || '(None)'}\n- **Task ID**: ${taskId}`,
      researcher: {
        instruction: 'Please investigate the codebase for the above task.',
        // NOTE: Premise audit (R2, roadmap) — see ja variant for rationale.
        premiseAudit:
          '## Premise audit (REQUIRED — do this first)\n' +
          'Do not take the task description at face value; audit its premises first:\n' +
          '1. List 3-7 atomic assumptions the task description implicitly makes. Restate each as a **neutral question** ("does X actually hold?") detached from the requester\'s framing.\n' +
          '2. Verify each assumption against the actual codebase / measurements and judge it `holds / does not hold / unverified`, with evidence (file:line or command output).\n' +
          '3. Record the results as a `## 前提監査` section at the top of research.md (bullets or table).\n' +
          '4. If a CORE assumption does not hold (the reported bug does not reproduce; the feature/state the request presumes does not exist; it is already solved another way), do NOT proceed to plan/implementation — finish with `## Conclusion: No change needed` and state "false premise: which assumption failed and why".\n' +
          '5. If the premise fails but you discover a REAL different problem, record that in the audit and continue investigating the real problem.',
        items:
          'Investigation items:\n- Existing code structure and dependencies\n- Identification of files that need changes\n- Presence of similar implementations\n- Risk assessment and impact analysis',
        output:
          'Please summarize the research results as research.md in Markdown format.\n\n' +
          '**Important**: If your investigation concludes the task requirement is ALREADY satisfied by existing code and no change is needed, you MUST end research.md with this exact heading line: `## Conclusion: No change needed` (followed by 1-2 lines of justification). This lets the task complete at the research phase instead of proceeding to plan/implementation — avoiding a wasted re-plan loop (plan_invalid_replan) and a duplicate PR. Do NOT write this line if any change is actually required.',
      },
      planner: {
        researchHeader: '# Research Results (research.md)',
        instruction:
          'Based on the research results above, please create an implementation plan as plan.md in Markdown format.\n\nDescribe implementation steps in checklist format, including a list of files to be changed, risk assessment, and completion criteria.',
      },
      reviewer: {
        researchHeader: '# Research Results (research.md)',
        planHeader: '# Implementation Plan (plan.md)',
        instruction:
          'Please review the plan above and create risks, unclear points, and improvement suggestions as question.md in Markdown format. Include at least 5 points of feedback.',
      },
      implementer: {
        researchHeader: '# Research Results (research.md)',
        planHeader: '# Approved Implementation Plan (plan.md)',
        reviewHeader: '# Review Feedback (question.md)',
        // Lightweight workflow has no plan.md — implement straight from the
        // research and task instead of "following the plan".
        leadWithPlan:
          'Please complete the implementation according to the plan above. Create and edit the files listed in the plan and implement the code.',
        leadNoPlan:
          'Please complete the implementation based on the research and task above. Create and edit the necessary files and implement the code.',
        constraints:
          '## Implementer Constraints (strict)\n' +
          '- Your job is code changes ONLY. **DO NOT save verify.md / research.md / plan.md.**\n' +
          '- DO NOT call `http://127.0.0.1:3001/workflow/...` via `curl` / `Invoke-RestMethod` / `wget`. Verification is performed by the verifier role in the next phase.\n' +
          '- DO NOT call `PUT /tasks/:id/status` or any task-status mutation API. State transitions are managed by Rapitas.\n' +
          '- The workflow API will return 400 if you try (status guard). Do not search for workarounds — finish when code changes are done.\n' +
          '- Once implementation is done, leave a short summary (which files changed and why) as your final message and exit. Rapitas auto-generates verify.md downstream.\n' +
          "- **Verify tests PER FILE** (`bun test <one-file>`). Bun's `mock.module` is PROCESS-GLOBAL, so two test files that mock the same module conflict and produce FALSE failures when run together. That is a bun limitation, not a code bug. **Each file passing in isolation is sufficient.** Do NOT keep reordering mocks or moving imports into beforeAll trying to make multiple test files pass together — it is unsolvable and wastes time.",
      },
      verifier: {
        planHeader: '# Implementation Plan (plan.md)',
        diffHeader: '# Changes (git diff)',
        instruction:
          'Please verify the implementation plan and results above, and create a report as verify.md in Markdown format.\n\n' +
          'Include the completion status of the plan checklist, test results, and quality metrics.\n\n' +
          '## Verification phase strict rules\n' +
          '### Report ACTUAL test results (no false claims)\n' +
          '- Run `npm test` / `pnpm test` / `vitest` for real and **paste the summary line** (`Tests N passed | M failed`, `Test Files X passed | Y failed`, exit code) into verify.md.\n' +
          '- If the test command exits non-zero, you are **forbidden from writing "all tests pass"**. List failing tests by name with their reason.\n' +
          '- If tests fail, mark verify.md with `**❌ Verification Failed**` at the top and add a `## Test Failure Summary` section listing per-test failures, stack traces / expected-vs-received, and the suspected root cause (plan deviation).\n' +
          '- If tests could not run due to environment errors (missing deps, network, …), say so explicitly under `## Tests Did Not Complete`. Never claim success.\n' +
          '- Run and judge bun tests **PER FILE** (`bun test <one-file>`). `mock.module` is process-global, so running multiple files that mock the same module together yields FALSE failures. **Treat each file passing in isolation as a pass** (the failure-when-combined is a bun limitation, not an implementation defect; the verification gate also runs files individually).\n' +
          '\n### When there are NO changes (already implemented / no fix needed) ★IMPORTANT\n' +
          '- First check the implementer’s changes with `git diff`. An **EMPTY diff** (the implementer changed no code) usually means the task’s requirement was **already satisfied** by existing code.\n' +
          '- In that case verify.md MUST state an explicit **no-change conclusion** (set the overall verdict to `✅ Pass (no change needed)` and add a `## 結論: 修正不要` heading with a 1–2 line reason that existing code already covers it). **Without this justification the completion gate misreads it as a silent skip and wrongly BLOCKS the task.**\n' +
          '- Conversely, if the diff is empty because work that SHOULD have been done was not (a real miss), do NOT write “no change needed” — mark `❌ Fail` and list the unimplemented items under outstanding work to bounce it back to the implementer.\n' +
          '\n### Required sections\n' +
          '```markdown\n' +
          '# Verification Report\n' +
          '## Result summary (✅ Pass / ❌ Fail / ⚠️ Partial)\n' +
          '## Checklist status (each plan item ✅/❌)\n' +
          '## Test results (actual command + exit code + summary)\n' +
          '## Quality metrics (lint / type-check / build)\n' +
          '## Outstanding work / follow-ups\n' +
          '## 仮説評価 (required ONLY when the 仮説台帳 above lists open hypotheses)\n' +
          '```\n' +
          'Start with `# Verification Report`. If even one test fails, choose `❌ Fail` or `⚠️ Partial`.\n' +
          'When the 仮説台帳 above lists open hypotheses, add a `## 仮説評価` section judging each as `- [#id] 成立|不成立: evidence(file:line/test/metric)` (成立 only when the prediction actually held; omit any you cannot confirm, leaving it open).',
      },
    },
  };

  const t = texts[language];
  const taskInfo = t.taskInfo;

  switch (role) {
    case 'researcher': {
      // Inject prior knowledge so research starts from what we already learned
      // (similar tasks, past concerns, lessons) instead of a blank slate.
      const memory = await buildMemoryContext(taskId, task, language);
      const memoryBlock = memory ? `\n\n${memory}` : '';
      // Hypothesis ledger: surface open conjectures to test + proven findings, and
      // tell the researcher to record evidence / file new hypotheses as it learns.
      const hypothesis = await buildHypothesisContext(taskId, language);
      const hypothesisBlock = hypothesis ? `\n\n${hypothesis}` : '';
      // On a critic-gate bounce, lead with the issues the prior research missed.
      const critic = await buildCriticFeedback(taskId, 'research', language);
      const criticBlock = critic ? `\n\n${critic}` : '';
      // Mode-aware framing: in lightweight mode NO plan phase follows, so research
      // must be implementation-ready; in plan modes research can defer detailed
      // steps to the planner. Without this, research.md was always written
      // assuming a plan would follow — wrong for lightweight tasks.
      const modeBlock = `\n\n${researchModeDirective(mode, language)}`;
      return `${taskInfo}${criticBlock}${modeBlock}${memoryBlock}${hypothesisBlock}\n\n${t.researcher.instruction}\n\n${t.researcher.premiseAudit}\n\n${t.researcher.items}\n\n${t.researcher.output}`;
    }

    case 'planner': {
      const research = await readWorkflowFile(dir, 'research');
      let ctx = taskInfo;
      // On a critic-gate bounce, lead with the issues the prior plan missed.
      const planCritic = await buildCriticFeedback(taskId, 'plan', language);
      if (planCritic) {
        ctx += `\n\n${planCritic}`;
      }
      // Recall prior knowledge for the planner too — recorded design decisions
      // and blocked-task lessons should shape the plan, not be re-discovered
      // (or re-violated) at implementation time. Previously only researcher and
      // implementer received memory, so the planner re-decided settled points.
      const plannerMemory = await buildMemoryContext(taskId, task, language);
      if (plannerMemory) {
        ctx += `\n\n${plannerMemory}`;
      }
      // Recall human rejections of prior plans in this theme so the new plan
      // addresses them instead of repeating a turned-down design.
      const rejected = await buildRejectedPlanContext(taskId, language);
      if (rejected) {
        ctx += `\n\n${rejected}`;
      }
      if (research) {
        ctx += `\n\n${t.planner.researchHeader}\n\n${research}`;
      }
      ctx += `\n\n${t.planner.instruction}`;
      return ctx;
    }

    case 'reviewer': {
      const plan = await readWorkflowFile(dir, 'plan');
      const research = await readWorkflowFile(dir, 'research');
      let ctx = taskInfo;
      if (research) {
        ctx += `\n\n${t.reviewer.researchHeader}\n\n${research}`;
      }
      if (plan) {
        ctx += `\n\n${t.reviewer.planHeader}\n\n${plan}`;
      }
      ctx += `\n\n${t.reviewer.instruction}`;
      return ctx;
    }

    case 'implementer': {
      const plan = await readWorkflowFile(dir, 'plan');
      const question = await readWorkflowFile(dir, 'question');
      const research = await readWorkflowFile(dir, 'research');
      // On a self-repair bounce, verify/CI failure feedback is written to
      // verify.md (not question.md) — read it so the implementer fixes it.
      const verifyFeedback = await readWorkflowFile(dir, 'verify');
      let ctx = taskInfo;
      // Recall prior knowledge for the implementer too — known pitfalls and past
      // design decisions should steer the actual code changes, not just research.
      const memory = await buildMemoryContext(taskId, task, language);
      if (memory) {
        ctx += `\n\n${memory}`;
      }
      // Hypothesis ledger: the implementer's concrete changes + test results are
      // prime evidence — surface open/proven hypotheses and how to record it.
      const hypothesis = await buildHypothesisContext(taskId, language);
      if (hypothesis) {
        ctx += `\n\n${hypothesis}`;
      }
      if (research) {
        ctx += `\n\n${t.implementer.researchHeader}\n\n${research}`;
      }
      if (plan) {
        ctx += `\n\n${t.implementer.planHeader}\n\n${plan}`;
      }
      if (question) {
        ctx += `\n\n${t.implementer.reviewHeader}\n\n${question}`;
      }
      if (verifyFeedback) {
        const header =
          language === 'ja'
            ? '# 検証 / CI からの差し戻し（前回の失敗 — 必ず対応すること）'
            : '# Verification / CI feedback (previous failure — must address)';
        ctx += `\n\n${header}\n\n${verifyFeedback}`;
      }
      const implementerLead = plan ? t.implementer.leadWithPlan : t.implementer.leadNoPlan;
      ctx += `\n\n${implementerLead}\n\n${t.implementer.constraints}`;
      // Bug-fix tasks: require a reproducing test BEFORE the fix (R4). The
      // verification gate enforces "a test file changed" for these tasks, so
      // tell the implementer up front instead of bouncing it later.
      const { looksLikeBugFixTask } = await import('../agents/verification/automated-verifier');
      if (looksLikeBugFixTask(`${task.title}\n${task.description ?? ''}`)) {
        ctx +=
          language === 'ja'
            ? '\n\n## バグ修正の必須手順（検証ゲートで強制されます）\n' +
              '1. 修正の**前に**、不具合を再現する失敗テストを書き、現状コードで失敗することを確認する。\n' +
              '2. 修正を実装し、そのテストが通ることを確認する（fail→pass が完了の根拠）。\n' +
              '3. 再現テスト（または回帰テスト）の追加・更新なしのバグ修正は検証ゲート (coverage) で差し戻されます。UI操作のみで再現するなどテスト化が本当に不可能な場合のみ、その理由を最終サマリに明記してください。'
            : '\n\n## Bug-fix protocol (enforced by the verification gate)\n' +
              '1. BEFORE fixing, write a failing test that reproduces the defect and confirm it fails on the current code.\n' +
              '2. Implement the fix and confirm that test now passes (the fail→pass transition is the completion evidence).\n' +
              '3. A bug fix without an added/updated reproducing (or regression) test is bounced by the coverage gate. Only when a test is genuinely impossible (e.g. UI-interaction-only repro) state the reason in your final summary.';
      }
      return ctx;
    }

    // NOTE: auto_verifier shares the verifier context — both must emit the validator-required headings
    case 'auto_verifier':
    case 'verifier': {
      const plan = await readWorkflowFile(dir, 'plan');
      let ctx = taskInfo;
      // Recall prior knowledge for the verifier too — failure lessons from
      // similar tasks tell it exactly which regressions to probe for.
      const verifierMemory = await buildMemoryContext(taskId, task, language);
      if (verifierMemory) {
        ctx += `\n\n${verifierMemory}`;
      }
      // Hypothesis ledger: the verifier is the ONLY phase that explicitly JUDGES
      // whether each open hypothesis's prediction held — its `## 仮説評価` verdicts
      // graduate (成立→validated) / refute (不成立→rejected) them. Without this the
      // directive never reached the verifier and the ledger never graduated
      // anything (every entry stuck at 検証待ち). Surfaces the open hypotheses (with
      // ids) the verifier must evaluate.
      const hypothesis = await buildHypothesisContext(taskId, language);
      if (hypothesis) {
        ctx += `\n\n${hypothesis}`;
      }
      if (plan) {
        ctx += `\n\n${t.verifier.planHeader}\n\n${plan}`;
      }
      // Append the branch diff so the verifier reviews ACTUAL changes, using the
      // agent's worktree and getDiff's merge-base. (The old `git diff HEAD~1` at
      // process.cwd() was wrong: it diffed the main checkout, not the worktree,
      // and assumed exactly one commit.) Only run when a worktree session exists
      // — diffing the live checkout (cwd) is both wrong and expensive (it would
      // run a full per-file diff over the whole rapitas repo).
      const diffSession = await prisma.agentSession
        .findFirst({
          where: { config: { taskId }, worktreePath: { not: null } },
          // Secondary `id` key breaks ties on identical createdAt timestamps —
          // otherwise which session diff gets shown to the verifier could
          // vary across identical re-runs.
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { worktreePath: true },
        })
        .catch(() => null);
      if (diffSession?.worktreePath) {
        try {
          const { getDiff } = await import('../agents/orchestrator/git-operations/diff-structured');
          const records = await getDiff(diffSession.worktreePath).catch(() => []);
          const patches = records
            .map((r) => r.patch)
            .filter((p): p is string => !!p && p.trim().length > 0)
            .join('\n');
          const fallbackList = records
            .map((r) => `${r.status}\t${r.filename} (+${r.additions}/-${r.deletions})`)
            .join('\n');
          const diffText = patches || fallbackList;
          if (diffText.trim()) {
            ctx += `\n\n${t.verifier.diffHeader}\n\n\`\`\`diff\n${diffText.substring(0, 50000)}\n\`\`\``;
          }
        } catch {
          // Continue even if diff retrieval fails — verify.md can still be written.
        }

        // GROUND TRUTH: run the SAME automated lint/typecheck/test gate the PR
        // pipeline uses, on the agent's worktree, and inject its REAL result. The
        // verifier was observed FABRICATING "全テスト通過 224/224" for work whose
        // tests actually fail (or that wasn't even committed) — self-reported test
        // results are unreliable. Anchoring verify.md to the measured result kills
        // the hallucination at the source AND stops the prose honesty-gate from
        // false-bouncing a genuinely-green change. Fail-soft: if the verifier
        // crashes/skips, the verifier falls back to self-report (status quo).
        try {
          const [{ runAutomatedVerification, renderVerificationMarkdown }, planForGate] =
            await Promise.all([
              import('../agents/verification/automated-verifier'),
              readWorkflowFile(dir, 'plan'),
            ]);
          const measured = await runAutomatedVerification(diffSession.worktreePath, {
            planContent: planForGate ?? undefined,
          }).catch(() => null);
          if (measured) {
            const header =
              language === 'ja'
                ? '# 自動検証の実測結果（worktree で実行済み・GROUND TRUTH）'
                : '# Automated verification — MEASURED on the worktree (GROUND TRUTH)';
            const rule =
              language === 'ja'
                ? `> **これは worktree に対し実際に実行した lint/型/テストの結果です（総合: ${measured.ok ? '✅ 合格' : '❌ 失敗'}）。** verify.md の「テスト結果」「品質メトリクス」「総合判定」はこの実測と矛盾してはならない。実測が ❌ なら verify.md も ❌ 検証失敗 とし、合格を捏造しないこと。実測が ✅ なら自信を持って合格と記載してよい。`
                : `> **These are lint/type/test results actually RUN on the worktree (overall: ${measured.ok ? '✅ pass' : '❌ fail'}).** verify.md's test-results / quality-metrics / overall verdict MUST NOT contradict this. If measured ❌, mark verify.md ❌ Fail — never fabricate a pass. If measured ✅, you may confidently report pass.`;
            ctx += `\n\n${header}\n\n${rule}\n\n${renderVerificationMarkdown(measured)}`;
          }
        } catch {
          // Fail-soft — verify.md can still be written from the agent's own checks.
        }
      }
      // Lightweight workflow has no plan.md — verify against the task/research
      // requirements instead of a plan checklist that doesn't exist.
      let verifierInstruction = t.verifier.instruction;
      if (!plan) {
        verifierInstruction = verifierInstruction
          .replace('上記の計画と実装結果を検証し', '上記の実装結果を検証し')
          .replace(
            '## チェックリスト消化状況 (plan.md の各項目に ✅/❌)',
            '## 要件の充足状況 (タスク要件・調査内容に対して ✅/❌)',
          )
          .replace(
            'Please verify the implementation plan and results above',
            'Please verify the implementation results above',
          )
          .replace(
            '## Checklist status (each plan item ✅/❌)',
            '## Requirement coverage (each task requirement ✅/❌)',
          );
      }
      ctx += `\n\n${verifierInstruction}`;
      return ctx;
    }

    default:
      return taskInfo;
  }
}

// High-priority mode directives prepended to the implementer/verifier SYSTEM
// prompt. The seed role prompts are written around plan.md, but the lightweight
// (research→implement→verify) workflow produces no plan. These directives are
// authoritative ("overrides any other instruction") so they correct an
// already-stored / user-edited DB prompt without rewriting it, and complement
// the plan-agnostic seed for fresh installs.

/**
 * Mode-aware framing for the RESEARCHER. In lightweight mode no plan phase
 * follows, so research must be implementation-ready (concrete files / approach /
 * test plan); in plan modes research may defer detailed steps to the planner.
 *
 * @param mode - The resolved workflow mode. / 解決済みワークフローモード
 * @param language - Output language. / 出力言語
 * @returns A directive block prepended to the researcher context. / 調査者向け指示ブロック
 */
export function researchModeDirective(
  mode: 'lightweight' | 'standard' | 'comprehensive',
  language: 'ja' | 'en' = 'ja',
): string {
  if (mode === 'lightweight') {
    return language === 'ja'
      ? `## 実行モード: 軽量（plan フェーズなし）
このタスクは軽量モードで実行され、**後続に計画(plan)フェーズはありません**。調査結果はそのまま実装に使えるよう、**変更対象ファイル・具体的な修正方針・テスト方針**まで具体化してください。判断を後続の計画へ先送りしないでください。`
      : `## Execution mode: lightweight (NO plan phase)
This task runs in lightweight mode — **no planning phase follows**. Make the research implementation-ready: name the target files, the concrete fix approach, and the test plan. Do NOT defer decisions to a later plan.`;
  }
  return language === 'ja'
    ? `## 実行モード: ${mode === 'comprehensive' ? '詳細' : '標準'}（plan フェーズあり）
このタスクは後続で**計画(plan)フェーズ**が実行されます。調査では事実・依存関係・リスク・既存実装の把握に集中し、詳細な実装手順は計画フェーズに委ねて構いません。`
    : `## Execution mode: ${mode} (plan phase follows)
A planning phase will run after this. Focus the research on facts, dependencies, risks, and existing implementation; the detailed implementation steps can be left to the plan phase.`;
}

const IMPLEMENTER_NO_PLAN_DIRECTIVE = `## 実行モード: 調査→実装→検証（plan.md なし） — 他のどの指示よりも優先

このタスクには **plan.md がありません**（軽量ワークフローは計画フェーズを実施しません）。
**あなたは「実装」フェーズの担当です。今すぐコードを実装してください。**
- **plan.md を新規作成・保存しないでください。** あなたの成果物は plan.md ではなく**コードの変更**です。research.md とタスク要件を読んだら、調査やレポートで止まらず **Write/Edit でコードを編集**してください。CLAUDE.md に「Step 2 — Plan / plan.md を作成」とあっても、このフェーズでは従わないでください（フェーズ遷移は orchestrator が管理します）。
以下のロール説明に「plan.md」「承認された計画」「計画のチェックリスト」「プランナーへの質問」等があっても、次のとおり読み替えてください:
- 実装の根拠は **research.md とタスク要件** です。「計画に従う」ではなく、調査結果とタスク内容に基づいて実装してください。
- plan.md のチェックリストは存在しません。**タスク要件を満たすこと**を完了基準にしてください。
- **プランナーは存在しません**。判断できない点は推測せず question.md に記録して停止してください（回答するのはユーザーです）。
- スコープ厳守・スコープ外変更の禁止・品質基準・セーフガード（テスト/型/ESLint）は通常どおり適用します。`;

const IMPLEMENTER_WITH_PLAN_DIRECTIVE = `## 実行モード: 計画あり（plan.md） — 他のどの指示よりも優先

このタスクには **承認済みの plan.md** があります。plan.md の計画とチェックリストに忠実に従って実装してください。`;

const VERIFIER_NO_PLAN_DIRECTIVE = `## 実行モード: 調査→実装→検証（plan.md なし） — 他のどの指示よりも優先

このタスクには **plan.md がありません**。以下のロール説明に「plan.md」「計画チェックリスト消化状況」等があれば読み替えてください:
- 検証の基準は **タスク要件と research.md** です。plan.md との照合ではなく、タスク要件・調査内容に対する充足状況を評価してください。
- 「計画チェックリスト消化状況」は「**要件の充足状況（タスク要件・調査内容に対して ✅/❌）**」として報告してください。
- それ以外（変更ファイル列挙・テスト結果・セキュリティ/品質チェック・未解決懸念）は通常どおり報告します。`;

const VERIFIER_WITH_PLAN_DIRECTIVE = `## 実行モード: 計画あり（plan.md） — 他のどの指示よりも優先

このタスクには **plan.md** があります。plan.md のチェックリストと実装結果を照合して検証してください。`;

/**
 * Prepend a plan-mode directive to the implementer/verifier system prompt.
 *
 * No-ops for other roles (planner/reviewer only run in plan-producing modes,
 * researcher has no plan dependency). The directive is authoritative so it fixes
 * the behaviour regardless of what the stored DB prompt says.
 *
 * @param role - The workflow role whose system prompt is being prepared. / 対象ロール
 * @param systemPrompt - The role's system prompt content (from DB). / DB由来のシステムプロンプト
 * @param hasPlan - Whether plan.md exists for this task. / plan.md の有無
 * @returns The system prompt with the mode directive prepended (or unchanged). / モード指示を付加したプロンプト
 */
export function applyPlanModeDirective(
  role: string,
  systemPrompt: string,
  hasPlan: boolean,
): string {
  let directive: string | null = null;
  if (role === 'implementer') {
    directive = hasPlan ? IMPLEMENTER_WITH_PLAN_DIRECTIVE : IMPLEMENTER_NO_PLAN_DIRECTIVE;
  } else if (role === 'verifier') {
    directive = hasPlan ? VERIFIER_WITH_PLAN_DIRECTIVE : VERIFIER_NO_PLAN_DIRECTIVE;
  }
  return directive ? `${directive}\n\n${systemPrompt}` : systemPrompt;
}
