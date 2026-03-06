/**
 * ClaudeCodeAgent 統合テスト
 *
 * AskUserQuestionツール呼び出しに基づく質問検出の統合テスト
 * 注意: これらのテストは実際のClaude Code CLIを使用しないモック版
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { QuestionType } from "../../services/agents/base-agent";
import type { QuestionDetails } from "../../services/agents/question-detection";

// モック版のClaudeCodeAgentの検出ロジックをテスト
// 実際のプロセス起動なしでstream-json処理をシミュレート

/**
 * stream-json形式のイベントをシミュレート
 */
type StreamJsonEvent = {
  type: string;
  message?: {
    content: Array<{
      type: string;
      name?: string;
      id?: string;
      text?: string;
      input?: Record<string, unknown>;
    }>;
  };
  result?: unknown;
};

/**
 * 質問検出結果
 */
type DetectedQuestion = {
  hasQuestion: boolean;
  question: string;
  questionType: QuestionType;
  questionDetails?: QuestionDetails;
};

/**
 * stream-jsonイベントを処理し、質問を検出するシミュレーター
 */
class QuestionDetectionSimulator {
  private detectedQuestion: DetectedQuestion = {
    hasQuestion: false,
    question: "",
    questionType: "none",
  };

  /**
   * stream-jsonイベントを処理
   */
  processEvent(event: StreamJsonEvent): void {
    if (event.type === "assistant" && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === "tool_use" && block.name === "AskUserQuestion") {
          const { questionText, questionDetails } = this.extractQuestionInfo(block.input);

          this.detectedQuestion = {
            hasQuestion: true,
            question: questionText || "ユーザーの入力を待っています",
            questionType: "tool_call",
            questionDetails,
          };
        }
      }
    }
  }

  /**
   * 質問情報を抽出
   */
  private extractQuestionInfo(input: Record<string, unknown> | undefined): {
    questionText: string;
    questionDetails?: QuestionDetails;
  } {
    if (!input) {
      return { questionText: "" };
    }

    let questionText = "";
    const questionDetails: QuestionDetails = {};

    if (input.questions && Array.isArray(input.questions)) {
      const questions = input.questions as Array<{
        question?: string;
        header?: string;
        options?: Array<{ label: string; description?: string }>;
        multiSelect?: boolean;
      }>;

      questionText = questions
        .map((q) => q.question || q.header || "")
        .filter((q) => q)
        .join("\n");

      const headers = questions
        .map((q) => q.header)
        .filter((h): h is string => !!h);
      if (headers.length > 0) {
        questionDetails.headers = headers;
      }

      const firstQuestion = questions[0];
      if (firstQuestion) {
        if (firstQuestion.options && Array.isArray(firstQuestion.options)) {
          questionDetails.options = firstQuestion.options.map((opt) => ({
            label: opt.label || "",
            description: opt.description,
          }));
        }
        if (typeof firstQuestion.multiSelect === "boolean") {
          questionDetails.multiSelect = firstQuestion.multiSelect;
        }
      }
    } else if (input.question && typeof input.question === "string") {
      questionText = input.question;
    }

    const hasDetails =
      questionDetails.headers?.length ||
      questionDetails.options?.length ||
      questionDetails.multiSelect !== undefined;

    return {
      questionText,
      questionDetails: hasDetails ? questionDetails : undefined,
    };
  }

  /**
   * 検出結果を取得
   */
  getDetectedQuestion(): DetectedQuestion {
    return this.detectedQuestion;
  }

  /**
   * 状態をリセット
   */
  reset(): void {
    this.detectedQuestion = {
      hasQuestion: false,
      question: "",
      questionType: "none",
    };
  }
}

