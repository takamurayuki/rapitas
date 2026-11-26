/** ファイル許可の署名、計画への追記、回答遷移との照合を扱う。 */
import { createHash, createPublicKey, verify } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { prisma } from '../../config/database';
import type { Prisma } from '../../generated/prisma-postgres';
import { ConflictError, ValidationError } from '../../middleware/error-handler';
import { parsePlanDeclaration } from './plan-deviation/declaration-parser';

const PURPOSE = 'rapitas.plan-file-grant.v1';
const GRANT_FENCE =
  /^## 計画外ファイルの許可\r?\n\r?\n```json:plan-file-grants\r?\n([^]*?)\r?\n```[ \t]*(?=\r?$)/gm;
const DECLARATION_FENCE = /^(```json:plan-declaration[ \t]*\r?\n)([^]*?)(\r?\n```[ \t]*)(?=\r?$)/gm;
const DIGEST = /^[a-f0-9]{64}$/;
const OPERATOR = 'オペレーター代理回答';
const waitingOrder = [{ createdAt: 'desc' }, { id: 'desc' }] as const;

type FileApproval = {
  questionTransitionId: number;
  questionSha256: string;
  planSha256: string;
  files: string[];
  signature: string;
};

interface PlanGrant {
  questionTransitionId: number;
  actor: 'user';
  sourceLabel: typeof OPERATOR;
  approvedAt: string;
  files: string[];
}

type Artifact = { id: number; sha256: string; content: string; sizeBytes: number; updatedAt: Date };

export interface PreparedPlanGrant {
  questionTransitionId: number;
  files: string[];
  taskUpdatedAt: Date;
  plan: Artifact;
  question: Artifact;
  priorVersionId: number | null;
  previousGrants: PlanGrant[];
}

function hash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function artifactContent(content: string) {
  return { content, sha256: hash(content), sizeBytes: Buffer.byteLength(content) };
}

function invalid(message: string): never {
  throw new ValidationError(message);
}

function stale(): never {
  throw new ConflictError('質問または計画が更新されています', 'question_outdated');
}

function json(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Rejected spellings can resolve to a path different from the one being signed. */
function normalizeFiles(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0) invalid('許可するファイルを指定してください');
  const normalized = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== 'string') invalid('許可するファイルのパスが不正です');
    const file = raw.replace(/\\/g, '/').replace(/^\.\//, '');
    const segments = file.split('/');
    if (
      /[<>:"|?*\[\]]/.test(file) ||
      [...file].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
      segments.some(
        (s) =>
          !s ||
          s === '.' ||
          s === '..' ||
          /[ .]$/.test(s) ||
          /^(?:\.git$|(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$))/i.test(s) ||
          /~[0-9]+(?:\.|$)/.test(s),
      )
    )
      invalid('許可するファイルには具体的なリポジトリ相対パスを指定してください');
    normalized.add(file);
  }
  return [...normalized].sort();
}

function parseApproval(input: unknown): FileApproval {
  const value = object(input);
  if (!value) invalid('運用者による署名付きのファイル許可が必要です');
  const { questionTransitionId, questionSha256, planSha256, signature } = value;
  if (
    typeof questionTransitionId !== 'number' ||
    !Number.isSafeInteger(questionTransitionId) ||
    questionTransitionId <= 0 ||
    typeof questionSha256 !== 'string' ||
    !DIGEST.test(questionSha256) ||
    typeof planSha256 !== 'string' ||
    !DIGEST.test(planSha256) ||
    typeof signature !== 'string' ||
    !/^[A-Za-z0-9_-]{86}$/.test(signature)
  )
    invalid('署名付きファイル許可の形式が不正です');
  return {
    questionTransitionId,
    questionSha256,
    planSha256,
    signature,
    files: normalizeFiles(value.files),
  };
}

