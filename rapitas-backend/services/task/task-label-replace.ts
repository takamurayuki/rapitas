/**
 * TaskLabelReplace
 *
 * Replaces the set of labels attached to one task, atomically.
 * Not responsible for the HTTP shape — the route owns that.
 *
 * Why this is its own module (#1330): the replacement was two loose writes,
 * `deleteMany` then `createMany`. Without a transaction, a failing create — an
 * unknown labelId is a foreign-key violation, and a connection blip does it
 * too — left the old labels already deleted and the new ones never written, so
 * the task came out with NO labels at all. That is data loss, not a partial
 * save, and it happens on an everyday operation.
 *
 * It lives under services/task rather than beside one route because there were
 * TWO copies of that unsafe pair: `PUT /tasks/:id/labels` and the main
 * `PATCH /tasks/:id` path in task-mutations. Fixing only the first left the
 * one users hit far more often still able to wipe a task's labels (#1330
 * review). A service a route imports is the right direction; a route a
 * service imports is not.
 */
import { ValidationError } from '../../middleware/error-handler';

/**
 * The Prisma surface this needs, so a transaction client fits too.
 *
 * NOTE: Declared with METHOD shorthand, not arrow properties. Under
 * `strictFunctionTypes` an arrow property is checked contravariantly, and the
 * real `PrismaClient` then fails to satisfy this interface because its
 * `findMany` accepts a far wider generic argument. Method shorthand is
 * bivariant, which is what lets the real client and a `$transaction` client
 * both be passed without an `as never` at every call site.
 */
interface LabelTxClient {
  label: {
    findMany(args: { where: { id: { in: number[] } } }): Promise<Array<{ id: number }>>;
  };
  taskLabel: {
    deleteMany(args: { where: { taskId: number } }): Promise<{ count: number }>;
    createMany(args: {
      data: Array<{ taskId: number; labelId: number }>;
    }): Promise<{ count: number }>;
  };
}

/**
 * The client that opens the transaction.
 *
 * NOTE: the callback parameter is `LabelTxClient`, NOT this type. Prisma's
 * transaction client has `$transaction` removed (ITXClientDenyList), so a
 * self-referential interface here makes the real client unassignable: TS
 * checks whether Prisma's `fn` accepts our callback, which requires the tx
 * client to satisfy the whole interface including `$transaction`, and it
 * cannot. Splitting the two surfaces is what lets `prisma` be passed with no
 * cast at the call sites.
 */
interface LabelWriteClient extends LabelTxClient {
  $transaction<T>(fn: (tx: LabelTxClient) => Promise<T>): Promise<T>;
}

/**
 * Replace a task's labels with exactly `labelIds`.
 *
 * Unknown ids are refused BEFORE anything is deleted. The foreign key would
 * catch them a moment later, but only as an opaque failure — checking first
 * lets the caller be told which id was wrong, and keeps the delete from
 * running at all.
 *
 * @param client - Prisma client / Prisma クライアント
 * @param taskId - The task whose labels are replaced / 対象タスク
 * @param labelIds - The labels it should end up with; duplicates collapse / 付与するラベル（重複は畳む）
 * @returns Nothing / なし
 * @throws {ValidationError} When a labelId does not exist / 存在しないラベルIDがある場合
 */
export async function replaceTaskLabels(
  client: LabelWriteClient,
  taskId: number,
  labelIds: number[],
): Promise<void> {
  const wanted = [...new Set(labelIds ?? [])];

  if (wanted.length > 0) {
    const found = await client.label.findMany({ where: { id: { in: wanted } } });
    const foundIds = new Set(found.map((row) => row.id));
    const missing = wanted.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new ValidationError(`存在しないラベルIDです: ${missing.join(', ')}`);
    }
  }

  await client.$transaction(async (tx) => {
    await tx.taskLabel.deleteMany({ where: { taskId } });
    if (wanted.length > 0) {
      await tx.taskLabel.createMany({
        data: wanted.map((labelId) => ({ taskId, labelId })),
      });
    }
  });
}
