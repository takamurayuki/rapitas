import { type NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { type ClaudeMdRequest, type GenerateResult, systemPrompt } from './document-package-prompt';
import { buildFallbackResponse } from './fallback-package';

const logger = createLogger('GenerateClaudeMdRoute');

const BACKEND_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:3001').replace(
  'localhost',
  '127.0.0.1',
);

/**
 * Parse the AI JSON envelope into the document package, tolerating code fences
 * and surrounding prose. / コードフェンスや前後の文章を許容してJSONを抽出する。
 */
function parseAIResponse(content: string): GenerateResult | null {
  let cleaned = content.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  cleaned = cleaned.trim();

  const accept = (parsed: Record<string, unknown>): GenerateResult | null => {
    if (typeof parsed.claude_md !== 'string' || !parsed.claude_md) return null;
    return {
      tech_rationale: typeof parsed.tech_rationale === 'string' ? parsed.tech_rationale : '',
      score: typeof parsed.score === 'number' ? parsed.score : 95,
      requirements: typeof parsed.requirements === 'string' ? parsed.requirements : '',
      design: typeof parsed.design === 'string' ? parsed.design : '',
      // Missing `adr` is tolerated rather than rejected: a model that produced
      // three good documents and dropped the fourth is still worth shipping,
      // and the empty tab is visible in the wizard.
      adr: typeof parsed.adr === 'string' ? parsed.adr : '',
      claude_md: parsed.claude_md,
    };
  };

  try {
    return accept(JSON.parse(cleaned));
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*"claude_md"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return accept(JSON.parse(jsonMatch[0]));
      } catch {
        // Fall through
      }
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body: ClaudeMdRequest = await request.json();
    const { genre, subs, elems, plat, scale, prio, proposal } = body;

    const userMessage = `
アプリ名: ${proposal.name}
コンセプト: ${proposal.concept}
ジャンル: ${genre} / ${subs}
追加機能: ${elems}
プラットフォーム: ${plat}
規模: ${scale}
優先事項: ${prio}
独自機能: ${proposal.unique}
技術ヒント: ${proposal.tech_hint?.join('、') || ''}
`.trim();

    // Try AI generation via backend
    // Captured so the fallback can say WHY it is a fallback.
    let degradedReason: string | null = null;
    try {
      const response = await fetch(`${BACKEND_URL}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          systemPrompt,
          conversationHistory: [],
          // NOTE: Must be requested explicitly. The backend's aux-AI maps an
          // unspecified model to Haiku (claude-cli-provider's toCliModel) to
          // stay light on the shared subscription — correct for the many small
          // aux calls, wrong for this one: it runs once per project and has to
          // weigh alternatives and trade-offs for the ADRs. A full model id is
          // sent rather than the "sonnet" alias so the API-mode provider
          // (RAPITAS_AUX_AI=api) resolves it too.
          model: 'claude-sonnet-5',
          // Ask the backend for a longer CLI cap than its 120s default, which
          // tripped on nearly every attempt and silently returned the
          // hardcoded fallback. Measured on 2026-10-08: the four documents
          // take 155s on Sonnet uncontended, but 449s when another CLI call
          // was running against the same subscription — so the cap is set at
          // the provider's own RAPITAS_AUX_AI_CLI_MAX_TIMEOUT_MS ceiling
          // (600s, which clamps this) rather than just above the happy path.
          timeoutMs: 600000,
        }),
        // The fetch cap must OUTLAST the CLI cap, otherwise this aborts first
        // and the real backend error ("Claude CLI timed out") never surfaces.
        signal: AbortSignal.timeout(620000),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.message) {
          const parsed = parseAIResponse(data.message);
          if (parsed) {
            return NextResponse.json(parsed);
          }
          degradedReason = 'AIの応答を4文書JSONとして解釈できませんでした';
          logger.warn('AI response could not be parsed as valid document-package JSON');
        } else {
          degradedReason = `バックエンドがエラーを返しました: ${String(data?.error ?? 'unknown')}`;
          logger.warn('Backend AI chat returned success=false:', data);
        }
      } else {
        const errData = await response.json().catch(() => ({}) as Record<string, unknown>);
        degradedReason = `バックエンドがエラーを返しました: ${String(errData?.error ?? response.status)}`;
        logger.warn('Backend AI chat returned error:', errData);
      }
    } catch (aiError) {
      degradedReason = `AI呼び出しが失敗しました: ${aiError instanceof Error ? aiError.message : String(aiError)}`;
      logger.warn('AI generation failed, falling back to mock data:', aiError);
    }

    // Fallback. `degraded` + `degradedReason` ride along so the wizard can say
    // the package is a scaffold instead of presenting it as a finished spec —
    // the silence here is what blocked the ContextFlow run (2026-10-08).
    return NextResponse.json({
      ...buildFallbackResponse(proposal, plat, scale),
      degraded: true,
      degradedReason: degradedReason ?? 'AI生成に失敗しました（理由不明）',
    });
  } catch (error) {
    logger.error('Error generating document package:', error);
    return NextResponse.json({ error: 'ドキュメントの生成に失敗しました' }, { status: 500 });
  }
}
