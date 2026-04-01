/**
 * TitleCleaner
 *
 * Pure utility for cleaning LLM-generated task titles.
 * Has no external dependencies to keep it testable in isolation.
 */

/**
 * LLMが生成したタイトル文字列をクリーニングする
 *
 * @param raw - LLMの生の出力 / raw LLM output
 * @returns クリーニング済みタイトル / cleaned title string
 */
export function cleanGeneratedTitle(raw: string): string {
  let title = raw.trim();

  // 複数行の場合は最初の行のみ使用
  if (title.includes('\n')) {
    title = title.split('\n')[0].trim();
  }

  // 引用符・括弧の除去
  title = title.replace(/^["'「」『』【】\[\]()（）]+|["'「」『』【】\[\]()（）]+$/g, '');

  // LLMが付けがちなプレフィックスを除去
  title = title.replace(/^(?:タイトル|題名|件名|title)\s*[:：]\s*/i, '');

  // 番号プレフィックスを除去（例: "1. ", "- "）
  title = title.replace(/^\d+[.)]\s*/, '');
  title = title.replace(/^[-・]\s*/, '');

  // NOTE: プレフィックス除去後に露出した引用符・括弧を再度除去
  title = title.replace(/^["'「」『』【】\[\]()（）]+|["'「」『』【】\[\]()（）]+$/g, '');

  // 句点・感嘆符等の除去
  title = title.replace(/[。！？!?]+$/g, '');

  // 複数文の場合は最初のもののみ
  if (title.includes('。')) {
    title = title.split('。')[0];
  }

  // NOTE: 日本語を含まない純粋な英語ハイフン区切り（例: "user-auth-fix"）はスペース区切りにする
  if (/^[a-zA-Z0-9-]+$/.test(title) && title.includes('-')) {
    title = title.replace(/-/g, ' ');
  }

  // 日本語テキスト中のハイフン区切りをスペースに変換
  title = title.replace(/\s*[-–—]\s*/g, ' ');

  // 連続スペースの正規化
  title = title.replace(/\s{2,}/g, ' ').trim();

  // 40文字制限
  if (title.length > 40) {
    // 単語の途中で切らないよう、最後の助詞・接続詞の前で切る
    const truncated = title.slice(0, 40);
    const lastParticle = truncated.search(/[のをにはでがとも][^のをにはでがとも]*$/);
    if (lastParticle > 20) {
      title = truncated.slice(0, lastParticle + 1);
    } else {
      title = truncated;
    }
  }

  return title;
}
