/**
 * Audio Transcription Route
 *
 * Accepts audio blobs from the frontend and transcribes them.
 * Primary: Local Whisper via @xenova/transformers (no API key needed).
 * Fallback: OpenAI Whisper API (if local fails and API key is configured).
 *
 * Also provides correction learning endpoints.
 */
import { Elysia, t } from 'elysia';
import { createLogger } from '../../config/logger';
import { getApiKeyForProvider } from '../../utils/ai-client/credentials';
import {
  transcribeLocal,
  applyCorrections,
  recordCorrection,
  getCorrectionPatterns,
  deleteCorrection,
  getCorrectionStats,
} from '../../services/transcription';

const log = createLogger('routes:transcribe');

export const transcribeRouter = new Elysia({ prefix: '/transcribe' })

  /**
   * Transcribe an audio file. Uses local Whisper first, falls back to OpenAI API.
   * Automatically applies learned corrections to the output.
   */
  .post('/', async (context) => {
    const { set } = context;

    try {
      // NOTE: Parse multipart body manually — Elysia's t.File() validation can reject valid FormData.
      const formData = context.body as Record<string, unknown>;
      const audio = formData.audio as Blob | File | undefined;
      const language = (formData.language as string) || 'ja';

      if (!audio || !audio.size) {
        set.status = 400;
        return { error: '音声データが空です' };
      }

      log.info({ audioSize: audio.size, type: audio.type, language }, 'Transcription request received');

      let rawText = '';
      let source = 'local';
      let localError = '';

      // Primary: Local Whisper (no API key required)
      try {
        const audioBuffer = Buffer.from(await audio.arrayBuffer());
        const localResult = await transcribeLocal(audioBuffer, language);

        if (localResult.text.trim()) {
          rawText = localResult.text;
        } else if (localResult.error) {
          localError = localResult.error;
          log.warn({ error: localResult.error }, 'Local Whisper returned error');
        }
      } catch (err) {
        localError = err instanceof Error ? err.message : String(err);
        log.warn({ err }, 'Local Whisper failed');
      }

      // Fallback: OpenAI Whisper API
      if (!rawText) {
        const apiKey = await getApiKeyForProvider('chatgpt');
        if (!apiKey) {
          set.status = 500;
          return {
            error: `文字起こしに失敗: ${localError || '不明なエラー'}。初回はモデル読込に30秒ほどかかります。もう一度お試しください。`,
          };
        }

        const file = new File([audio], 'audio.wav', { type: audio.type || 'audio/wav' });
        const fd = new FormData();
        fd.append('file', file);
        fd.append('model', 'whisper-1');
        fd.append('language', language);
        fd.append('response_format', 'json');

        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}` },
          body: fd,
          signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          log.error({ status: response.status, body: errorBody }, 'Whisper API error');
          set.status = 502;
          return { error: `文字起こしに失敗しました (${response.status})` };
        }

        const result = (await response.json()) as { text: string };
        rawText = result.text;
        source = 'api';
      }

      // Apply learned corrections
      const correctedText = applyCorrections(rawText);
      const wasAutoCorrected = correctedText !== rawText;

      log.info(
        { textLength: correctedText.length, source, autoCorrected: wasAutoCorrected },
        'Transcription completed',
      );

      return {
        text: correctedText,
        rawText: wasAutoCorrected ? rawText : undefined,
        source,
        autoCorrected: wasAutoCorrected,
      };
    } catch (error) {
      log.error({ err: error }, 'Transcription route error');
      set.status = 500;
      return { error: '文字起こし処理でエラーが発生しました' };
    }
  })

  /** Record a user correction for learning. */
  .post(
    '/correct',
    ({ body }) => {
      const { rawText, correctedText } = body;
      recordCorrection(rawText, correctedText);
      return { success: true };
    },
    {
      body: t.Object({
        rawText: t.String(),
        correctedText: t.String(),
      }),
    },
  )

  /** Get all stored correction patterns. */
  .get('/corrections', ({ query }) => {
    const limit = query?.limit ? parseInt(query.limit as string) : 100;
    return { patterns: getCorrectionPatterns(limit) };
  })

  /** Get correction learning statistics. */
  .get('/corrections/stats', () => {
    return getCorrectionStats();
  })

  /** Delete a correction pattern. */
  .delete('/corrections/:id', ({ params, set }) => {
    const id = parseInt(params.id);
    if (isNaN(id)) {
      set.status = 400;
      return { error: 'Invalid ID' };
    }
    const deleted = deleteCorrection(id);
    return { success: deleted };
  });
