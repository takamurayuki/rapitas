/**
 * task-spec-body
 *
 * The spec fields of the POST and PATCH /tasks bodies, in one place. Elysia's
 * t.Object drops any field it does not name, which is how
 * `userAcceptanceChecks` was once silently lost (#1547); keeping the list here
 * keeps create and edit from drifting apart. Not responsible for storing
 * them (`services/task`).
 */
import { t } from 'elysia';
import { DELIVERABLES } from '../../services/task/task-spec-requirements';

const deliverable = t.Optional(t.Union(DELIVERABLES.map((d) => t.Literal(d))));

/** Spec fields of POST /tasks. */
export const CREATE_SPEC_FIELDS = {
  goals: t.Optional(t.Array(t.String())),
  constraints: t.Optional(t.Array(t.String())),
  acceptanceCriteria: t.Optional(t.Array(t.String())),
  userAcceptanceChecks: t.Optional(t.Array(t.String())),
  /** 範囲外 (#1555). */
  outOfScope: t.Optional(t.Array(t.String())),
  /** 成果物 (#1555). */
  deliverable,
};

const longList = t.Optional(t.Array(t.String({ maxLength: 20000 }), { maxItems: 200 }));

/** Spec fields of PATCH /tasks/:id. */
export const UPDATE_SPEC_FIELDS = {
  goals: longList,
  constraints: longList,
  acceptanceCriteria: longList,
  /** Not jury-checked, so written without the criteria revision (#1555). */
  userAcceptanceChecks: longList,
  outOfScope: longList,
  deliverable,
};
