/**
 * ConcernCreateForm
 *
 * The "add concern" modal: title/detail inputs plus the priority, type, and
 * project (category → theme) pickers and the optional location field. Modal so
 * filing keeps you on the page (continuous adding). Pure presentational — all
 * state lives in useConcerns.
 */
'use client';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { Bug } from 'lucide-react';
import type { Category, Theme } from '@/types';
import { Modal } from '@/components/ui/modal/Modal';
import PriorityIcon from '@/feature/tasks/components/PriorityIcon';
import {
  TYPE_META,
  TYPE_ORDER,
  SEVERITY_ORDER,
  SEVERITY_HINT,
  type ConcernSeverity,
  type ConcernType,
} from './concern-shared';

interface ConcernCreateFormProps {
  open: boolean;
  onClose: () => void;
  titleRef: RefObject<HTMLInputElement | null>;
  newTitle: string;
  setNewTitle: Dispatch<SetStateAction<string>>;
  newDetail: string;
  setNewDetail: Dispatch<SetStateAction<string>>;
  newType: ConcernType;
  setNewType: Dispatch<SetStateAction<ConcernType>>;
  newSeverity: ConcernSeverity;
  setNewSeverity: Dispatch<SetStateAction<ConcernSeverity>>;
  newLocation: string;
  setNewLocation: Dispatch<SetStateAction<string>>;
  newCategoryId: number | null;
  onCategoryChange: (id: number | null) => void;
  newThemeId: number | null;
  setNewThemeId: Dispatch<SetStateAction<number | null>>;
  categories: Category[];
  /** Working-dir themes narrowed by the selected category. */
  filteredThemes: Theme[];
  onSubmit: () => void;
}

/**
 * Render the add-concern modal.
 *
 * @param props - Add-form state, setters, and the submit/close handlers from useConcerns. / useConcerns の追加フォーム状態・セッター・送信/閉じるハンドラ。
 */
export function ConcernCreateForm({
  open,
  onClose,
  titleRef,
  newTitle,
  setNewTitle,
  newDetail,
  setNewDetail,
  newType,
  setNewType,
  newSeverity,
  setNewSeverity,
  newLocation,
  setNewLocation,
  newCategoryId,
  onCategoryChange,
  newThemeId,
  setNewThemeId,
  categories,
  filteredThemes,
  onSubmit,
}: ConcernCreateFormProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={<Bug className="h-4 w-4 text-rose-500" />}
      title="懸念を追加"
      maxWidthClass="max-w-2xl"
      footer={
        <>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            キャンセル
          </button>
          <button
            onClick={onSubmit}
            disabled={!newTitle.trim() || !newDetail.trim()}
            className="rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-600 disabled:opacity-40"
          >
            登録
          </button>
        </>
      }
    >
      <div>
        <input
          ref={titleRef}
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="懸念をひとことで（例: 認証トークンが失効しても再ログインされない）"
          className="mb-2 w-full rounded-lg border border-zinc-200 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-indigo-400 dark:border-zinc-700"
        />
        <textarea
          value={newDetail}
          onChange={(e) => setNewDetail(e.target.value)}
          placeholder="何が問題で、なぜ重要か"
          rows={3}
          className="mb-2 w-full resize-none rounded-lg border border-zinc-200 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-indigo-400 dark:border-zinc-700"
        />
        <div className="flex flex-wrap items-center gap-2">
          {/* Priority — moved below the title (icons like the task list) */}
          <span className="flex items-center gap-1.5">
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">優先度</span>
            <span
              className="flex overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700"
              title="優先度（将来の影響の大きさ）"
            >
              {SEVERITY_ORDER.map((sv) => (
                <button
                  key={sv}
                  type="button"
                  onClick={() => setNewSeverity(sv)}
                  title={SEVERITY_HINT[sv]}
                  className={`px-2 py-1 transition-colors ${
                    newSeverity === sv
                      ? 'bg-zinc-100 dark:bg-zinc-800'
                      : 'opacity-40 hover:opacity-100 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                  }`}
                >
                  <PriorityIcon priority={sv} size="sm" showTitle />
                </button>
              ))}
            </span>
          </span>
          {/* Type — pulldown to keep the row compact */}
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value as ConcernType)}
            className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-800"
          >
            {TYPE_ORDER.map((ty) => (
              <option key={ty} value={ty}>
                {TYPE_META[ty].label}
              </option>
            ))}
          </select>
          {/* Project (category → theme) on one line — always project-scoped */}
          <span className="flex items-center gap-2">
            <select
              value={newCategoryId ?? ''}
              onChange={(e) => onCategoryChange(e.target.value ? parseInt(e.target.value) : null)}
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-800"
            >
              <option value="">カテゴリ</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
            <select
              value={newThemeId ?? ''}
              onChange={(e) => setNewThemeId(e.target.value ? parseInt(e.target.value) : null)}
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-800"
            >
              <option value="">テーマ</option>
              {filteredThemes.map((th) => (
                <option key={th.id} value={th.id}>
                  {th.name}
                </option>
              ))}
            </select>
          </span>
          <input
            value={newLocation}
            onChange={(e) => setNewLocation(e.target.value)}
            placeholder="対象箇所 (任意, 例: src/auth/token.ts:42)"
            className="min-w-[10rem] flex-1 rounded-lg border border-zinc-200 bg-transparent px-2 py-1 text-[11px] outline-none focus:border-indigo-400 dark:border-zinc-700"
          />
        </div>
      </div>
    </Modal>
  );
}
