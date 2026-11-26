import { afterAll, expect, mock, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '../../../generated/prisma-sqlite';
import { SQLITE_INIT_SQL } from '../../../src/generated/sqlite-init-sql';
import { parsePlanDeclaration } from '../../../services/workflow/plan-deviation/declaration-parser';
import { extractPlanDeclaredFiles } from '../../../services/workflow/plan-declared-files';

const root = mkdtempSync(join(tmpdir(), 'rapitas-question-grant-'));
const dbPath = join(root, 'test.db');
const init = new Database(dbPath);
init.exec(SQLITE_INIT_SQL);
init.close();
const db = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
const dispatchImplementer = mock(async () => {});
const dispatchPlanner = mock(async () => 'started');
mock.module('../../../config/database', () => ({ prisma: db }));
mock.module('./workflow-handlers-resume-redispatch', () => ({
  triggerRedispatchAfterResume: dispatchImplementer,
  triggerReExecutionAfterAnswer: dispatchPlanner,
}));

const { handleAnswerWorkflowQuestion } = await import('./workflow-handlers-resume');
const { applyQuestionAnswerByKind } = await import('./workflow-handlers-resume-dispatch');
const { readPlanScopeGrants } = await import('../../../services/workflow/plan-scope-grant');
const { evaluateScopeCheck, parsePlanFiles } =
  await import('../../../services/agents/verification/scope-check');
const { runAutomatedVerification, tamperCheck } =
  await import('../../../services/agents/verification/automated-verifier');
const { runPreSaveChecks } = await import('../workflow-auto-commit-presave');
const { tryRecoverFromHistoryContamination } =
  await import('../../../services/workflow/worktree-rebuild-recovery');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const previousKey = process.env.RAPITAS_OPERATOR_GRANT_PUBLIC_KEY;
process.env.RAPITAS_OPERATOR_GRANT_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' });

afterAll(async () => {
  if (previousKey === undefined) delete process.env.RAPITAS_OPERATOR_GRANT_PUBLIC_KEY;
  else process.env.RAPITAS_OPERATOR_GRANT_PUBLIC_KEY = previousKey;
  await db.$disconnect();
  rmSync(root, { recursive: true, force: true });
});

const digest = (content: string) => createHash('sha256').update(content).digest('hex');
const fileData = (content: string) => ({
  content,
  sha256: digest(content),
  sizeBytes: Buffer.byteLength(content),
});
const plan = [
  '# 実装計画',
  '## 変更予定ファイル',
  '- `src/main.ts`',
  '```json:plan-declaration',
  '{"version":1,"files":["src/main.ts"],"commands":["bun"],"externalHosts":[]}',
  '```',
].join('\n');
const selection = { questionId: 'Q1', selectedKey: 'A' };
const answer = 'ファイルの変更を許可します。';
const protectedFile = 'rapitas-backend/services/workflow/completion-gate.ts';
const planWhere = (taskId: number) => ({ taskId_fileType: { taskId, fileType: 'plan' } });

async function pendingAnswer(file: string, initialPlan = plan) {
  dispatchImplementer.mockClear();
  dispatchPlanner.mockClear();
  const task = await db.task.create({
    data: { title: '計画外のファイルを許可', workflowStatus: 'awaiting_question' },
  });
  const taskId = task.id;
  const worktreePath = join(root, String(taskId));
  mkdirSync(worktreePath, { recursive: true });
  mkdirSync(join(worktreePath, ...file.split('/').slice(0, -1)), { recursive: true });
  await db.developerModeConfig.create({
    data: { taskId, agentSessions: { create: { worktreePath } } },
  });
  const question = [
    '```json:options',
    JSON.stringify({
      kind: 'execution_continuation',
      questions: [
        {
          id: 'Q1',
          summary: '追加ファイルの確認',
          options: [{ key: 'A', label: '許可する', planRevision: true, grantsFiles: [file] }],
        },
      ],
    }),
    '```',
  ].join('\n');
  await db.workflowFile.createMany({
    data: [
      { taskId, fileType: 'question', ...fileData(question) },
      { taskId, fileType: 'plan', ...fileData(initialPlan) },
    ],
  });
  return { ...(await signPendingAnswer(taskId, question, initialPlan, file)), worktreePath };
}

async function signPendingAnswer(
  taskId: number,
  question: string,
  currentPlan: string,
  file: string,
) {
  const waiting = await db.workflowTransition.create({
    data: {
      taskId,
      actor: 'implementer',
      cause: 'file_saved:question',
      fromStatus: 'plan_approved',
      toStatus: 'awaiting_question',
      metadata: JSON.stringify({ kind: 'execution_continuation', previousStatus: 'plan_approved' }),
    },
  });
  const files = [file];
  const signature = sign(
    null,
    Buffer.from(
      JSON.stringify([
        'rapitas.plan-file-grant.v1',
        taskId,
        waiting.id,
        digest(question),
        digest(currentPlan),
        [[selection.questionId, selection.selectedKey]],
        files,
        false,
        digest(answer),
      ]),
    ),
    privateKey,
  ).toString('base64url');
  const fileApproval = {
    questionTransitionId: waiting.id,
    questionSha256: digest(question),
    planSha256: digest(currentPlan),
    files,
    signature,
  };
  const body = { answer, selections: [selection], fileApproval };
  return {
    taskId,
    question,
    waiting,
    body,
    respond: (input: unknown = body, source = 'operator') =>
      handleAnswerWorkflowQuestion({
        params: { taskId: String(taskId) },
        headers: { 'x-rapitas-source': source },
        set: {},
        body: input,
      }),
  };
}

test.each(['docs/extra.ts', protectedFile])(
  '署名済みのファイル許可で計画を維持して実装を再開する (%s)',
  async (file) => {
    const { taskId, respond, waiting } = await pendingAnswer(file);
    expect(await respond()).toMatchObject({
      resolvedKind: 'execution_continuation',
      toStatus: 'plan_approved',
    });
    const storedPlan = await db.workflowFile.findUniqueOrThrow({
      where: { taskId_fileType: { taskId, fileType: 'plan' } },
    });
    const transition = await db.workflowTransition.findFirstOrThrow({
      where: { taskId, cause: 'question_resolved' },
    });
    const metadata = JSON.parse(transition.metadata);
    const fence = storedPlan.content.match(
      /## 計画外ファイルの許可\r?\n+```json:plan-file-grants\r?\n([\s\S]*?)```/,
    );
    expect(fence).not.toBeNull();
    const grants = JSON.parse(fence![1]);
    expect(grants).toEqual([metadata.planGrant]);
    expect(metadata.planGrant).toMatchObject({
      questionTransitionId: waiting.id,
      actor: 'user',
      sourceLabel: 'オペレーター代理回答',
      files: [file],
    });
    expect(new Date(metadata.planGrant.approvedAt).toISOString()).toBe(
      metadata.planGrant.approvedAt,
    );
    expect(metadata).toMatchObject({
      routing: 'resume',
      routingReason: 'out_of_plan_files_approved',
      planShaBefore: digest(plan),
      planShaAfter: digest(storedPlan.content),
    });
    expect(dispatchImplementer).toHaveBeenCalledTimes(1);
    expect(dispatchPlanner).not.toHaveBeenCalled();
  },
);

async function assertUnchanged(taskId: number, question: string) {
  expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).workflowStatus).toBe(
    'awaiting_question',
  );
  expect((await db.workflowFile.findUniqueOrThrow({ where: planWhere(taskId) })).content).toBe(
    plan,
  );
  expect(
    (
      await db.workflowFile.findUniqueOrThrow({
        where: { taskId_fileType: { taskId, fileType: 'question' } },
      })
    ).content,
  ).toBe(question);
  expect(await db.workflowFileVersion.count({ where: { taskId } })).toBe(0);
  expect(await db.workflowTransition.count({ where: { taskId, cause: 'question_resolved' } })).toBe(
    0,
  );
  expect(dispatchImplementer).not.toHaveBeenCalled();
  expect(dispatchPlanner).not.toHaveBeenCalled();
}

