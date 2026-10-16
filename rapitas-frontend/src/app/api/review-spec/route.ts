import { type NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { type ReviewSpecResult, parseReviewQuestions, reviewSystemPrompt } from './review-prompt';

const logger = createLogger('ReviewSpecRoute');

const BACKEND_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:3001').replace(
  'localhost',
  '127.0.0.1',
);

/** Documents to review; the wizard sends whatever it has. */
interface ReviewSpecRequest {
  requirements?: string;
  design?: string;
  adr?: string;
}

/** Mechanical findings from the backend checker, or [] when it is unreachable. */
async function fetchFindings(body: ReviewSpecRequest): Promise<{
  findings: ReviewSpecResult['findings'];
  implementable: boolean;
}> {
  try {
    const res = await fetch(`${BACKEND_URL}/organization/spec-consistency`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return {
      findings: Array.isArray(data.findings) ? data.findings : [],
      implementable: data.implementable !== false,
    };
  } catch (error) {
    // NOTE: Fails OPEN on implementable. The checker being unreachable is an
    // infrastructure problem, and blocking the user's own project on it would
    // be worse than showing a review without the mechanical half.
    logger.warn('spec-consistency check unavailable', { error: String(error) });
    return { findings: [], implementable: true };
  }
}

/** The model's judgement questions, or [] with a reason when the round fails. */
async function fetchQuestions(
  body: ReviewSpecRequest,
): Promise<{ questions: ReviewSpecResult['questions']; degradedReason?: string }> {
  const message = [
    '## requirements.md',
    body.requirements ?? '(なし)',
    '',
    '## design.md',
    body.design ?? '(なし)',
    '',
    '## adr.md',
    body.adr ?? '(なし)',
  ].join('\n');

  try {
    const res = await fetch(`${BACKEND_URL}/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, systemPrompt: reviewSystemPrompt }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const reply = typeof data.response === 'string' ? data.response : (data.message ?? '');
    const questions = parseReviewQuestions(String(reply));
    return questions.length > 0
      ? { questions }
      : { questions: [], degradedReason: 'AIが確認事項を返しませんでした' };
  } catch (error) {
    logger.warn('review question round failed', { error: String(error) });
    return { questions: [], degradedReason: 'AIへの問い合わせに失敗しました' };
  }
}

/**
 * Review a generated specification: mechanical findings plus the decisions a
 * developer would otherwise have to guess.
 *
 * Both halves degrade independently, so a failure in one still returns the
 * other.
 */
export async function POST(request: NextRequest) {
  try {
    const body: ReviewSpecRequest = await request.json();
    const [mechanical, judged] = await Promise.all([fetchFindings(body), fetchQuestions(body)]);
    const result: ReviewSpecResult = {
      findings: mechanical.findings,
      implementable: mechanical.implementable,
      questions: judged.questions,
      degradedReason: judged.degradedReason,
    };
    return NextResponse.json(result);
  } catch (error) {
    logger.error('review-spec failed', { error: String(error) });
    return NextResponse.json({ error: 'review failed' }, { status: 500 });
  }
}