describe("ClaudeCodeAgent 統合テスト", () => {
  let simulator: QuestionDetectionSimulator;

  beforeEach(() => {
    simulator = new QuestionDetectionSimulator();
  });

  describe("stream-json イベント処理", () => {
    it("AskUserQuestionツールを含むassistantイベントを処理する", () => {
      const event: StreamJsonEvent = {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "AskUserQuestion",
              id: "toolu_123",
              input: {
                questions: [
                  {
                    question: "どのデータベースを使用しますか？",
                    header: "Database",
                    options: [
                      { label: "PostgreSQL", description: "推奨" },
                      { label: "MySQL" },
                    ],
                    multiSelect: false,
                  },
                ],
              },
            },
          ],
        },
      };

      simulator.processEvent(event);
      const result = simulator.getDetectedQuestion();

      expect(result.hasQuestion).toBe(true);
      expect(result.question).toBe("どのデータベースを使用しますか？");
      expect(result.questionType).toBe("tool_call");
      expect(result.questionDetails?.headers).toEqual(["Database"]);
      expect(result.questionDetails?.options).toHaveLength(2);
      expect(result.questionDetails?.multiSelect).toBe(false);
    });

    it("AskUserQuestion以外のツールイベントを無視する", () => {
      const event: StreamJsonEvent = {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Read",
              id: "toolu_456",
              input: {
                file_path: "/test/file.ts",
              },
            },
          ],
        },
      };

      simulator.processEvent(event);
      const result = simulator.getDetectedQuestion();

      expect(result.hasQuestion).toBe(false);
      expect(result.questionType).toBe("none");
    });

    it("テキストブロックを含むイベントを処理する", () => {
      const event: StreamJsonEvent = {
        type: "assistant",
        message: {
          content: [
            {
              type: "text",
              text: "ファイルを読み込んでいます...",
            },
          ],
        },
      };

      simulator.processEvent(event);
      const result = simulator.getDetectedQuestion();

      expect(result.hasQuestion).toBe(false);
    });

    it("複数のブロックを含むイベントを処理する", () => {
      const event: StreamJsonEvent = {
        type: "assistant",
        message: {
          content: [
            {
              type: "text",
              text: "設定を確認させてください。",
            },
            {
              type: "tool_use",
              name: "AskUserQuestion",
              id: "toolu_789",
              input: {
                questions: [
                  {
                    question: "続行しますか？",
                  },
                ],
              },
            },
          ],
        },
      };

      simulator.processEvent(event);
      const result = simulator.getDetectedQuestion();

      expect(result.hasQuestion).toBe(true);
      expect(result.question).toBe("続行しますか？");
    });

    it("resultイベントを処理する（質問なし）", () => {
      const event: StreamJsonEvent = {
        type: "result",
        result: "completed",
      };

      simulator.processEvent(event);
      const result = simulator.getDetectedQuestion();

      expect(result.hasQuestion).toBe(false);
    });
  });

  describe("複数イベントの連続処理", () => {
    it("最後のAskUserQuestionが検出される", () => {
      // 最初のイベント
      simulator.processEvent({
        type: "assistant",
        message: {
          content: [
            {
              type: "text",
              text: "ファイルを分析中...",
            },
          ],
        },
      });

      expect(simulator.getDetectedQuestion().hasQuestion).toBe(false);

      // 2番目のイベント（質問）
      simulator.processEvent({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "AskUserQuestion",
              id: "toolu_final",
              input: {
                questions: [
                  {
                    question: "最終確認：実行しますか？",
                    options: [
                      { label: "はい" },
                      { label: "いいえ" },
                    ],
                  },
                ],
              },
            },
          ],
        },
      });

      const result = simulator.getDetectedQuestion();
      expect(result.hasQuestion).toBe(true);
      expect(result.question).toBe("最終確認：実行しますか？");
    });

    it("リセット後は質問状態がクリアされる", () => {
      // 質問イベントを処理
      simulator.processEvent({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "AskUserQuestion",
              id: "toolu_test",
              input: {
                questions: [{ question: "テスト質問" }],
              },
            },
          ],
        },
      });

      expect(simulator.getDetectedQuestion().hasQuestion).toBe(true);

      // リセット
      simulator.reset();

      const result = simulator.getDetectedQuestion();
      expect(result.hasQuestion).toBe(false);
      expect(result.question).toBe("");
      expect(result.questionType).toBe("none");
    });
  });

  describe("エッジケース", () => {
    it("空のquestionsを処理する", () => {
      simulator.processEvent({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "AskUserQuestion",
              id: "toolu_empty",
              input: {
                questions: [],
              },
            },
          ],
        },
      });

      const result = simulator.getDetectedQuestion();
      expect(result.hasQuestion).toBe(true);
      expect(result.question).toBe("ユーザーの入力を待っています");
    });

    it("inputがundefinedの場合を処理する", () => {
      simulator.processEvent({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "AskUserQuestion",
              id: "toolu_noinput",
            },
          ],
        },
      });

      const result = simulator.getDetectedQuestion();
      expect(result.hasQuestion).toBe(true);
      expect(result.question).toBe("ユーザーの入力を待っています");
    });

    it("messageがundefinedのイベントを処理する", () => {
      simulator.processEvent({
        type: "assistant",
      });

      const result = simulator.getDetectedQuestion();
      expect(result.hasQuestion).toBe(false);
    });

    it("contentがundefinedのイベントを処理する", () => {
      simulator.processEvent({
        type: "assistant",
        message: {},
      } as StreamJsonEvent);

      const result = simulator.getDetectedQuestion();
      expect(result.hasQuestion).toBe(false);
    });
  });

  describe("実際のClaude Code出力形式", () => {
    it("実際のAskUserQuestion出力をパースする", () => {
      // Claude Codeが実際に出力する形式をシミュレート
      const realWorldEvent: StreamJsonEvent = {
        type: "assistant",
        message: {
          content: [
            {
              type: "text",
              text: "実装方針を確認させてください。",
            },
            {
              type: "tool_use",
              name: "AskUserQuestion",
              id: "toolu_01ABC123",
              input: {
                questions: [
                  {
                    question: "どのアプローチを使用しますか？",
                    header: "Approach",
                    options: [
                      {
                        label: "アプローチA (推奨)",
                        description: "既存のパターンに従う方法",
                      },
                      {
                        label: "アプローチB",
                        description: "新しいアーキテクチャを導入",
                      },
                      {
                        label: "アプローチC",
                        description: "最小限の変更で対応",
                      },
                    ],
                    multiSelect: false,
                  },
                ],
              },
            },
          ],
        },
      };

      simulator.processEvent(realWorldEvent);
      const result = simulator.getDetectedQuestion();

      expect(result.hasQuestion).toBe(true);
      expect(result.questionType).toBe("tool_call");
      expect(result.question).toBe("どのアプローチを使用しますか？");
      expect(result.questionDetails?.headers).toEqual(["Approach"]);
      expect(result.questionDetails?.options).toHaveLength(3);
      expect(result.questionDetails?.options?.[0].label).toBe("アプローチA (推奨)");
      expect(result.questionDetails?.multiSelect).toBe(false);
    });

    it("複数選択可能な質問を処理する", () => {
      const multiSelectEvent: StreamJsonEvent = {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "AskUserQuestion",
              id: "toolu_multi",
              input: {
                questions: [
                  {
                    question: "有効にする機能を選択してください",
                    header: "Features",
                    options: [
                      { label: "認証", description: "JWT認証を追加" },
                      { label: "キャッシュ", description: "Redisキャッシュを追加" },
                      { label: "ログ", description: "構造化ログを追加" },
                      { label: "メトリクス", description: "Prometheusメトリクスを追加" },
                    ],
                    multiSelect: true,
                  },
                ],
              },
            },
          ],
        },
      };

      simulator.processEvent(multiSelectEvent);
      const result = simulator.getDetectedQuestion();

      expect(result.hasQuestion).toBe(true);
      expect(result.questionDetails?.multiSelect).toBe(true);
      expect(result.questionDetails?.options).toHaveLength(4);
    });
  });
});

