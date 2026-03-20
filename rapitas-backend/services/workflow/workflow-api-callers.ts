/**
 * Workflow API Callers
 *
 * Thin wrappers around the Anthropic and OpenAI REST APIs used when an
 * API-type agent (not a CLI agent) is assigned to a workflow role.
 * Also provides the API-key decryption helper used by the orchestrator.
 */

/**
 * Call the Anthropic Messages API and return the assistant text.
 *
 * @param apiKey - Plain-text Anthropic API key. / Anthropic APIキー（平文）
 * @param model - Model identifier (e.g. "claude-sonnet-4-20250514"). / モデルID
 * @param systemPrompt - System prompt text. / システムプロンプト
 * @param userMessage - User message text. / ユーザーメッセージ
 * @returns Concatenated text content from the response. / レスポンスのテキスト内容
 * @throws {Error} When the API responds with a non-2xx status. / APIが非2xxを返した場合
 */
export async function callAnthropicAPI(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      // NOTE: anthropic-version is required; the 2023-06-01 header is the stable baseline version.
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192, // NOTE: Claude API hard limit per single request.
      system: systemPrompt || undefined,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${errorBody}`);
  }

  const data = (await response.json()) as { content: Array<{ type: string; text: string }> };
  return data.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

/**
 * Call the OpenAI Chat Completions API (or a compatible endpoint) and return the assistant text.
 *
 * @param apiKey - Plain-text OpenAI (or Azure OpenAI) API key. / APIキー（平文）
 * @param model - Model identifier (e.g. "gpt-4o"). / モデルID
 * @param systemPrompt - System prompt text. / システムプロンプト
 * @param userMessage - User message text. / ユーザーメッセージ
 * @param endpoint - Optional custom base URL for Azure OpenAI. / Azureカスタムベースurl（省略可）
 * @returns The first choice's message content. / 最初の選択肢のメッセージ内容
 * @throws {Error} When the API responds with a non-2xx status. / APIが非2xxを返した場合
 */
export async function callOpenAIAPI(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  endpoint?: string,
): Promise<string> {
  const baseUrl = endpoint || 'https://api.openai.com/v1';
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: userMessage },
      ],
      max_tokens: 8192, // NOTE: OpenAI hard cap per request.
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errorBody}`);
  }

  const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content || '';
}

/**
 * Decrypt an encrypted API key stored in the database.
 *
 * Falls back to returning the value as-is if the encryption utility is not
 * available or the value is already plain-text.
 *
 * @param encrypted - The encrypted (or plain-text) API key value. / 暗号化済みまたは平文のAPIキー
 * @returns Decrypted plain-text API key. / 復号済みの平文APIキー
 */
export async function decryptApiKey(encrypted: string): Promise<string> {
  try {
    const { decrypt } = await import('../../utils/common/encryption');
    return decrypt(encrypted);
  } catch {
    // Return as-is if not encrypted or utility unavailable
    return encrypted;
  }
}
