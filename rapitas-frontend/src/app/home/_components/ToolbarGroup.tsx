/**
 * ToolbarGroup
 *
 * A tinted, rounded frame with a small inline label that groups related
 * toolbar actions (タスク管理 vs タスク実行). Not responsible for the actions.
 *
 * NOTE: The label sits inline, left of the buttons, so the group only adds
 * width. Its 4px padding keeps it at 46px around the 38px buttons, under the
 * toolbar row's 62px floor, so the row height (and the page scroll) does not
 * change (asked 2026-11-21).
 */
import type { ReactNode } from 'react';

interface ToolbarGroupProps {
  /** Stable id for the group (data-toolbar-group). / グループの識別子 */
  id: string;
  /** Short label shown inside the frame. / 枠内の見出し */
  label: string;
  children: ReactNode;
}

/**
 * Frame a set of related toolbar actions under one short label.
 *
 * @param props.id - Group id / グループの識別子
 * @param props.label - Inline label / 見出し
 * @param props.children - The actions / 操作ボタン
 * @returns The framed group / 枠で囲んだグループ
 */
export function ToolbarGroup({ id, label, children }: ToolbarGroupProps) {
  return (
    <div
      data-toolbar-group={id}
      className="flex items-center gap-2 rounded-xl bg-zinc-100/80 p-1 pl-2.5 dark:bg-zinc-800/50"
    >
      <span className="text-[11px] font-semibold tracking-wide whitespace-nowrap text-zinc-500 select-none dark:text-zinc-400">
        {label}
      </span>
      {children}
    </div>
  );
}
