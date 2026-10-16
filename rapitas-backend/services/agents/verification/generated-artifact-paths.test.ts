/**
 * generated-artifact-paths.test
 *
 * Task 1107 was failed for scope drift on "本タスクと無関係な既存キー" inside
 * rapitas-frontend/messages/{en,ja}.json — files no one edits by hand. They are
 * emitted from messages/fragments/ by generate-messages.mjs, so their churn is a
 * build artifact, not the agent widening its scope. The jury could not know
 * that, because the diff it scores carries no such marking.
 *
 * Every path below was confirmed against the generator that writes it, because
 * marking a HAND-WRITTEN file as generated is the dangerous direction: it would
 * tell the jury to excuse real scope creep.
 */
import { describe, test, expect } from 'bun:test';
import { isGeneratedArtifact, generatedArtifactReason } from './generated-artifact-paths';

describe('isGeneratedArtifact', () => {
  test('i18n メッセージは fragments からの生成物', () => {
    expect(isGeneratedArtifact('rapitas-frontend/messages/ja.json')).toBe(true);
    expect(isGeneratedArtifact('rapitas-frontend/messages/en.json')).toBe(true);
  });

  // The fragments themselves ARE hand-written — editing one is the real change.
  test('fragments 本体は生成物ではない', () => {
    expect(isGeneratedArtifact('rapitas-frontend/messages/fragments/ja/01-common.json')).toBe(
      false,
    );
  });

  test('prisma の desktop スキーマと生成 SQL', () => {
    expect(isGeneratedArtifact('rapitas-backend/prisma/schema.desktop/core.prisma')).toBe(true);
    expect(isGeneratedArtifact('rapitas-backend/src/generated/sqlite-init-sql.ts')).toBe(true);
  });

  // The source schema is hand-edited; only the desktop copy is generated.
  test('prisma/schema/ の元スキーマは生成物ではない', () => {
    expect(isGeneratedArtifact('rapitas-backend/prisma/schema/core.prisma')).toBe(false);
  });

  test('.generated. を名前に持つファイル', () => {
    expect(
      isGeneratedArtifact('rapitas-backend/services/workflow/workflow-types.guards.generated.ts'),
    ).toBe(true);
    expect(isGeneratedArtifact('rapitas-backend/docs/boundary-guide.generated.md')).toBe(true);
  });

  test('ルートバレル (routes/<domain>/index.ts)', () => {
    expect(isGeneratedArtifact('rapitas-backend/routes/workflow/index.ts')).toBe(true);
  });

  // A route HANDLER is hand-written; only the domain's index.ts barrel is not.
  test('ルートの実装ファイルは生成物ではない', () => {
    expect(isGeneratedArtifact('rapitas-backend/routes/workflow/halt-release.routes.ts')).toBe(
      false,
    );
    expect(isGeneratedArtifact('rapitas-backend/routes/workflow/handlers/index.ts')).toBe(false);
  });

  test('通常のソースは生成物ではない', () => {
    expect(isGeneratedArtifact('rapitas-backend/services/workflow/halt-release.ts')).toBe(false);
    expect(isGeneratedArtifact('rapitas-frontend/src/components/ui/date-field/DateField.tsx')).toBe(
      false,
    );
  });

  test('Windows 形式の区切り文字でも判定できる', () => {
    expect(isGeneratedArtifact('rapitas-frontend\\messages\\ja.json')).toBe(true);
  });
});

describe('generatedArtifactReason', () => {
  test('生成物には理由を返す(陪審への説明に使う)', () => {
    const r = generatedArtifactReason('rapitas-frontend/messages/ja.json');
    expect(r).toBeTruthy();
    expect(r).toContain('fragments');
  });

  test('生成物でなければ null', () => {
    expect(generatedArtifactReason('rapitas-backend/services/workflow/halt-release.ts')).toBeNull();
  });
});
