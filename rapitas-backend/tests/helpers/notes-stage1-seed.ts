/**
 * notes-stage1-seed
 *
 * The fixture the notes stage-1 tests share: two workspaces (the NULL
 * partition and workspace 2) with categories, themes, tasks, a folder and
 * notes covering every placement kind, plus a request helper that runs a
 * route in a chosen workspace.
 *
 * NULL partition:
 *   category 1「学習」 ─ theme 10「英語」 ─ task 100 ─ subtask 101 (no theme)
 *   theme 11「ロードマップ」(no category) ─ task 102
 *   folder 5「雑記」
 *   notes: n-theme (theme 10, linked to 100), n-cat (category 1),
 *          n-folder (folder 5), n-none, n-dangling (theme 999 → 未分類),
 *          deliverable-task-101 (theme 10, follows task 101),
 *          n-elsewhere (folder 5, linked to task 102)
 * Workspace 2:
 *   category 2 ─ theme 20 ─ task 200; folder 6; note other-ws (theme 20)
 */
import { createStage1Db, type Stage1Db } from './notes-stage1-db';
import { runInWorkspace } from '../../services/tenancy/workspace-context';

/** A fresh database with the fixture. */
export function seedStage1(): Stage1Db {
  return createStage1Db({
    category: [
      { id: 1, name: '学習', sortOrder: 0 },
      { id: 2, name: '他WSのカテゴリ', workspaceId: 2 },
    ],
    theme: [
      { id: 10, name: '英語', categoryId: 1, sortOrder: 0 },
      { id: 11, name: 'ロードマップ', categoryId: null, sortOrder: 1 },
      { id: 20, name: '他WSのテーマ', categoryId: 2, workspaceId: 2 },
    ],
    task: [
      { id: 100, title: '単元1を学ぶ', themeId: 10, status: 'todo' },
      { id: 101, title: '単元1の問題', themeId: null, parentId: 100, status: 'todo' },
      { id: 102, title: '計画', themeId: 11, status: 'todo' },
      { id: 200, title: '他WSのタスク', themeId: 20, workspaceId: 2 },
    ],
    noteFolder: [
      { id: 5, name: '雑記' },
      { id: 6, name: '他WSのフォルダ', workspaceId: 2 },
    ],
    note: [
      { id: 'n-theme', title: '英語のメモ', content: '過去問の傾向', themeId: 10 },
      { id: 'n-cat', title: 'カテゴリ直下', content: 'まとめ', categoryId: 1 },
      { id: 'n-folder', title: 'フォルダのメモ', content: '買い物', folderId: 5 },
      { id: 'n-none', title: '未分類のメモ', content: 'あとで' },
      { id: 'n-dangling', title: '消えたテーマ', content: '', themeId: 999 },
      {
        id: 'deliverable-task-101',
        title: '問題の成果',
        content: '結果',
        themeId: 10,
        source: 'deliverable',
        sourceTaskId: 101,
        followsTask: true,
      },
      { id: 'n-elsewhere', title: '計画の資料', content: '調査', folderId: 5 },
      { id: 'other-ws', title: '他WS', content: '秘密', themeId: 20, workspaceId: 2 },
    ],
    noteTaskLink: [
      { noteId: 'n-theme', taskId: 100 },
      { noteId: 'n-elsewhere', taskId: 102 },
      { noteId: 'other-ws', taskId: 200, workspaceId: 2 },
    ],
  });
}

type Body = Record<string, unknown>;

/** Something with Elysia's `handle`. */
export interface Handler {
  handle: (req: Request) => Promise<Response> | Response;
}

/**
 * One request, optionally inside a workspace.
 *
 * @param app - The router / ルーター
 * @param path - Path and query / パス
 * @param init - Request init / リクエスト設定
 * @param workspaceId - Run inside this workspace (omit = NULL partition) / ワークスペース
 */
export async function request(
  app: Handler,
  path: string,
  init?: RequestInit,
  workspaceId?: number,
) {
  const run = async () => {
    const res = await app.handle(new Request(`http://localhost${path}`, init));
    return { status: res.status, body: (await res.json()) as Body };
  };
  return workspaceId === undefined ? run() : runInWorkspace(workspaceId, run);
}

/** A JSON request init. */
export const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
