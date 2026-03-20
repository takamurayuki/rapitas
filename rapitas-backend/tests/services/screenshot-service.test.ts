/**
 * Screenshot Service テスト
 * スクリーンショットサービスの純粋関数のユニットテスト
 * (Playwrightやスクリーンショット撮影は外部依存のためモック対象外。
 *  detectProjectInfo, hasUIChanges, detectAffectedPages, detectAllPages 等をテスト)
 */
import { describe, test, expect, mock } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const { detectProjectInfo, hasUIChanges, detectAffectedPages, detectPagesFromAgentOutput } =
  await import('../../services/misc/screenshot-service');

describe('detectProjectInfo', () => {
  test('存在しないディレクトリでunknownタイプを返すこと', () => {
    const info = detectProjectInfo('/nonexistent/path/12345');
    expect(info.type).toBe('unknown');
    expect(info.frontendDir).toBeNull();
    expect(info.baseUrl).toBe('http://localhost:3000');
  });

  test('実プロジェクトルートでnextjsを検出できること', () => {
    // rapitas-frontend directory exists, so nextjs should be detected
    const info = detectProjectInfo('C:/Projects/rapitas');
    expect(info.type).toBe('nextjs');
    expect(info.frontendDir).not.toBeNull();
  });

  test('devPortとbaseUrlが設定されること', () => {
    const info = detectProjectInfo('C:/Projects/rapitas');
    expect(info.devPort).toBeGreaterThan(0);
    expect(info.baseUrl).toMatch(/^http:\/\/localhost:\d+$/);
  });
});

describe('hasUIChanges', () => {
  test('ページコンポーネントの変更でtrueを返すこと', () => {
    const result = hasUIChanges(['rapitas-frontend/src/app/calendar/page.tsx']);
    expect(result).toBe(true);
  });

  test('Clientコンポーネントの変更でtrueを返すこと', () => {
    const result = hasUIChanges(['rapitas-frontend/src/app/tasks/TaskDetailClient.tsx']);
    expect(result).toBe(true);
  });

  test('レイアウトファイルの変更でtrueを返すこと', () => {
    const result = hasUIChanges(['rapitas-frontend/src/app/layout.tsx']);
    expect(result).toBe(true);
  });

  test('globals.cssの変更でtrueを返すこと', () => {
    const result = hasUIChanges(['rapitas-frontend/src/app/globals.css']);
    expect(result).toBe(true);
  });

  test('ユーティリティファイルの変更でfalseを返すこと', () => {
    const result = hasUIChanges(['rapitas-frontend/src/utils/format-date.ts']);
    expect(result).toBe(false);
  });

  test('テストファイルの変更でfalseを返すこと', () => {
    const result = hasUIChanges(['rapitas-frontend/src/components/Button.test.tsx']);
    expect(result).toBe(false);
  });

  test('hooksファイルの変更でfalseを返すこと', () => {
    const result = hasUIChanges(['rapitas-frontend/src/hooks/use-dark-mode.ts']);
    expect(result).toBe(false);
  });

  test('バックエンドファイルの変更でfalseを返すこと', () => {
    const result = hasUIChanges([
      'rapitas-backend/routes/tasks.ts',
      'rapitas-backend/services/task/task-service.ts',
    ]);
    expect(result).toBe(false);
  });

  test('空配列でfalseを返すこと', () => {
    const result = hasUIChanges([]);
    expect(result).toBe(false);
  });

  test('型定義ファイルの変更でfalseを返すこと', () => {
    const result = hasUIChanges(['rapitas-frontend/src/types/task.d.ts']);
    expect(result).toBe(false);
  });

  test('共通コンポーネントの変更でfalseを返すこと', () => {
    const result = hasUIChanges(['rapitas-frontend/src/components/common/Button.tsx']);
    expect(result).toBe(false);
  });
});

describe('detectAffectedPages', () => {
  test('App Routerのpage.tsxからルートパスを検出すること', () => {
    const pages = detectAffectedPages(['rapitas-frontend/src/app/calendar/page.tsx']);
    expect(pages).toHaveLength(1);
    expect(pages[0].path).toBe('/calendar');
  });

  test('ルートのpage.tsxからホームページを検出すること', () => {
    const pages = detectAffectedPages(['rapitas-frontend/src/app/page.tsx']);
    expect(pages).toHaveLength(1);
    expect(pages[0].path).toBe('/');
    expect(pages[0].label).toBe('home');
  });

  test('layout.tsxからルートパスを検出すること', () => {
    const pages = detectAffectedPages(['rapitas-frontend/src/app/settings/layout.tsx']);
    expect(pages).toHaveLength(1);
    expect(pages[0].path).toBe('/settings');
  });

  test('globals.cssからホームページを検出すること', () => {
    const pages = detectAffectedPages(['rapitas-frontend/src/app/globals.css']);
    expect(pages).toHaveLength(1);
    expect(pages[0].path).toBe('/');
  });

  test('動的ルート([id])をスキップすること', () => {
    const pages = detectAffectedPages(['rapitas-frontend/src/app/tasks/[id]/page.tsx']);
    expect(pages).toHaveLength(0);
  });

  test('UI変更のないファイルで空配列を返すこと', () => {
    const pages = detectAffectedPages(['rapitas-backend/services/task/task-service.ts']);
    expect(pages).toHaveLength(0);
  });

  test('重複するパスを排除すること', () => {
    const pages = detectAffectedPages([
      'rapitas-frontend/src/app/page.tsx',
      'rapitas-frontend/src/app/globals.css',
    ]);
    // Both point to "/" - should be deduplicated
    expect(pages).toHaveLength(1);
    expect(pages[0].path).toBe('/');
  });
});

describe('detectPagesFromAgentOutput', () => {
  test('localhost URLからページパスを抽出すること', () => {
    const output =
      'I updated the page at http://localhost:3000/calendar and http://localhost:3000/settings';
    const pages = detectPagesFromAgentOutput(output);
    expect(pages).toHaveLength(2);
    expect(pages[0].path).toBe('/calendar');
    expect(pages[1].path).toBe('/settings');
  });

  test('src/app/xxx/page.tsx への言及からパスを抽出すること', () => {
    const output = 'Modified src/app/tasks/page.tsx to add new feature';
    const pages = detectPagesFromAgentOutput(output);
    expect(pages).toHaveLength(1);
    expect(pages[0].path).toBe('/tasks');
  });

  test('URLが含まれない場合に空配列を返すこと', () => {
    const output = 'No page changes were made in this commit';
    const pages = detectPagesFromAgentOutput(output);
    expect(pages).toHaveLength(0);
  });

  test('重複するパスを排除すること', () => {
    const output = 'Visited http://localhost:3000/calendar twice: http://localhost:3000/calendar';
    const pages = detectPagesFromAgentOutput(output);
    expect(pages).toHaveLength(1);
  });
});
