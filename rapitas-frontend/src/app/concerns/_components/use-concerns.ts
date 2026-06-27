/**
 * useConcerns
 *
 * Composes the Concern Backlog sub-hooks (data, form) into a single view model
 * for ConcernsClient. Holds NO JSX and no logic of its own beyond wiring.
 */
'use client';
import { useConcernData } from './use-concern-data';
import { useConcernForm } from './use-concern-form';

/**
 * Provide the full Concern Backlog view model: list, filters, pagination, and
 * the add form plus the create/convert/delete/publish actions.
 *
 * @returns State and handlers consumed by ConcernsClient and its
 *   sub-components. / ConcernsClient とサブコンポーネントが使う状態とハンドラ。
 */
export function useConcerns() {
  const data = useConcernData();
  const form = useConcernForm({ fetchConcerns: data.fetchConcerns });

  return { ...data, ...form };
}
