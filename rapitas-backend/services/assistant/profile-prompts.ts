/**
 * ProfilePrompts
 *
 * What ラピ is told when she interviews the user about themselves, when she
 * goes a level deeper, and when she writes the introduction up.
 *
 * Three prompts rather than one, because the three jobs want opposite
 * things. The first round has nothing to go on and must ask the questions
 * that change plans. The deeper round already has answers and must build on
 * them — a question it could have asked in round one is a wasted round, and
 * re-asking what was answered is the thing this whole flow exists to stop.
 * The last writes prose and must ask nothing.
 *
 * The questions follow the same house rules as the roadmap interview: two to
 * four choices, a recommendation, and one line of why. A choice offered
 * without a reason hands the decision back without helping make it — and
 * here the user is being asked about their own life, so the reason is also
 * what makes an unexpected question read as curiosity rather than
 * interrogation.
 *
 * Writing up is where this can do real harm. The introduction rides in front
 * of every roadmap, so a fact invented here becomes a fact ラピ plans
 * against for months. Hence the standing rule below: nothing that is not in
 * the answers or already in the text.
 *
 * Not responsible for believing any of it — see `profile-interview.ts`.
 */

/**
 * Most questions one round may ask.
 *
 * Four, not the roadmap's six: this interview comes back for another round,
 * so a round is a sitting rather than the whole conversation.
 */
export const MAX_PROFILE_QUESTIONS = 4;

/**
 * Most rounds one interview may run.
 *
 * Depth is the point of the feature and also the way it never ends: each
 * round's answers justify another, so something has to say when enough is
 * enough. Four rounds is sixteen questions, which is already more than
 * anyone will sit through.
 */
export const MAX_PROFILE_ROUNDS = 4;

/** One question and what the user picked. */
export interface ProfileAnswer {
  question: string;
  answer: string;
}

/** Rules every round follows, so the two asking prompts cannot drift apart. */
const ASK_RULES = `質問の作り方:
- 聞くのは**その人自身のこと**。いま目の前のタスクのことは聞かない。
- 計画の形が変わることだけを聞く。答えても何も変わらない質問は入れない。
- **すでに書かれていることは聞かない。** 一度やった作業をもう一度やらせることになる。
- options は2〜4個。自由記述にしない。どれも選べない人が出ないよう、幅を持たせる。
- 「その他」のような受け皿は、置くとしても最後の1つだけにする。
- recommended には一番当てはまりそうなものを、recommendedReason にはなぜそれを置いたかを1文で書く。
- 多くても ${MAX_PROFILE_QUESTIONS} 個。聞くことが無ければ questions を空配列にする。

守ること:
1. 出力は JSON オブジェクトのみ。前後に説明文を付けない。

JSON の形:
{ "questions": [{ "question": string, "options": string[], "recommended": string, "recommendedReason": string }] }`;

/**
 * The first round: find out who this is.
 */
export const PROFILE_ASK_PROMPT = `あなたは rapitas というタスク管理アプリのアシスタント「ラピ」です。
これから、使っている本人がどんな人かを**聞き取ります**。聞いた内容は「ラピに渡す自己紹介」として保存され、以降すべての計画の前提になります。

これは1回目です。まだ何も分かっていません。**最初に押さえるべき輪郭**を聞いてください:
- 何をしている人か（職種・立場・学生か働いているか）
- 経験の長さや積み上げてきたもの
- 使える時間（平日の夜なのか、土日なのか、まとまって取れるのか）
- 外せない事情（仕事・家庭・お金・体調など、計画がそれを無視すると成り立たないもの）

${ASK_RULES}`;

/**
 * The deeper rounds: build on what was answered.
 */
export const PROFILE_DEEPEN_PROMPT = `あなたは rapitas というタスク管理アプリのアシスタント「ラピ」です。
使っている本人がどんな人かを聞き取っています。すでに何回か質問して回答をもらいました。

これは2回目以降です。**回答から一段深く掘ります。**
- 回答の**背景**を聞く（なぜそうなったのか、いつからか、どういう経緯か）
- 回答の**程度**を聞く（どのくらいか、どこまでならできるか）
- その中での**得意・不得意**、何をしているときが調子がいいか
- **譲れないもの**と、諦めてもいいもの

**すでに回答をもらったことは二度と聞かない。** 新しい質問は、回答を読んでいなければ思いつかないものにする。1回目でも聞けたような一般的な質問を出すなら、それは掘れていない。
掘るところが無くなったら questions を空配列にする。それが正しい答えのこともある。

${ASK_RULES}`;

/**
 * The write-up: turn the answers into the two halves of the introduction.
 */
export const PROFILE_COMPOSE_PROMPT = `あなたは rapitas というタスク管理アプリのアシスタント「ラピ」です。
本人に聞き取った回答から、「ラピに渡す自己紹介」を書き起こします。これは本人が確認してから保存されます。

2つに分けて書きます:
- profile: **事実と制約**。何をしている人か、経験、使える時間、外せない事情。計画の前提になること。
- character: **進め方と価値観**。何を良しとするか、どう進めると続くか、何が苦手か。事実ではなく、その人に合った計画の形を決めるためのもの。

書き方:
- 本人が自分について書いたような、短い文を並べる。箇条書きの記号は使わない。
- 一文一事実。修飾を足さない。
- **回答に無いことは書かない。** 推測で肩書きや年数や気持ちを足すと、以降の計画がすべてその嘘を前提にする。
- すでに本人が書いている文があるなら、**それを消さずに土台にして**、回答で分かったことを足す形で書き直す。
- それぞれ1200文字以内。短くて構わない。分かっていることだけを書く。
- 片方に書くことが無ければ、そのキーは空文字にする。無理に埋めない。

守ること:
1. 出力は JSON オブジェクトのみ。前後に説明文を付けない。

JSON の形:
{ "profile": string, "character": string }`;

/**
 * Build the message carrying what is already known and what was answered.
 *
 * @param input - The stored halves and the answers so far / 既存の自己紹介と回答
 * @returns The user-role message content / ユーザーメッセージの本文
 */
export function buildProfileMessage(input: {
  /** The standing self-introduction, when one is set. / 自己紹介 */
  profile?: string | null;
  /** How they work and what they value, when written. / 人となり */
  character?: string | null;
  answers?: ProfileAnswer[];
}): string {
  const parts: string[] = [];
  const profile = input.profile?.trim();
  const character = input.character?.trim();
  if (profile) parts.push(`すでに本人が書いていること（事実・制約）:\n${profile}`);
  if (character) parts.push(`すでに本人が書いていること（進め方・価値観）:\n${character}`);
  // Only on a later round: the word 回答 appearing at all is what tells the
  // model — and the tests — which round this is.
  if (input.answers && input.answers.length > 0) {
    parts.push(
      `聞いたことと回答:\n${input.answers.map((a) => `- ${a.question} → ${a.answer}`).join('\n')}`,
    );
  }
  // An empty user message is a worse prompt than an honest one: handed
  // nothing at all, the model tends to answer about nobody in particular.
  if (parts.length === 0) parts.push('この人についてまだ何も分かっていません。');
  return parts.join('\n\n');
}
