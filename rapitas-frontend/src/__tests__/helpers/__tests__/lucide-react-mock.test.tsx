/**
 * lucide-react-mock.test
 *
 * Unit tests for the shared lucide-react mock factory.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { buildLucideMock } from '../lucide-react-mock';

/** Creates a minimal fake "lucide-react" module for testing. */
function makeFakeModule(keys: string[]): () => Promise<unknown> {
  const fakeExports: Record<string, () => null> = {};
  for (const key of keys) {
    fakeExports[key] = () => null;
  }
  return () => Promise.resolve(fakeExports);
}

describe('buildLucideMock', () => {
  it('overrides に指定した test-id が反映される', async () => {
    const mock = await buildLucideMock(makeFakeModule(['Menu', 'Sun']), {
      Menu: 'menu-icon',
      Sun: 'sun-icon',
    });

    const MenuIcon = mock['Menu'] as React.FC<{ className?: string }>;
    const { unmount } = render(<MenuIcon />);
    expect(screen.getByTestId('menu-icon')).toBeInTheDocument();
    unmount();

    const SunIcon = mock['Sun'] as React.FC<{ className?: string }>;
    render(<SunIcon />);
    expect(screen.getByTestId('sun-icon')).toBeInTheDocument();
  });

  it('overrides 未指定の export は ${key}-icon で自動スタブされる', async () => {
    const mock = await buildLucideMock(makeFakeModule(['RefreshCw', 'Repeat']), {});

    const RefreshCwIcon = mock['RefreshCw'] as React.FC<{ className?: string }>;
    const { unmount } = render(<RefreshCwIcon />);
    expect(screen.getByTestId('RefreshCw-icon')).toBeInTheDocument();
    unmount();

    const RepeatIcon = mock['Repeat'] as React.FC<{ className?: string }>;
    render(<RepeatIcon />);
    expect(screen.getByTestId('Repeat-icon')).toBeInTheDocument();
  });

  it('className が透過される', async () => {
    const mock = await buildLucideMock(makeFakeModule(['Globe']), {});

    const GlobeIcon = mock['Globe'] as React.FC<{ className?: string }>;
    render(<GlobeIcon className="text-indigo-500" />);
    expect(screen.getByTestId('Globe-icon')).toHaveClass('text-indigo-500');
  });

  it('importOriginal の全 export が網羅される', async () => {
    const keys = ['A', 'B', 'C', 'D'];
    const mock = await buildLucideMock(makeFakeModule(keys), {});
    for (const key of keys) {
      expect(mock[key]).toBeDefined();
    }
  });

  it('overrides が空の場合もデフォルト test-id で正常動作する', async () => {
    const mock = await buildLucideMock(makeFakeModule(['Lightbulb']), {});

    const LightbulbIcon = mock['Lightbulb'] as React.FC<{ className?: string }>;
    render(<LightbulbIcon />);
    expect(screen.getByTestId('Lightbulb-icon')).toBeInTheDocument();
  });

  it('overrides と未指定 export が混在する場合に両方正しく処理される', async () => {
    const mock = await buildLucideMock(makeFakeModule(['Tag', 'Trash2', 'Repeat']), {
      Tag: 'tag',
      Trash2: 'trash2',
    });

    const TagIcon = mock['Tag'] as React.FC<{ className?: string }>;
    const { unmount: u1 } = render(<TagIcon />);
    expect(screen.getByTestId('tag')).toBeInTheDocument();
    u1();

    const Trash2Icon = mock['Trash2'] as React.FC<{ className?: string }>;
    const { unmount: u2 } = render(<Trash2Icon />);
    expect(screen.getByTestId('trash2')).toBeInTheDocument();
    u2();

    // Repeat has no override → falls back to `${key}-icon`
    const RepeatIcon = mock['Repeat'] as React.FC<{ className?: string }>;
    render(<RepeatIcon />);
    expect(screen.getByTestId('Repeat-icon')).toBeInTheDocument();
  });
});
