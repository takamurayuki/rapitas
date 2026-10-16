'use client';
// degraded-notice

/**
 * Banner shown when the generated package is the template scaffold rather than
 * a real specification, naming the reason generation fell back.
 *
 * Exists because the silence was the defect: on 2026-10-08 a ContextFlow run
 * presented the scaffold as a finished "96点" package, and nothing on screen
 * said the AI call had timed out. The documents themselves now carry a banner
 * too, but a user who never opens them still has to be told here.
 */
interface DegradedNoticeProps {
  /** Why generation fell back, from the API. / フォールバック理由 */
  reason?: string;
}

export function DegradedNotice({ reason }: DegradedNoticeProps) {
  return (
    <div
      role="alert"
      style={{
        border: '1px solid rgba(239,68,68,.45)',
        background: 'rgba(239,68,68,.08)',
        borderRadius: 10,
        padding: '16px 20px',
        marginBottom: 20,
      }}
    >
      <div style={{ color: 'var(--red)', fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
        AI生成に失敗したため、テンプレートの雛形を表示しています
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 12, lineHeight: 1.8, margin: 0 }}>
        この内容はアイデア1段落を各項目に差し込んだだけで、実装に着手できる情報量はありません。
        技術選定の意思決定（ADR）も行われていません。このまま作成せず、生成をやり直してください。
      </p>
      {reason && (
        <div
          style={{
            marginTop: 10,
            fontSize: 11,
            fontFamily: "'JetBrains Mono',ui-monospace,monospace",
            color: 'var(--red)',
            wordBreak: 'break-word',
          }}
        >
          {reason}
        </div>
      )}
    </div>
  );
}
