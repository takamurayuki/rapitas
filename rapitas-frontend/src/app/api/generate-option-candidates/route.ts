import { type NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import {
  buildCandidatePrompt,
  parseCandidates,
  normalizeConcept,
  type CandidateLevel,
  type OptionCandidate,
} from './candidates';

const logger = createLogger('GenerateOptionCandidatesRoute');

const BACKEND_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:3001').replace(
  'localhost',
  '127.0.0.1',
);

/**
 * Shorter than generate-proposals' 60s: these candidates only decorate a screen
 * that already works without them, so a slow model must not make the user wait.
 */
const AI_TIMEOUT_MS = 25_000;

const LEVELS: readonly CandidateLevel[] = ['genre', 'subs', 'elements'];

interface CandidateRequest {
  /** The user's own words about what they want to build. / 題材 */
  concept?: string;
  level?: string;
  /** Picks made so far, to keep later levels on-topic. / これまでの選択 */
  picked?: { genre?: string; subs?: string[] };
}

/** What this route returns; candidates are always present, possibly empty. */
interface CandidateResponse {
  candidates: OptionCandidate[];
  /** Set when candidates could not be produced. / 取得できなかった理由 */
  errorCode?:
    | 'no_concept'
    | 'bad_level'
    | 'parse_failed'
    | 'server_error'
    | 'timeout'
    | 'connection_failed';
}

/**
 * Propose selectable options from the user's description of the app.
 *
 * Always answers 200 with a (possibly empty) list: the wizard shows its static
 * catalog alongside these, so an empty result is a thinner screen rather than a
 * failure. The caller distinguishes the cases via `errorCode`.
 */
export async function POST(request: NextRequest): Promise<NextResponse<CandidateResponse>> {
  try {
    const body = (await request.json()) as CandidateRequest;
    const concept = normalizeConcept(body.concept);
    if (!concept) return NextResponse.json({ candidates: [], errorCode: 'no_concept' });

    const level = LEVELS.find((l) => l === body.level);
    if (!level) return NextResponse.json({ candidates: [], errorCode: 'bad_level' });

    const context: string[] = [`作りたいもの: ${concept}`];
    if (body.picked?.genre) context.push(`選んだ領域: ${body.picked.genre}`);
    if (body.picked?.subs?.length) context.push(`選んだ切り口: ${body.picked.subs.join(', ')}`);

    try {
      const response = await fetch(`${BACKEND_URL}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: context.join('\n'),
          systemPrompt: buildCandidatePrompt(level),
          conversationHistory: [],
        }),
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      });

      if (!response.ok) {
        logger.warn('Backend AI chat returned error for option candidates');
        return NextResponse.json({ candidates: [], errorCode: 'server_error' });
      }

      const data = await response.json();
      if (!data.success || !data.message) {
        return NextResponse.json({ candidates: [], errorCode: 'server_error' });
      }

      const candidates = parseCandidates(data.message);
      if (candidates.length === 0) {
        logger.warn('Option candidates could not be parsed from the AI reply');
        return NextResponse.json({ candidates: [], errorCode: 'parse_failed' });
      }
      return NextResponse.json({ candidates });
    } catch (aiError) {
      const timedOut = aiError instanceof DOMException && aiError.name === 'TimeoutError';
      logger.warn('Option candidate generation failed:', aiError);
      return NextResponse.json({
        candidates: [],
        errorCode: timedOut ? 'timeout' : 'connection_failed',
      });
    }
  } catch (error) {
    // A malformed request body still answers 200 with no candidates: the screen
    // this feeds is usable without them, and a 500 would surface as a broken
    // wizard rather than a missing suggestion block.
    logger.error('Error generating option candidates:', error);
    return NextResponse.json({ candidates: [], errorCode: 'server_error' });
  }
}
