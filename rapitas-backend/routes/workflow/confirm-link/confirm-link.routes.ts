/**
 * confirm-link routes
 *
 * Internal (human-only, X-Rapitas-Source) routes that issue confirm links and
 * toggle the 「外部公開可」 tag, and the public `/public/confirm-links/:token`
 * routes an outside respondent opens without logging in (task 1430). The
 * public routes are the only ones the API token guard lets through; they
 * authenticate with the signed token. Thin layer over
 * services/workflow/confirm-link.
 */
import { Elysia } from 'elysia';
import { existsSync } from 'fs';
import { createLogger } from '../../../config/logger';
import { humanSourceLabel } from '../../../utils/common/human-source';
import { isValidEntityId } from '../../../utils/common/id-validation';
import { resolveUploadPath } from '../../tasks/resources-upload-support';
import {
  CONFIRM_LINK_PUBLIC_HEADERS,
  renderConfirmLinkPage,
} from '../../../services/workflow/confirm-link/confirm-link-page';
import { listIssuerResources } from '../../../services/workflow/confirm-link/confirm-link-resources';
import {
  findConfirmLinkResource,
  issueConfirmLink,
  loadConfirmLinkView,
  submitConfirmLinkAnswer,
} from '../../../services/workflow/confirm-link/confirm-link-service';
import {
  ConfirmLinkError,
  type ConfirmLinkPageResult,
  type ConfirmLinkServiceDeps,
} from '../../../services/workflow/confirm-link/confirm-link-types';

const log = createLogger('routes:confirm-link');

const ISSUER_SOURCE_LABELS: Readonly<Record<string, string>> = {
  ui: 'ユーザー操作',
  operator: 'オペレーター代理',
};

type DepsProvider = () => ConfirmLinkServiceDeps | Promise<ConfirmLinkServiceDeps>;
type HeaderSet = { headers: Record<string, unknown>; status?: number | string };

function applyPublicHeaders(set: HeaderSet): void {
  Object.assign(set.headers, CONFIRM_LINK_PUBLIC_HEADERS);
}

/** Send an HTML page; overrides the JSON content type server-main forces on every handler. */
function sendPage(set: HeaderSet, result: ConfirmLinkPageResult, token: string): string {
  applyPublicHeaders(set);
  set.headers['Content-Type'] = 'text/html; charset=utf-8';
  set.status = result.status;
  return renderConfirmLinkPage(result, token);
}

function issueErrorBody(err: unknown, set: HeaderSet) {
  if (err instanceof ConfirmLinkError) {
    set.status = err.status;
    return { error: err.message, code: err.code };
  }
  throw err;
}

/**
 * Build the routes over a dependency provider (tests inject fakes).
 *
 * @param getDeps - Returns the service dependencies / 依存の供給関数
 * @param now - Clock in epoch ms / 現在時刻
 * @returns The Elysia plugin / ルート
 */
export function createConfirmLinkRoutes(getDeps: DepsProvider, now: () => number = Date.now) {
  return new Elysia()
    .post('/workflow/tasks/:taskId/confirm-links', async ({ params, body, headers, set }) => {
      if (!isValidEntityId(params.taskId)) {
        set.status = 400;
        return { error: 'invalid taskId' };
      }
      if (!humanSourceLabel(headers['x-rapitas-source'], ISSUER_SOURCE_LABELS)) {
        set.status = 400;
        return { error: '確認リンクの発行には X-Rapitas-Source ヘッダ(ui|operator)が必要です' };
      }
      const raw = (body as { message?: unknown } | null)?.message;
      try {
        const deps = await getDeps();
        const res = await issueConfirmLink(
          {
            taskId: Number(params.taskId),
            message: typeof raw === 'string' ? raw : '',
            now: now(),
          },
          deps,
        );
        return {
          linkId: res.linkId,
          url: res.url,
          expiresAt: res.expiresAt,
          relative: res.relative,
        };
      } catch (err) {
        return issueErrorBody(err, set);
      }
    })
    .get('/workflow/tasks/:taskId/confirm-links', async ({ params, set }) => {
      if (!isValidEntityId(params.taskId)) {
        set.status = 400;
        return { error: 'invalid taskId' };
      }
      const taskId = Number(params.taskId);
      const deps = await getDeps();
      const links = (await deps.store.list(taskId)).map((l) => ({
        linkId: l.linkId,
        state: l.state,
        expiresAt: l.expiresAt,
        answeredAt: l.answeredAt ?? null,
      }));
      const resources = await listIssuerResources(taskId, deps);
      return { enabled: deps.secret !== null, links, resources };
    })
    .put(
      '/workflow/confirm-links/resources/:resourceId/visibility',
      async ({ params, body, headers, set }) => {
        if (!isValidEntityId(params.resourceId)) {
          set.status = 400;
          return { error: 'invalid resourceId' };
        }
        if (!humanSourceLabel(headers['x-rapitas-source'], ISSUER_SOURCE_LABELS)) {
          set.status = 400;
          return { error: '公開範囲の変更には X-Rapitas-Source ヘッダ(ui|operator)が必要です' };
        }
        const externalPublic = (body as { externalPublic?: unknown } | null)?.externalPublic;
        if (typeof externalPublic !== 'boolean') {
          set.status = 400;
          return { error: 'externalPublic must be a boolean' };
        }
        const deps = await getDeps();
        await deps.store.setResourceTag(Number(params.resourceId), externalPublic);
        return { resourceId: Number(params.resourceId), externalPublic };
      },
    )
    .get('/public/confirm-links/:token', async ({ params, set }) => {
      const result = await loadConfirmLinkView(
        { token: params.token, now: now() },
        await getDeps(),
      );
      return sendPage(set, result, params.token);
    })
    .post('/public/confirm-links/:token', async ({ params, body, set }) => {
      const form = (body ?? {}) as Record<string, unknown>;
      const result = await submitConfirmLinkAnswer(
        {
          token: params.token,
          choice: form.choice,
          respondentName: form.respondentName,
          confirmed: form.confirmed === 'on' || form.confirmed === true,
          now: now(),
        },
        await getDeps(),
      );
      return sendPage(set, result, params.token);
    })
    .get('/public/confirm-links/:token/resources/:resourceId', async ({ params, set }) => {
      applyPublicHeaders(set);
      const row = isValidEntityId(params.resourceId)
        ? await findConfirmLinkResource(
            { token: params.token, resourceId: Number(params.resourceId), now: now() },
            await getDeps(),
          )
        : null;
      let filePath: string | null = null;
      try {
        filePath = row?.filePath ? resolveUploadPath(row.filePath) : null;
      } catch (err) {
        log.warn({ err, resourceId: row?.id }, '[confirm-link] resource path escapes uploads/');
      }
      if (!row || !filePath || !existsSync(filePath)) {
        return sendPage(set, { status: 404, kind: 'not_found' }, params.token);
      }
      set.headers['Content-Type'] = row.mimeType || 'application/octet-stream';
      const name = encodeURIComponent(row.fileName || `resource-${row.id}`);
      set.headers['Content-Disposition'] = `attachment; filename*=UTF-8''${name}`;
      return Bun.file(filePath);
    });
}

export default createConfirmLinkRoutes(async () =>
  (
    await import('../../../services/workflow/confirm-link/confirm-link-default-deps')
  ).createDefaultConfirmLinkDeps(),
);