test.each([
  'ヘッダーのみ',
  'UI',
  '署名不一致',
  '別タスクの署名',
  '古い質問ID',
  '過不足',
  '重複選択',
  '選択省略',
  '選択キー不一致',
])('無効な承認は計画と質問待ちを維持する (%s)', async (kind) => {
  const another = kind === '別タスクの署名' ? await pendingAnswer(protectedFile) : null;
  const { taskId, question, body, respond } = await pendingAnswer(protectedFile);
  const candidates: Record<string, unknown> = {
    ヘッダーのみ: { ...body, fileApproval: undefined },
    UI: body,
    署名不一致: { ...body, answer: '署名に含まれない回答' },
    別タスクの署名: {
      ...body,
      fileApproval: { ...body.fileApproval, signature: another?.body.fileApproval.signature },
    },
    古い質問ID: { ...body, fileApproval: { ...body.fileApproval, questionTransitionId: 99999 } },
    過不足: {
      ...body,
      fileApproval: { ...body.fileApproval, files: [protectedFile, 'src/other.ts'] },
    },
    重複選択: { ...body, selections: [selection, selection] },
    選択省略: { ...body, selections: [] },
    選択キー不一致: { ...body, selections: [{ ...selection, selectedKey: 'B' }] },
  };
  await expect(respond(candidates[kind], kind === 'UI' ? 'ui' : 'operator')).rejects.toThrow();
  await assertUnchanged(taskId, question);
});

