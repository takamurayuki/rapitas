/**
 * Workflow Context Builder
 *
 * Assembles the prompt context string passed to each workflow role's agent.
 * Reads previously created workflow files and combines them with task metadata
 * and role-specific instructions. Does not execute agents or write files.
 */
import { readWorkflowFile } from './workflow-file-utils';

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
): Promise<string> {
  const texts = {
    ja: {
      taskInfo: `# タスク情報\n- **タイトル**: ${task.title}\n- **説明**: ${task.description || '(なし)'}\n- **タスクID**: ${taskId}`,
      researcher: {
        instruction: '上記のタスクについてコードベースを調査してください。',
        items:
          '調査項目:\n- 既存コードの構造と依存関係\n- 変更が必要なファイルの特定\n- 類似実装の有無\n- リスクと影響範囲の評価',
        output: '調査結果をresearch.mdとしてMarkdown形式でまとめてください。',
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
        instruction:
          '上記の計画に従って実装を完了してください。計画に記載されたファイルの作成・編集を行い、コードを実装してください。\n\n' +
          '## 実装者の責務 (厳守)\n' +
          '- あなたの仕事はコード変更だけです。**verify.md / research.md / plan.md は絶対に保存しないでください。**\n' +
          '- `curl` / `Invoke-RestMethod` / `wget` を使って `http://localhost:3001/workflow/...` を叩くことを禁じます。検証は次フェーズの verifier ロールが行います。\n' +
          '- 同様に `PUT /tasks/:id/status` などタスクステータスを変更する API も呼ばないでください。状態遷移は Rapitas 側が自動で行います。\n' +
          '- ワークフロー API を叩いても **400 で拒否されます** (status guard)。回避策の探索はせず、コード変更が終わったらそこで終了してください。\n' +
          '- 実装が完了したら、変更内容のサマリ (どのファイルを何のために変えたか) を最後のメッセージに残して終了してください。Rapitas が後段で verify.md を自動生成します。',
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
        output: 'Please summarize the research results as research.md in Markdown format.',
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
        instruction:
          'Please complete the implementation according to the plan above. Create and edit the files listed in the plan and implement the code.\n\n' +
          '## Implementer Constraints (strict)\n' +
          '- Your job is code changes ONLY. **DO NOT save verify.md / research.md / plan.md.**\n' +
          '- DO NOT call `http://localhost:3001/workflow/...` via `curl` / `Invoke-RestMethod` / `wget`. Verification is performed by the verifier role in the next phase.\n' +
          '- DO NOT call `PUT /tasks/:id/status` or any task-status mutation API. State transitions are managed by Rapitas.\n' +
          '- The workflow API will return 400 if you try (status guard). Do not search for workarounds — finish when code changes are done.\n' +
          '- Once implementation is done, leave a short summary (which files changed and why) as your final message and exit. Rapitas auto-generates verify.md downstream.',
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
      return `${taskInfo}\n\n${t.researcher.instruction}\n\n${t.researcher.items}\n\n${t.researcher.output}`;
    }

    case 'planner': {
      const research = await readWorkflowFile(dir, 'research');
      let ctx = taskInfo;
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
      let ctx = taskInfo;
      if (research) {
        ctx += `\n\n${t.implementer.researchHeader}\n\n${research}`;
      }
      if (plan) {
        ctx += `\n\n${t.implementer.planHeader}\n\n${plan}`;
      }
      if (question) {
        ctx += `\n\n${t.implementer.reviewHeader}\n\n${question}`;
      }
      ctx += `\n\n${t.implementer.instruction}`;
      return ctx;
    }

    case 'verifier': {
      const plan = await readWorkflowFile(dir, 'plan');
      let ctx = taskInfo;
      if (plan) {
        ctx += `\n\n${t.verifier.planHeader}\n\n${plan}`;
      }
      // Append git diff when available
      try {
        const { execSync } = await import('child_process');
        const diff = execSync('git diff HEAD~1', {
          cwd: process.cwd(),
          encoding: 'utf-8',
          timeout: 10000,
        });
        if (diff.trim()) {
          ctx += `\n\n${t.verifier.diffHeader}\n\n\`\`\`diff\n${diff.substring(0, 50000)}\n\`\`\``;
        }
      } catch {
        // Continue even if git diff fails
      }
      ctx += `\n\n${t.verifier.instruction}`;
      return ctx;
    }

    default:
      return taskInfo;
  }
}
