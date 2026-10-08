'use client';

/**
 * setup-target-fields
 *
 * The two choices made just before scaffolding: which Category the theme is
 * filed under, and which parent folder the project directory is created in.
 * Both were previously unreachable from the UI — the category was hardcoded to
 * 開発 and the output folder always fell back to ~/Projects, even though the
 * backend already accepted a basePath.
 *
 * NOT responsible for performing the setup — result-phase owns that action.
 */
import React, { useEffect, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';

interface Category {
  id: number;
  name: string;
  mode: string;
}

interface SetupTargetFieldsProps {
  /** Chosen category id; null means let the backend fall back to 開発. / 未選択はnull */
  categoryId: number | null;
  onSetCategoryId: (id: number | null) => void;
  /** Parent directory for the project folder; empty means ~/Projects. / 空で ~/Projects */
  basePath: string;
  onSetBasePath: (value: string) => void;
}

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--muted)',
  marginBottom: 8,
};

const hintStyle: React.CSSProperties = { fontSize: 11, color: 'var(--muted)', marginTop: 6 };

/**
 * Renders the category picker and output-folder input.
 *
 * @param props - SetupTargetFieldsProps / SetupTargetFieldsProps参照
 */
export function SetupTargetFields({
  categoryId,
  onSetCategoryId,
  basePath,
  onSetBasePath,
}: SetupTargetFieldsProps) {
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/categories`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (cancelled) return;
        setCategories(Array.isArray(data) ? data : (data?.data ?? []));
      })
      // Fail soft: an empty list hides the picker and the backend applies its
      // 開発 fallback, which is exactly the previous behaviour.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      {categories.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={labelStyle}>カテゴリ</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {categories.map((c) => {
              const selected = c.id === categoryId;
              return (
                <button
                  key={c.id}
                  onClick={() => onSetCategoryId(selected ? null : c.id)}
                  style={{
                    background: selected ? 'rgba(99,102,241,.12)' : 'transparent',
                    border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                    color: selected ? 'var(--accent2)' : 'var(--muted)',
                    borderRadius: 9,
                    padding: '8px 14px',
                    fontSize: 13,
                    fontWeight: selected ? 700 : 500,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    transition: 'all .15s',
                  }}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
          <div style={hintStyle}>
            未選択なら「開発」になります。開発以外を選ぶと自動実行の対象外になります。
          </div>
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <label htmlFor="scaffold-base-path" style={{ ...labelStyle, display: 'block' }}>
          出力先フォルダ
        </label>
        <input
          id="scaffold-base-path"
          type="text"
          value={basePath}
          onChange={(e) => onSetBasePath(e.target.value)}
          placeholder="空欄なら ~/Projects"
          // NOTE: duplicates the visible <label> text — jsx-a11y's
          // control-has-associated-label does not accept htmlFor alone here.
          aria-label="出力先フォルダ"
          spellCheck={false}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            background: 'transparent',
            border: '1.5px solid var(--border)',
            borderRadius: 9,
            padding: '8px 12px',
            fontSize: 13,
            color: 'var(--fg)',
            fontFamily: "'JetBrains Mono',ui-monospace,monospace",
          }}
        />
        <div style={hintStyle}>このフォルダ直下にプロジェクト用のフォルダを作成します。</div>
      </div>
    </>
  );
}
