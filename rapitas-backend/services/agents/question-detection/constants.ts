/**
 * 質問判定システム - 定数
 */

/**
 * 質問タイムアウトのデフォルト秒数（5分 = 300秒）
 * ユーザーからの回答がない場合、この時間経過後にエージェントが自動的に継続
 */
export const DEFAULT_QUESTION_TIMEOUT_SECONDS = 300;

/**
 * 質問タイムアウトの最小秒数（30秒）
 */
export const MIN_QUESTION_TIMEOUT_SECONDS = 30;

/**
 * 質問タイムアウトの最大秒数（30分 = 1800秒）
 */
export const MAX_QUESTION_TIMEOUT_SECONDS = 1800;