test('リンク経由の承認は拒否する', async () => {
  const file = 'linked/new.ts';
  const { taskId, question, worktreePath, respond } = await pendingAnswer(file);
  rmdirSync(join(worktreePath, 'linked'));
  symlinkSync(root, join(worktreePath, 'linked'), 'junction');
  await expect(respond()).rejects.toThrow();
  await assertUnchanged(taskId, question);
});

test('システムからの回答は有効な署名を受け取っても許可を確定しない', async () => {
  const { taskId, question, body } = await pendingAnswer(protectedFile);
  await expect(
    applyQuestionAnswerByKind({
      taskId,
      actor: 'system',
      operatorAnswer: true,
      ...body,
    }),
  ).rejects.toThrow();
  await assertUnchanged(taskId, question);
});

test.each(['# ファイルの記載がない計画', plan.replace('"version":1', '"version":')])(
  '元の宣言が特定できなければ質問待ちを維持する (%s)',
  async (base) => {
    const { taskId, respond } = await pendingAnswer(protectedFile, base);
    await expect(respond()).rejects.toThrow('承認済み計画の変更ファイル宣言');
    expect((await db.workflowFile.findUniqueOrThrow({ where: planWhere(taskId) })).content).toBe(
      base,
    );
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).workflowStatus).toBe(
      'awaiting_question',
    );
    expect(dispatchImplementer).not.toHaveBeenCalled();
  },
);

test.each([
  'C:/extra.ts',
  '//host/share/a.ts',
  'src/../a.ts',
  'src//a.ts',
  'src/*.ts',
  'src/file.ts:stream',
  'src/CON.ts',
  'src/LONG~1.ts',
  'src/a.ts/',
  'src/a.ts.',
])('不正なファイル指定は署名の有無にかかわらず拒否する (%s)', async (file) => {
  const { taskId, question, body, respond } = await pendingAnswer(protectedFile);
  await expect(
    respond({
      ...body,
      fileApproval: { ...body.fileApproval, files: [file] },
    }),
  ).rejects.toThrow('具体的なリポジトリ相対パス');
  await assertUnchanged(taskId, question);
});

test.each(['plan', 'question'] as const)(
  '承認後に %s の本文が更新されると回答は競合する',
  async (fileType) => {
    const { taskId, respond } = await pendingAnswer(protectedFile);
    const where = { taskId_fileType: { taskId, fileType } };
    const { content } = await db.workflowFile.findUniqueOrThrow({ where });
    const changed = fileData(content + '\n\n別の変更\n');
    await db.workflowFile.update({ where, data: changed });
    await expect(respond()).rejects.toMatchObject({ code: 'question_outdated' });
    expect(await db.workflowFile.findUniqueOrThrow({ where })).toMatchObject(changed);
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).workflowStatus).toBe(
      'awaiting_question',
    );
    expect(dispatchImplementer).not.toHaveBeenCalled();
    expect(dispatchPlanner).not.toHaveBeenCalled();
  },
);

test('旧計画の宣言を復元し、別の質問で同じファイルを許可したときは監査だけが増える', async () => {
  const base = plan.split('\n```json:plan-declaration')[0];
  const { taskId, question, respond, waiting } = await pendingAnswer(protectedFile, base);
  await respond();
  const where = planWhere(taskId);
  const first = await db.workflowFile.findUniqueOrThrow({ where });
  await db.task.update({ where: { id: taskId }, data: { workflowStatus: 'awaiting_question' } });
  await db.workflowFile.update({
    where: { taskId_fileType: { taskId, fileType: 'question' } },
    data: fileData(question),
  });
  const second = await signPendingAnswer(taskId, question, first.content, protectedFile);
  await second.respond();
  const { content } = await db.workflowFile.findUniqueOrThrow({ where });
  expect(parsePlanDeclaration(content).declaration.files).toEqual(['src/main.ts', protectedFile]);
  expect(await readPlanScopeGrants(taskId, content)).toEqual([protectedFile]);
  const audits = await db.workflowTransition.findMany({
    where: { taskId, cause: 'question_resolved' },
    orderBy: { id: 'asc' },
  });
  expect(audits.map((row) => JSON.parse(row.metadata).planGrant.questionTransitionId)).toEqual([
    waiting.id,
    second.waiting.id,
  ]);
});

