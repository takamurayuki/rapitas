/**
 * ExecutionCapabilityGuide Tests
 *
 * Verifies that each capability state renders the right copy, the right CTA
 * link, and a discoverable role for assistive tech.
 */
import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExecutionCapabilityGuide } from '../ExecutionCapabilityGuide';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe('ExecutionCapabilityGuide', () => {
  test('renders the no-theme state with a link to /themes', () => {
    render(<ExecutionCapabilityGuide capability="no-theme" />);
    expect(screen.getByText('テーマを設定するとエージェント実行できます')).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /テーマを設定する/ });
    expect(cta).toHaveAttribute('href', '/themes');
  });

  test('renders the no-working-directory state and deep-links by themeId', () => {
    render(<ExecutionCapabilityGuide capability="no-working-directory" themeId={42} />);
    expect(screen.getByText('テーマに作業ディレクトリを設定してください')).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /テーマを編集する/ });
    expect(cta).toHaveAttribute('href', '/themes?edit=42');
  });

  test('falls back to /themes when no-working-directory has no themeId', () => {
    render(<ExecutionCapabilityGuide capability="no-working-directory" />);
    const cta = screen.getByRole('link', { name: /テーマを編集する/ });
    expect(cta).toHaveAttribute('href', '/themes');
  });

  test('renders the no-cli-available state with a link to /setup', () => {
    render(<ExecutionCapabilityGuide capability="no-cli-available" />);
    expect(screen.getByText('CLI が利用可能ではありません')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Claude Code / Codex / Gemini CLI のいずれかをインストールし、ターミナルから実行できる状態にしてください。',
      ),
    ).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /セットアップ状況を確認/ });
    expect(cta).toHaveAttribute('href', '/setup');
  });

  test('exposes the capability via data-attribute and role=status', () => {
    const { container } = render(<ExecutionCapabilityGuide capability="no-theme" />);
    const panel = container.querySelector('[data-capability="no-theme"]');
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute('role')).toBe('status');
  });
});
