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

type WorkflowRole =
  | 'researcher'
  | 'planner'
  | 'reviewer'
  | 'implementer'
  | 'verifier'
  | 'auto_verifier';

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
        items:
          '調査項目:\n- 既存コードの構造と依存関係\n- 変更が必要なファイルの特定\n- 類似実装の有無\n- リスクと影響範囲の評価',
        output:
          '調査結果をresearch.mdとしてMarkdown形式でまとめてください。\n\n' +
          '**重要**: 調査の結果、タスクの要件が既存コードで**既に満たされており修正が不要**だと判断した場合は、research.md の最後に必ずこの見出し行を入れてください: `## 結論: 修正不要`（直後に1〜2行で根拠を記載）。これにより plan/実装フェーズに進まず research 段階で完了でき、不要な再計画ループ（plan_invalid_replan）や重複PRを避けられます。本当に変更が必要な場合はこの行を書かないでください。',
      },
      planner: {
        researchHeader: '# リサーチャーの調査結果 (research.md)',
        instruction:
          '上記の調査結果を基に、実装計画をplan.mdとしてMarkdown形式で作成してください。\n\nチェックリスト形式で実装手順を記述し、変更予定ファイル一覧、リスク評価、完了条件を含めてください。\n\n設計上の選択（採用案・却下案・トレードオフ）を行った場合は、plan.md に `## 意思決定` 見出しを設け、1行1件 `- 採用: <選択> ｜ 理由: <理由> ｜ 予測: <この選択で期待される具体的な結果> ｜ 確信度: <0〜100>%` の形式で記述してください（**保存時に意思決定ジャーナルへ自動記録される**）。**予測は理由の言い換えではなく「何が起きると見込むか」を書き、確信度はその予測の確からしさ（例 70%）を必ず数値で記すこと。** 仮説（検証で真偽が決まる信念）ではなく、確定した選択の記録です。',
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
          '- `curl` / `Invoke-RestMethod` / `wget` を使って `http://localhost:3001/workflow/...` を叩くことを禁じます。検証は次フェーズの verifier ロールが行います。\n' +
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
          '\n### 必須セクション\n' +
          '```markdown\n' +
          '# 検証レポート\n' +
          '## 検証結果サマリ (✅ 検証成功 / ❌ 検証失敗 / ⚠️ 一部失敗 のいずれか)\n' +
          '## チェックリスト消化状況 (plan.md の各項目に ✅/❌)\n' +
          '## テスト結果 (実コマンド + 終了コード + 集計)\n' +
          '## 品質メトリクス (lint / type-check / build の結果)\n' +
          '## 残課題 / フォローアップ\n' +
          '```\n' +
          '冒頭は必ず `# 検証レポート` で開始し、テストが1件でも落ちていれば `❌ 検証失敗` または `⚠️ 一部失敗` を選択してください。',
      },
    },
    en: {
      taskInfo: `# Task Information\n- **Title**: ${task.title}\n- **Description**: ${task.description || '(None)'}\n- **Task ID**: ${taskId}`,
      researcher: {
        instruction: 'Please investigate the codebase for the above task.',
        items:
          'Investigation items:\n- Existing code structure and dependencies\n- Identification of files that need changes\n- Presence of similar implementations\n- Risk assessment and impact analysis',
        output:
          'Please summarize the research results as research.md in Markdown format.\n\n' +
          '**Important**: If your investigation concludes the task requirement is ALREADY satisfied by existing code and no change is needed, you MUST end research.md with this exact heading line: `## Conclusion: No change needed` (followed by 1-2 lines of justification). This lets the task complete at the research phase instead of proceeding to plan/implementation — avoiding a wasted re-plan loop (plan_invalid_replan) and a duplicate PR. Do NOT write this line if any change is actually required.',
      },
      planner: {
        researchHeader: '# Research Results (research.md)',
        instruction:
          'Based on the research results above, please create an implementation plan as plan.md in Markdown format.\n\nDescribe implementation steps in checklist format, including a list of files to be changed, risk assessment, and completion criteria.\n\nIf you make design choices (adopt option A, reject B, accept a trade-off), add a `## 意思決定` (Decisions) heading to plan.md and list one per line as `- 採用: <choice> ｜ 理由: <reason> ｜ 予測: <the concrete outcome you expect from this choice> ｜ 確信度: <0-100>%` — AUTO-RECORDED in the decision journal on save. **The 予測 (prediction) must state WHAT you expect to happen (not a restatement of the reason), and 確信度 (confidence) must be a number (e.g. 70%).** These are SETTLED choices (not hypotheses, which are testable beliefs).',
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
          '- DO NOT call `http://localhost:3001/workflow/...` via `curl` / `Invoke-RestMethod` / `wget`. Verification is performed by the verifier role in the next phase.\n' +
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
          '\n### Required sections\n' +
          '```markdown\n' +
          '# Verification Report\n' +
          '## Result summary (✅ Pass / ❌ Fail / ⚠️ Partial)\n' +
          '## Checklist status (each plan item ✅/❌)\n' +
          '## Test results (actual command + exit code + summary)\n' +
          '## Quality metrics (lint / type-check / build)\n' +
          '## Outstanding work / follow-ups\n' +
          '```\n' +
          'Start with `# Verification Report`. If even one test fails, choose `❌ Fail` or `⚠️ Partial`.',
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
      return `${taskInfo}${criticBlock}${modeBlock}${memoryBlock}${hypothesisBlock}\n\n${t.researcher.instruction}\n\n${t.researcher.items}\n\n${t.researcher.output}`;
    }

    case 'planner': {
      const research = await readWorkflowFile(dir, 'research');
      let ctx = taskInfo;
      // On a critic-gate bounce, lead with the issues the prior plan missed.
      const planCritic = await buildCriticFeedback(taskId, 'plan', language);
      if (planCritic) {
        ctx += `\n\n${planCritic}`;
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
      return ctx;
    }

    // NOTE: auto_verifier shares the verifier context — both must emit the validator-required headings
    case 'auto_verifier':
    case 'verifier': {
      const plan = await readWorkflowFile(dir, 'plan');
      let ctx = taskInfo;
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
          orderBy: { createdAt: 'desc' },
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