test.each([
  ['Task', 'UPDATE OF workflowStatus', 'NEW.workflowStatus <> OLD.workflowStatus'],
  ['Task', 'UPDATE OF status', 'NEW.status <> OLD.status'],
  ['WorkflowFile', 'UPDATE', "NEW.fileType = 'plan'"],
  ['WorkflowFile', 'UPDATE', "NEW.fileType = 'question'"],
  ['WorkflowFileVersion', 'INSERT', "NEW.fileType = 'plan'"],
  ['WorkflowFileVersion', 'INSERT', "NEW.fileType = 'question'"],
  ['WorkflowTransition', 'INSERT', "NEW.cause = 'question_resolved'"],
])(
  '永続化の途中で失敗したら全書き込みを戻し、再送は一度だけ確定する (%s %s %s)',
  async (table, event, condition) => {
    const { taskId, question, respond } = await pendingAnswer(protectedFile);
    const sql = new Database(dbPath);
    sql.exec(`CREATE TRIGGER fail_grant BEFORE ${event} ON "${table}" WHEN ${condition}
      BEGIN SELECT RAISE(ABORT, 'grant test'); END;`);
    try {
      await expect(respond()).rejects.toThrow();
      await assertUnchanged(taskId, question);
    } finally {
      sql.exec('DROP TRIGGER fail_grant');
      sql.close();
    }
    await expect(respond()).resolves.toMatchObject({ toStatus: 'plan_approved' });
    await expect(respond()).rejects.toThrow();
    expect(await db.workflowFileVersion.count({ where: { taskId, fileType: 'plan' } })).toBe(1);
    expect(
      await db.workflowTransition.count({ where: { taskId, cause: 'question_resolved' } }),
    ).toBe(1);
    expect(dispatchImplementer).toHaveBeenCalledTimes(1);
  },
);

test('宣言に追加した許可は scope と tamper で完全一致し、旧版を再保存しても効力は復活しない', async () => {
  const { taskId, respond } = await pendingAnswer(protectedFile);
  await respond();
  const { content } = await db.workflowFile.findUniqueOrThrow({ where: planWhere(taskId) });
  expect(parsePlanDeclaration(content).declaration).toMatchObject({
    files: ['src/main.ts', protectedFile],
    commands: ['bun'],
    externalHosts: [],
  });
  expect(extractPlanDeclaredFiles(content)).toEqual(['src/main.ts']);
  const exact = await readPlanScopeGrants(taskId, content);
  expect(exact).toEqual([protectedFile]);
  const legacy = parsePlanFiles(content);
  const unrelated = [
    'rapitas-backend/services/workflow/completion-gate-other.ts',
    'packages/rapitas-backend/services/workflow/completion-gate.ts',
    `${protectedFile}.bak`,
  ];
  expect(evaluateScopeCheck(['src/main.ts', protectedFile], legacy, exact)?.ok).toBe(true);
  expect(tamperCheck([protectedFile], legacy, exact)?.ok).toBe(true);
  expect(evaluateScopeCheck([protectedFile, ...unrelated], legacy, exact)?.offendingFiles).toEqual(
    unrelated,
  );
  expect(tamperCheck([protectedFile, ...unrelated], legacy, exact)?.errorCount).toBe(
    unrelated.length,
  );

  const other = await pendingAnswer(protectedFile);
  await db.workflowFile.update({ where: planWhere(other.taskId), data: fileData(content) });
  expect(await readPlanScopeGrants(other.taskId, content)).toEqual([]);
  expect(tamperCheck([protectedFile], legacy, [])?.ok).toBe(false);

  await db.workflowFileVersion.create({
    data: { taskId, fileType: 'plan', ...fileData(content) },
  });
  await db.workflowFile.update({ where: planWhere(taskId), data: fileData(content) });
  expect(await readPlanScopeGrants(taskId, content)).toEqual([]);
});

test('自動検証・コミット保存前・worktree 復旧で保存済みの許可を使う', async () => {
  const { taskId, respond, worktreePath } = await pendingAnswer(protectedFile);
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(['git', ...args], { cwd: worktreePath });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  };
  git('init');
  git(
    '-c',
    'user.name=Rapitas Test',
    '-c',
    'user.email=rapitas@example.test',
    'commit',
    '--allow-empty',
    '-m',
    'base',
  );
  writeFileSync(join(worktreePath, protectedFile), 'export {};\n');
  await respond();

  const { content } = await db.workflowFile.findUniqueOrThrow({ where: planWhere(taskId) });
  const verification = await runAutomatedVerification(worktreePath, {
    taskId,
    planContent: content,
  });
  expect(verification.checks.find((check) => check.name === 'tamper')?.ok).toBe(true);
  expect(verification.checks.find((check) => check.name === 'scope')?.ok).toBe(true);
  const presave = await runPreSaveChecks({
    taskId,
    gitCwd: worktreePath,
    preferredBaseBranch: null,
  });
  expect(presave.tamper?.ok).toBe(true);
  expect(presave.scope?.ok).toBe(true);
  await expect(tryRecoverFromHistoryContamination(taskId, worktreePath, null)).resolves.toEqual({
    recovered: false,
    reason: 'no_offending_files',
  });
});
