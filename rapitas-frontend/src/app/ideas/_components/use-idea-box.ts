/**
 * useIdeaBox
 *
 * Composes the IdeaBox sub-hooks (data, form, convert) into a single view model
 * for IdeasClient. Holds NO JSX and no logic of its own beyond wiring.
 */
'use client';
import { useIdeaConvert } from './use-idea-convert';
import { useIdeaData } from './use-idea-data';
import { useIdeaForm } from './use-idea-form';

/**
 * Provide the full IdeaBox view model: filters, pagination, the add/edit form,
 * and the theme-picker conversion flow.
 *
 * @returns State and handlers consumed by IdeasClient and its sub-components. / IdeasClient とサブコンポーネントが使う状態とハンドラ。
 */
export function useIdeaBox() {
  const data = useIdeaData();
  const form = useIdeaForm({ fetchIdeas: data.fetchIdeas, setIdeas: data.setIdeas });
  const convert = useIdeaConvert({ fetchIdeas: data.fetchIdeas });

  return { ...data, ...form, ...convert };
}