async function assertWorktreePaths(root: string | null | undefined, files: string[]) {
  if (!root || !isAbsolute(root)) invalid('対象 worktree を確認できません');
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) invalid('対象 worktree が不正です');
  const base = await realpath(root);
  for (const file of files) {
    const parts = file.split('/');
    let path = base;
    for (const [index, part] of parts.entries()) {
      const last = index === parts.length - 1;
      path = join(path, part);
      const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT' && last) return null;
        throw error;
      });
      if (
        stat &&
        (stat.isSymbolicLink() ||
          !(last ? stat.isFile() : stat.isDirectory()) ||
          (await realpath(path)) !== path)
      )
        invalid('許可パスにリンク、別名またはディレクトリが含まれます');
    }
  }
}

function verifySignature(
  approval: FileApproval,
  input: { taskId: number; pairs: [string, string][]; answer: string; resumeImplementer?: boolean },
) {
  const pairs = [...input.pairs].sort(([a, ak], [b, bk]) =>
    a === b ? (ak === bk ? 0 : ak < bk ? -1 : 1) : a < b ? -1 : 1,
  );
  const payload = JSON.stringify([
    PURPOSE,
    input.taskId,
    approval.questionTransitionId,
    approval.questionSha256,
    approval.planSha256,
    pairs,
    approval.files,
    input.resumeImplementer === true,
    hash(input.answer.trim()),
  ]);
  const pem = process.env.RAPITAS_OPERATOR_GRANT_PUBLIC_KEY;
  let verified = false;
  if (pem) {
    try {
      const key = createPublicKey(pem);
      verified =
        key.asymmetricKeyType === 'ed25519' &&
        verify(null, Buffer.from(payload), key, Buffer.from(approval.signature, 'base64url'));
    } catch {
      // 検証結果だけを使用し、署名や鍵をログには出さない。
    }
  }
  if (!verified) invalid('運用者のファイル許可の署名を確認できません');
}

function isGrant(value: unknown): value is PlanGrant {
  const row = object(value);
  return (
    !!row &&
    row.actor === 'user' &&
    row.sourceLabel === OPERATOR &&
    typeof row.approvedAt === 'string' &&
    typeof row.questionTransitionId === 'number' &&
    Array.isArray(row.files) &&
    row.files.length > 0 &&
    row.files.every((f) => typeof f === 'string')
  );
}

function planGrants(content: string): PlanGrant[] | null {
  const fences = [...content.matchAll(GRANT_FENCE)];
  if (fences.length !== 1) return null;
  const rows = json(fences[0][1]);
  // 各行は後続処理でサーバーが記録した監査の値と完全一致を確認する。
  return Array.isArray(rows) && rows.length && rows.every(isGrant) ? rows : null;
}

const hasGrantSection = (content: string) => content.includes('json:plan-file-grants');

function declaration(content: string) {
  const parsed = parsePlanDeclaration(content);
  const fences = [...content.matchAll(DECLARATION_FENCE)];
  const fence = fences[0];
  const raw = fence && object(json(fence[2]));
  if (
    parsed.ambiguous ||
    (parsed.source === 'fence'
      ? fences.length !== 1 || !raw
      : content.includes('```json:plan-declaration'))
  ) {
    invalid('承認済み計画の変更ファイル宣言を確認できません');
  }
  return { parsed, fence, raw };
}

/** JSON 内のパスを Markdown のフェンスやインラインコードとして解釈させない。 */
const fenceJson = (value: unknown) => JSON.stringify(value).replace(/`/g, '\\u0060');

function appendGrant(content: string, history: PlanGrant[], grant: PlanGrant): string {
  const { parsed, fence, raw } = declaration(content);
  const original = parsed.declaration;
  const base = raw ?? original;
  const files = Array.isArray(base.files) ? base.files : original.files;
  const body = fenceJson({
    ...base,
    files: [...files, ...grant.files.filter((f) => !original.files.includes(f))],
  });
  const next = fence
    ? content.slice(0, fence.index) +
      fence[1] +
      body +
      fence[3] +
      content.slice(fence.index + fence[0].length)
    : content + '\n\n```json:plan-declaration\n' + body + '\n```\n';
  const block =
    '## 計画外ファイルの許可\n\n```json:plan-file-grants\n' +
    fenceJson([...history, grant]) +
    '\n```';
  return history.length ? next.replace(GRANT_FENCE, () => block) : next + '\n\n' + block + '\n';
}

