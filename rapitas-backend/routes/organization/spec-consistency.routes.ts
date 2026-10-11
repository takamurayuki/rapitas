/**
 * spec-consistency routes
 *
 * HTTP API for checking a generated project's specification documents for the
 * gaps that cause rework. Thin layer — every rule lives in
 * services/organization/spec-consistency.
 *
 * Exists so the generator wizard (a Next.js route, which cannot import backend
 * modules) runs the SAME checks the task filer's parser is built on, instead of
 * carrying a second copy that could drift.
 */
import { Elysia, t } from 'elysia';
import {
  checkSpecConsistency,
  specIsImplementable,
} from '../../services/organization/spec-consistency';

const specConsistencyRoutes = new Elysia({ prefix: '/organization/spec-consistency' })
  /** Check one document set; returns findings plus whether errors remain. */
  .post(
    '/',
    ({ body }) => {
      const findings = checkSpecConsistency({
        requirements: body.requirements,
        design: body.design,
        adr: body.adr,
      });
      return {
        findings,
        implementable: specIsImplementable(findings),
        errorCount: findings.filter((f) => f.severity === 'error').length,
        warningCount: findings.filter((f) => f.severity === 'warning').length,
      };
    },
    {
      // All optional: the wizard may check a partial package, and a missing
      // document is itself a finding rather than a request error.
      body: t.Object({
        requirements: t.Optional(t.String()),
        design: t.Optional(t.String()),
        adr: t.Optional(t.String()),
      }),
    },
  );

export default specConsistencyRoutes;
