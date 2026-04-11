/**
 * Voice Command Parser
 *
 * Parses transcribed text into actionable commands. Supports navigation,
 * task creation, and task operations. Returns structured commands that
 * the frontend can execute immediately without further AI processing.
 *
 * Fast path: keyword matching (~0ms) vs slow path: AI intent parsing (~2-5s).
 * Always tries fast path first.
 */
import { createLogger } from '../../config';

const log = createLogger('transcription:voice-command');

/** Parsed voice command types. */
export type VoiceCommand =
  | { type: 'navigate'; path: string; label: string }
  | { type: 'create_task'; title: string; description?: string }
  | { type: 'search'; query: string }
  | { type: 'text'; text: string };

/** Navigation keyword mappings (Japanese + English). */
const NAV_COMMANDS: Array<{ keywords: string[]; path: string; label: string }> = [
  {
    keywords: ['ホーム', 'タスク一覧', 'タスクリスト', 'home', 'task list'],
    path: '/',
    label: 'ホーム',
  },
  { keywords: ['ダッシュボード', 'dashboard'], path: '/dashboard', label: 'ダッシュボード' },
  { keywords: ['カレンダー', 'calendar', '予定'], path: '/calendar', label: 'カレンダー' },
  { keywords: ['カンバン', 'kanban', 'ボード'], path: '/kanban', label: 'カンバン' },
  { keywords: ['設定', 'settings', '環境設定'], path: '/settings', label: '設定' },
  {
    keywords: ['フラッシュカード', 'flashcard', '暗記カード'],
    path: '/flashcards',
    label: 'フラッシュカード',
  },
  { keywords: ['試験', '試験目標', 'exam', 'テスト'], path: '/exam-goals', label: '試験目標' },
  { keywords: ['学習目標', 'learning goal'], path: '/learning-goals', label: '学習目標' },
  {
    keywords: ['学習ダッシュボード', 'learning dashboard'],
    path: '/learning/dashboard',
    label: '学習ダッシュボード',
  },
  { keywords: ['習慣', 'habit', 'ハビット'], path: '/habits', label: '習慣' },
  { keywords: ['レポート', 'report', '報告'], path: '/reports', label: 'レポート' },
  { keywords: ['エージェント', 'agent'], path: '/agents', label: 'エージェント' },
  { keywords: ['承認', 'approval', 'レビュー'], path: '/approvals', label: '承認' },
  { keywords: ['ナレッジ', '知識', 'knowledge'], path: '/knowledge', label: 'ナレッジ' },
  { keywords: ['ギットハブ', 'github', 'プルリクエスト'], path: '/github', label: 'GitHub' },
  { keywords: ['集中', 'フォーカス', 'focus', 'ポモドーロ'], path: '/focus', label: '集中モード' },
  { keywords: ['メモ', 'ノート', 'note'], path: '/notes', label: 'ノート' },
  { keywords: ['検索', 'search', '探す'], path: '/search', label: '検索' },
  {
    keywords: ['新しいタスク', 'タスク作成', 'タスクを作成', 'new task', 'create task'],
    path: '/tasks/new',
    label: '新規タスク',
  },
  { keywords: ['オーケストラ', 'orchestra', 'キュー'], path: '/orchestra', label: 'オーケストラ' },
  { keywords: ['ラベル', 'label'], path: '/labels', label: 'ラベル' },
  { keywords: ['カテゴリ', 'category'], path: '/categories', label: 'カテゴリ' },
  { keywords: ['テーマ', 'theme'], path: '/themes', label: 'テーマ' },
];

/** Task creation trigger phrases. */
const CREATE_TRIGGERS = [
  'タスクを作成',
  'タスク作成',
  'タスクを追加',
  'タスク追加',
  'create task',
  'add task',
  'new task',
  'を作って',
  'を追加して',
  'を登録して',
  '作成して',
];

/** Search trigger phrases. */
const SEARCH_TRIGGERS = ['検索', '探して', '見つけて', 'search for', 'find'];

/**
 * Parse transcribed text into a voice command.
 *
 * Priority:
 *   1. Navigation commands (exact keyword match)
 *   2. Task creation (trigger phrase + title extraction)
 *   3. Search (trigger phrase + query extraction)
 *   4. Plain text (no command detected)
 *
 * @param text - Transcribed text / 文字起こしテキスト
 * @returns Parsed voice command / パースされた音声コマンド
 */
export function parseVoiceCommand(text: string): VoiceCommand {
  const normalized = text.trim().toLowerCase();

  // 1. Navigation
  for (const nav of NAV_COMMANDS) {
    for (const kw of nav.keywords) {
      if (normalized.includes(kw.toLowerCase())) {
        log.info({ command: 'navigate', path: nav.path, keyword: kw }, 'Voice navigation command');
        return { type: 'navigate', path: nav.path, label: nav.label };
      }
    }
  }

  // 2. Task creation
  for (const trigger of CREATE_TRIGGERS) {
    if (normalized.includes(trigger.toLowerCase())) {
      // Extract task title: remove the trigger phrase and common filler words
      let title = text.trim();
      for (const t of CREATE_TRIGGERS) {
        title = title.replace(new RegExp(t, 'gi'), '').trim();
      }
      // Remove filler
      title = title
        .replace(/^(えっと|あの|その|ちょっと|えー|あー)\s*/g, '')
        .replace(/^(please|can you|could you)\s*/gi, '')
        .replace(/[。、．，]$/g, '')
        .trim();

      if (title.length > 0) {
        log.info({ command: 'create_task', title }, 'Voice task creation command');
        return { type: 'create_task', title };
      }
    }
  }

  // 3. Search
  for (const trigger of SEARCH_TRIGGERS) {
    if (normalized.includes(trigger.toLowerCase())) {
      let query = text.trim();
      for (const t of SEARCH_TRIGGERS) {
        query = query.replace(new RegExp(t, 'gi'), '').trim();
      }
      query = query.replace(/^(を|で|の|って)\s*/g, '').trim();

      if (query.length > 0) {
        log.info({ command: 'search', query }, 'Voice search command');
        return { type: 'search', query };
      }
    }
  }

  // 4. Plain text
  return { type: 'text', text: text.trim() };
}