const liveFile = (db: Prisma.TransactionClient, taskId: number, fileType: string) =>
  db.workflowFile.findUnique({ where: { taskId_fileType: { taskId, fileType } } });

const latestPlanVersion = (db: Prisma.TransactionClient, taskId: number) =>
  db.workflowFileVersion.findFirst({
    where: { taskId, fileType: 'plan' },
    orderBy: [{ archivedAt: 'desc' }, { id: 'desc' }],
    select: { id: true, sha256: true },
  });

async function matchingGrants(
  db: Prisma.TransactionClient,
  taskId: number,
  content: string,
  digest: string,
  version: { id: number; sha256: string } | null,
): Promise<PlanGrant[]> {
  const grants = planGrants(content);
  if (!grants || !version) return [];
  const rows = await db.workflowTransition.findMany({
    where: {
      taskId,
      cause: 'question_resolved',
      fromStatus: 'awaiting_question',
      actor: 'user',
      metadata: { contains: '"planGrant"' },
    },
    orderBy: [...waitingOrder],
    select: { metadata: true },
  });
  const audit = rows.map(({ metadata }) => object(json(metadata)));
  const latest = audit[0];
  if (
    latest?.planShaAfter !== digest ||
    latest.planShaBefore !== version.sha256 ||
    latest.planVersionId !== version.id ||
    JSON.stringify(latest.planGrant) !== JSON.stringify(grants[grants.length - 1])
  )
    return [];
  const declared = parsePlanDeclaration(content);
  if (declared.source !== 'fence') return [];
  const recorded = new Set(audit.map((row) => JSON.stringify(row?.planGrant)));
  return grants.filter(
    (grant) =>
      recorded.has(JSON.stringify(grant)) &&
      grant.files.every((file) => declared.declaration.files.includes(file)),
  );
}

/** 読み出した計画の版と監査が一致するファイルだけを、完全一致用に返す。 */
export async function readPlanScopeGrants(
  taskId: number | undefined,
  content: string | null | undefined,
) {
  if (taskId === undefined || !content || !hasGrantSection(content)) return [];
  return prisma.$transaction(
    async (tx) => {
      const [plan, version] = await Promise.all([
        liveFile(tx, taskId, 'plan'),
        latestPlanVersion(tx, taskId),
      ]);
      if (plan?.content !== content || plan.sha256 !== hash(content)) return [];
      return [
        ...new Set(
          (await matchingGrants(tx, taskId, content, plan.sha256, version)).flatMap(
            ({ files }) => files,
          ),
        ),
      ];
    },
    { isolationLevel: 'Serializable' },
  );
}

