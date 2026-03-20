/**
 * score-ring
 *
 * Circular SVG progress ring that displays a numeric quality score for a
 * generated CLAUDE.md. Color transitions from red → amber → green based on
 * the score value.
 */

'use client';

interface ScoreRingProps {
  /** Score value 0-100 / スコア値 0〜100 */
  score: number;
  /** Label text displayed below the ring / リング下部に表示するラベルテキスト */
  label: string;
}

/**
 * Renders an animated SVG score ring with a color-coded numeric value.
 *
 * @param score - numeric score 0-100 / 0〜100の数値スコア
 * @param label - descriptive label rendered beneath the SVG / SVGの下に表示する説明ラベル
 */
export function ScoreRing({ score, label }: ScoreRingProps) {
  const r = 52;
  const circ = 2 * Math.PI * r;
  const fill = circ * (1 - score / 100);
  const col =
    score >= 90 ? 'var(--green)' : score >= 75 ? 'var(--amber)' : 'var(--red)';

  return (
    <div style={{ textAlign: 'center', marginBottom: 24 }}>
      <svg width={124} height={124} viewBox="0 0 124 124">
        <circle
          cx={62}
          cy={62}
          r={r}
          fill="none"
          stroke="var(--s3)"
          strokeWidth={9}
        />
        <circle
          cx={62}
          cy={62}
          r={r}
          fill="none"
          stroke={col}
          strokeWidth={9}
          strokeDasharray={circ}
          strokeDashoffset={fill}
          strokeLinecap="round"
          transform="rotate(-90 62 62)"
          style={{ transition: 'stroke-dashoffset 1.2s ease' }}
        />
        <text
          x={62}
          y={56}
          textAnchor="middle"
          fill={col}
          fontSize={26}
          fontFamily="'Outfit',sans-serif"
          fontWeight={800}
        >
          {score}
        </text>
        <text
          x={62}
          y={74}
          textAnchor="middle"
          fill="var(--muted)"
          fontSize={10}
          fontFamily="'JetBrains Mono',monospace"
        >
          / 100
        </text>
      </svg>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</div>
    </div>
  );
}