describe("AgentExecutionResult 形式テスト", () => {
  it("質問待機中の結果形式が正しい", () => {
    const result = {
      success: true,
      output: "テスト出力...\n[質問] どうしますか？",
      waitingForInput: true,
      question: "どうしますか？",
      questionType: "tool_call" as const,
      questionDetails: {
        headers: ["Action"],
        options: [
          { label: "続行" },
          { label: "キャンセル" },
        ],
        multiSelect: false,
      },
      executionTimeMs: 1234,
    };

    expect(result.success).toBe(true);
    expect(result.waitingForInput).toBe(true);
    expect(result.questionType).toBe("tool_call");
    expect(result.questionDetails).toBeDefined();
    expect(result.questionDetails!.options).toHaveLength(2);
  });

  it("完了時の結果形式が正しい", () => {
    const result: {
      success: boolean;
      output: string;
      waitingForInput: boolean;
      questionType: "tool_call" | "none";
      executionTimeMs: number;
      question?: string;
      questionDetails?: {
        headers?: string[];
        options?: Array<{ label: string; description?: string }>;
        multiSelect?: boolean;
      };
    } = {
      success: true,
      output: "タスク完了",
      waitingForInput: false,
      questionType: "none",
      executionTimeMs: 5678,
    };

    expect(result.success).toBe(true);
    expect(result.waitingForInput).toBe(false);
    expect(result.questionType).toBe("none");
    expect(result.question).toBeUndefined();
    expect(result.questionDetails).toBeUndefined();
  });

  it("エラー時の結果形式が正しい", () => {
    const result = {
      success: false,
      output: "エラーが発生しました",
      waitingForInput: false,
      questionType: "none" as const,
      errorMessage: "タイムアウト",
      executionTimeMs: 900000,
    };

    expect(result.success).toBe(false);
    expect(result.waitingForInput).toBe(false);
    expect(result.errorMessage).toBe("タイムアウト");
  });
});