/** 署名済み回答を、選択肢・タスク・作業ツリー・現在の計画に束縛する。 */
export async function preparePlanScopeGrant(input: {
  taskId: number;
  questionTransitionId: number;
  questionContent: string;
  proposal: string[];
  pairs: [string, string][];
  answer: string;
  resumeImplementer?: boolean;
  approval: unknown;
}): Promise<PreparedPlanGrant> {
  const approval = parseApproval(input.approval);
  const files = normalizeFiles(input.proposal);
  if (JSON.stringify(approval.files) !== JSON.stringify(files))
    invalid('許可対象が提案と一致しません');
  if (
    approval.questionTransitionId !== input.questionTransitionId ||
    approval.questionSha256 !== hash(input.questionContent)
  )
    stale();
  verifySignature(approval, input);
  const { taskId } = input;
  const [task, plan, question, version, session] = await Promise.all([
    prisma.task.findUnique({
      where: { id: taskId },
      select: { updatedAt: true, workflowStatus: true },
    }),
    liveFile(prisma, taskId, 'plan'),
    liveFile(prisma, taskId, 'question'),
    latestPlanVersion(prisma, taskId),
    prisma.agentSession.findFirst({
      where: { config: { taskId }, worktreePath: { not: null } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { worktreePath: true },
    }),
  ]);
  if (
    !task ||
    task.workflowStatus !== 'awaiting_question' ||
    !plan ||
    plan.sha256 !== approval.planSha256 ||
    plan.sha256 !== hash(plan.content) ||
    !question ||
    question.sha256 !== approval.questionSha256 ||
    question.content !== input.questionContent
  )
    stale();
  declaration(plan.content);
  const previousGrants = await matchingGrants(prisma, taskId, plan.content, plan.sha256, version);
  if (hasGrantSection(plan.content) && previousGrants.length !== planGrants(plan.content)?.length) {
    invalid('現在の計画のファイル許可を照合できません');
  }
  try {
    await assertWorktreePaths(session?.worktreePath, files);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    invalid('許可対象のパスを worktree 内で確認できません');
  }
  return {
    questionTransitionId: input.questionTransitionId,
    files,
    taskUpdatedAt: task.updatedAt,
    plan,
    question,
    priorVersionId: version?.id ?? null,
    previousGrants,
  };
}

/** 計画、回答、状態、監査を一括確定する。呼び出し元がタスクロックを保持する。 */
export async function persistPlanScopeGrant(input: {
  taskId: number;
  answer: string;
  grant: PreparedPlanGrant;
  resumeStatus: string;
  metadata: Record<string, unknown>;
}) {
  const { taskId, grant, resumeStatus, metadata } = input;
  const audit: PlanGrant = {
    questionTransitionId: grant.questionTransitionId,
    actor: 'user',
    sourceLabel: OPERATOR,
    approvedAt: new Date().toISOString(),
    files: grant.files,
  };
  const plan = artifactContent(appendGrant(grant.plan.content, grant.previousGrants, audit));
  const question = artifactContent(`${grant.question.content}\n\n## 回答\n${input.answer}`);
  try {
    await prisma.$transaction(
      async (tx) => {
        const waiting = await tx.workflowTransition.findFirst({
          where: { taskId, toStatus: 'awaiting_question' },
          orderBy: [...waitingOrder],
          select: { id: true },
        });
        if (waiting?.id !== grant.questionTransitionId) stale();
        const task = await tx.task.updateMany({
          where: {
            id: taskId,
            workflowStatus: 'awaiting_question',
            updatedAt: grant.taskUpdatedAt,
          },
          data: { workflowStatus: resumeStatus, updatedAt: new Date(audit.approvedAt) },
        });
        if (task.count !== 1) stale();
        const version = await latestPlanVersion(tx, taskId);
        if ((version?.id ?? null) !== grant.priorVersionId) stale();
        const write = async (snapshot: Artifact, fileType: string, updated: typeof plan) => {
          const changed = await tx.workflowFile.updateMany({
            where: {
              id: snapshot.id,
              taskId,
              fileType,
              sha256: snapshot.sha256,
              updatedAt: snapshot.updatedAt,
            },
            data: updated,
          });
          if (changed.count !== 1) stale();
          return tx.workflowFileVersion.create({
            data: {
              taskId,
              fileType,
              content: snapshot.content,
              sha256: snapshot.sha256,
              sizeBytes: snapshot.sizeBytes,
            },
            select: { id: true },
          });
        };
        const archived = await write(grant.plan, 'plan', plan);
        await write(grant.question, 'question', question);
        await tx.task.updateMany({
          where: { id: taskId, status: 'todo' },
          data: { status: 'in-progress' },
        });
        await tx.workflowTransition.create({
          data: {
            taskId,
            fromStatus: 'awaiting_question',
            toStatus: resumeStatus,
            actor: 'user',
            cause: 'question_resolved',
            metadata: JSON.stringify({
              ...metadata,
              planGrant: audit,
              planShaBefore: grant.plan.sha256,
              planShaAfter: plan.sha256,
              planVersionId: archived.id,
            }),
          },
        });
      },
      { isolationLevel: 'Serializable' },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      ['P1008', 'P2028', 'P2034'].includes(String(error.code))
    )
      stale();
    throw error;
  }
}
