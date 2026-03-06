/**
 * 質問検出ロジックのテスト
 *
 * キーベース判定システムのテスト
 * AskUserQuestionツール呼び出しに基づく質問検出をテスト
 */

import { describe, it, expect } from "bun:test";
import {
  extractQuestionInfo,
  detectQuestionFromToolCall,
  createInitialWaitingState,
  updateWaitingStateFromDetection,
  tolegacyQuestionType,
  toExecutionResultFormat,
  inferQuestionCategory,
  generateQuestionId,
  validateQuestionKey,
  parseQuestionKeyFromString,
  extractQuestionKeyFromObject,
  createQuestionKeyFromToolCall,
  type QuestionKey,
  type QuestionDetails,
  type QuestionDetectionResult,
  type QuestionWaitingState,
} from "../../services/agents/question-detection";

describe("質問検出ロジック", () => {
  describe("extractQuestionInfo", () => {
    it("undefinedの入力に対して空の結果を返す", () => {
      const result = extractQuestionInfo(undefined);
      expect(result.questionText).toBe("");
      expect(result.questionDetails).toBeUndefined();
    });

    it("空のオブジェクトに対して空の結果を返す", () => {
      const result = extractQuestionInfo({});
      expect(result.questionText).toBe("");
      expect(result.questionDetails).toBeUndefined();
    });

    it("単一のquestionフィールドから質問テキストを抽出する", () => {
      const input = {
        question: "どのフレームワークを使用しますか？",
      };
      const result = extractQuestionInfo(input);
      expect(result.questionText).toBe("どのフレームワークを使用しますか？");
      expect(result.questionDetails).toBeUndefined();
    });

    it("questions配列から質問テキストを抽出する", () => {
      const input = {
        questions: [
          {
            question: "どのデータベースを使用しますか？",
            header: "Database",
          },
        ],
      };
      const result = extractQuestionInfo(input);
      expect(result.questionText).toBe("どのデータベースを使用しますか？");
      expect(result.questionDetails?.headers).toEqual(["Database"]);
    });

    it("複数のquestionsから質問テキストを結合する", () => {
      const input = {
        questions: [
          { question: "質問1" },
          { question: "質問2" },
        ],
      };
      const result = extractQuestionInfo(input);
      expect(result.questionText).toBe("質問1\n質問2");
    });

    it("選択肢を含むquestionsから詳細を抽出する", () => {
      const input = {
        questions: [
          {
            question: "どのフレームワークを使用しますか？",
            header: "Framework",
            options: [
              { label: "React", description: "Reactを使用" },
              { label: "Vue", description: "Vueを使用" },
              { label: "Angular", description: "Angularを使用" },
            ],
            multiSelect: false,
          },
        ],
      };
      const result = extractQuestionInfo(input);

      expect(result.questionText).toBe("どのフレームワークを使用しますか？");
      expect(result.questionDetails?.headers).toEqual(["Framework"]);
      expect(result.questionDetails?.options).toHaveLength(3);
      expect(result.questionDetails?.options?.[0]).toEqual({
        label: "React",
        description: "Reactを使用",
      });
      expect(result.questionDetails?.multiSelect).toBe(false);
    });

    it("multiSelectがtrueの場合を処理する", () => {
      const input = {
        questions: [
          {
            question: "使用する機能を選択してください",
            header: "Features",
            options: [
              { label: "認証" },
              { label: "キャッシュ" },
              { label: "ログ" },
            ],
            multiSelect: true,
          },
        ],
      };
      const result = extractQuestionInfo(input);

      expect(result.questionDetails?.multiSelect).toBe(true);
    });

    it("headerのみの質問を処理する", () => {
      const input = {
        questions: [
          {
            header: "Database Type",
            options: [
              { label: "PostgreSQL" },
              { label: "MySQL" },
            ],
          },
        ],
      };
      const result = extractQuestionInfo(input);

      // questionがない場合はheaderを質問テキストとして使用
      expect(result.questionText).toBe("Database Type");
      expect(result.questionDetails?.headers).toEqual(["Database Type"]);
    });

    it("空のquestions配列を処理する", () => {
      const input = {
        questions: [],
      };
      const result = extractQuestionInfo(input);
      expect(result.questionText).toBe("");
      expect(result.questionDetails).toBeUndefined();
    });

    it("descriptionがないオプションを処理する", () => {
      const input = {
        questions: [
          {
            question: "選択してください",
            options: [
              { label: "オプション1" },
              { label: "オプション2" },
            ],
          },
        ],
      };
      const result = extractQuestionInfo(input);

      expect(result.questionDetails?.options).toEqual([
        { label: "オプション1", description: undefined },
        { label: "オプション2", description: undefined },
      ]);
    });
  });

  describe("inferQuestionCategory", () => {
    it("選択肢がある場合はselectionを返す", () => {
      const input = {
        questions: [
          {
            question: "どれを選びますか？",
            options: [{ label: "A" }, { label: "B" }],
          },
        ],
      };
      expect(inferQuestionCategory(input)).toBe("selection");
    });

    it("確認系のキーワードが含まれる場合はconfirmationを返す", () => {
      const input = {
        questions: [
          { question: "続けてもよろしいですか？" },
        ],
      };
      expect(inferQuestionCategory(input)).toBe("confirmation");
    });

    it("英語の確認系キーワードも検出する", () => {
      const input = {
        questions: [
          { question: "Do you want to proceed?" },
        ],
      };
      expect(inferQuestionCategory(input)).toBe("confirmation");
    });

    it("デフォルトはclarificationを返す", () => {
      const input = {
        questions: [
          { question: "どのような機能が必要ですか？" },
        ],
      };
      expect(inferQuestionCategory(input)).toBe("clarification");
    });

    it("undefinedの場合はclarificationを返す", () => {
      expect(inferQuestionCategory(undefined)).toBe("clarification");
    });
  });

  describe("generateQuestionId", () => {
    it("一意のIDを生成する", () => {
      const id1 = generateQuestionId();
      const id2 = generateQuestionId();
      expect(id1).not.toBe(id2);
    });

    it("q_プレフィックスを持つ", () => {
      const id = generateQuestionId();
      expect(id.startsWith("q_")).toBe(true);
    });
  });

  describe("createQuestionKeyFromToolCall", () => {
    it("正しい構造のQuestionKeyを生成する", () => {
      const input = {
        questions: [
          { question: "テスト質問" },
        ],
      };
      const key = createQuestionKeyFromToolCall(input, 300);

      expect(key.status).toBe("awaiting_user_input");
      expect(key.question_id.startsWith("q_")).toBe(true);
      expect(key.question_type).toBe("clarification");
      expect(key.requires_response).toBe(true);
      expect(key.timeout_seconds).toBe(300);
    });

    it("選択肢がある場合はselectionタイプになる", () => {
      const input = {
        questions: [
          {
            question: "選択してください",
            options: [{ label: "A" }, { label: "B" }],
          },
        ],
      };
      const key = createQuestionKeyFromToolCall(input);

      expect(key.question_type).toBe("selection");
    });
  });

  describe("detectQuestionFromToolCall", () => {
    it("AskUserQuestionツールを検出する", () => {
      const result = detectQuestionFromToolCall("AskUserQuestion", {
        questions: [{ question: "テスト質問" }],
      });

      expect(result.hasQuestion).toBe(true);
      expect(result.questionText).toBe("テスト質問");
      expect(result.detectionMethod).toBe("tool_call");
      expect(result.questionKey).toBeDefined();
      expect(result.questionKey?.status).toBe("awaiting_user_input");
    });

    it("AskUserQuestion以外のツールは質問なしを返す", () => {
      const result = detectQuestionFromToolCall("Read", {
        file_path: "/test/file.ts",
      });

      expect(result.hasQuestion).toBe(false);
      expect(result.questionText).toBe("");
      expect(result.detectionMethod).toBe("none");
      expect(result.questionKey).toBeUndefined();
    });

    it("入力がない場合もデフォルトの質問テキストを返す", () => {
      const result = detectQuestionFromToolCall("AskUserQuestion", undefined);

      expect(result.hasQuestion).toBe(true);
      expect(result.questionText).toBe("ユーザーの入力を待っています");
    });
  });

  describe("createInitialWaitingState", () => {
    it("初期状態を正しく生成する", () => {
      const state = createInitialWaitingState();

      expect(state.hasQuestion).toBe(false);
      expect(state.question).toBe("");
      expect(state.questionType).toBe("none");
      expect(state.questionDetails).toBeUndefined();
      expect(state.questionKey).toBeUndefined();
    });
  });

  describe("updateWaitingStateFromDetection", () => {
    it("検出結果から待機状態を更新する", () => {
      const detection: QuestionDetectionResult = {
        hasQuestion: true,
        questionText: "テスト質問",
        questionKey: {
          status: "awaiting_user_input",
          question_id: "q_test",
          question_type: "clarification",
          requires_response: true,
        },
        questionDetails: { headers: ["Test"] },
        detectionMethod: "tool_call",
      };

      const state = updateWaitingStateFromDetection(detection);

      expect(state.hasQuestion).toBe(true);
      expect(state.question).toBe("テスト質問");
      expect(state.questionType).toBe("tool_call");
      expect(state.questionDetails?.headers).toEqual(["Test"]);
      expect(state.questionKey?.question_id).toBe("q_test");
    });

    it("質問なしの場合は初期状態を返す", () => {
      const detection: QuestionDetectionResult = {
        hasQuestion: false,
        questionText: "",
        detectionMethod: "none",
      };

      const state = updateWaitingStateFromDetection(detection);

      expect(state.hasQuestion).toBe(false);
      expect(state.question).toBe("");
      expect(state.questionType).toBe("none");
    });
  });

  describe("tolegacyQuestionType", () => {
    it("tool_callはtool_callを返す", () => {
      expect(tolegacyQuestionType("tool_call")).toBe("tool_call");
    });

    it("key_basedはtool_callを返す", () => {
      expect(tolegacyQuestionType("key_based")).toBe("tool_call");
    });

    it("noneはnoneを返す", () => {
      expect(tolegacyQuestionType("none")).toBe("none");
    });
  });

  describe("toExecutionResultFormat", () => {
    it("待機状態を実行結果形式に変換する", () => {
      const state: QuestionWaitingState = {
        hasQuestion: true,
        question: "テスト質問",
        questionType: "tool_call",
        questionDetails: { headers: ["Test"] },
      };

      const result = toExecutionResultFormat(state);

      expect(result.waitingForInput).toBe(true);
      expect(result.question).toBe("テスト質問");
      expect(result.questionType).toBe("tool_call");
      expect(result.questionDetails?.headers).toEqual(["Test"]);
    });

    it("質問なしの場合はundefinedを返す", () => {
      const state: QuestionWaitingState = {
        hasQuestion: false,
        question: "",
        questionType: "none",
      };

      const result = toExecutionResultFormat(state);

      expect(result.waitingForInput).toBe(false);
      expect(result.question).toBeUndefined();
      expect(result.questionType).toBe("none");
    });
  });

  describe("validateQuestionKey", () => {
    it("有効なQuestionKeyを検証する", () => {
      const key: QuestionKey = {
        status: "awaiting_user_input",
        question_id: "q_test",
        question_type: "clarification",
        requires_response: true,
      };

      expect(validateQuestionKey(key)).toBe(true);
    });

    it("timeout_secondsがある場合も検証する", () => {
      const key = {
        status: "awaiting_user_input",
        question_id: "q_test",
        question_type: "selection",
        requires_response: true,
        timeout_seconds: 300,
      };

      expect(validateQuestionKey(key)).toBe(true);
    });

    it("不正なstatusを拒否する", () => {
      const key = {
        status: "invalid",
        question_id: "q_test",
        question_type: "clarification",
        requires_response: true,
      };

      expect(validateQuestionKey(key)).toBe(false);
    });

    it("不正なquestion_typeを拒否する", () => {
      const key = {
        status: "awaiting_user_input",
        question_id: "q_test",
        question_type: "invalid",
        requires_response: true,
      };

      expect(validateQuestionKey(key)).toBe(false);
    });

    it("必須フィールドがない場合を拒否する", () => {
      expect(validateQuestionKey({})).toBe(false);
      expect(validateQuestionKey(null)).toBe(false);
      expect(validateQuestionKey(undefined)).toBe(false);
    });

    it("timeout_secondsが数値でない場合を拒否する", () => {
      const key = {
        status: "awaiting_user_input",
        question_id: "q_test",
        question_type: "clarification",
        requires_response: true,
        timeout_seconds: "300",
      };

      expect(validateQuestionKey(key)).toBe(false);
    });
  });

  describe("parseQuestionKeyFromString", () => {
    it("有効なJSON文字列からQuestionKeyをパースする", () => {
      const jsonStr = JSON.stringify({
        status: "awaiting_user_input",
        question_id: "q_test",
        question_type: "clarification",
        requires_response: true,
      });

      const result = parseQuestionKeyFromString(jsonStr);

      expect(result).not.toBeNull();
      expect(result?.status).toBe("awaiting_user_input");
    });

    it("無効なJSON文字列はnullを返す", () => {
      expect(parseQuestionKeyFromString("invalid json")).toBeNull();
    });

    it("有効なJSONだがQuestionKeyでない場合はnullを返す", () => {
      expect(parseQuestionKeyFromString('{"foo": "bar"}')).toBeNull();
    });
  });

  describe("extractQuestionKeyFromObject", () => {
    it("オブジェクト自体がQuestionKeyの場合に抽出する", () => {
      const obj = {
        status: "awaiting_user_input",
        question_id: "q_test",
        question_type: "clarification",
        requires_response: true,
      };

      const result = extractQuestionKeyFromObject(obj);

      expect(result).not.toBeNull();
      expect(result?.question_id).toBe("q_test");
    });

    it("questionKeyフィールドから抽出する", () => {
      const obj = {
        someOtherField: "value",
        questionKey: {
          status: "awaiting_user_input",
          question_id: "q_nested",
          question_type: "selection",
          requires_response: true,
        },
      };

      const result = extractQuestionKeyFromObject(obj);

      expect(result).not.toBeNull();
      expect(result?.question_id).toBe("q_nested");
    });

    it("QuestionKeyが見つからない場合はnullを返す", () => {
      const obj = { foo: "bar" };

      expect(extractQuestionKeyFromObject(obj)).toBeNull();
    });
  });
});

describe("stream-json形式のAskUserQuestionツール検出", () => {
  // stream-jsonイベントのシミュレーション
  const simulateStreamJsonEvent = (
    toolName: string,
    input: Record<string, unknown>
  ) => {
    return {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: toolName,
            id: "toolu_test123",
            input,
          },
        ],
      },
    };
  };

  it("AskUserQuestionツールを検出する", () => {
    const event = simulateStreamJsonEvent("AskUserQuestion", {
      questions: [
        {
          question: "テスト質問",
        },
      ],
    });

    const block = event.message.content[0];
    expect(block.name).toBe("AskUserQuestion");
    expect(block.type).toBe("tool_use");

    // 新しいキーベース判定システムで検出
    const result = detectQuestionFromToolCall(block.name, block.input);
    expect(result.hasQuestion).toBe(true);
    expect(result.questionKey).toBeDefined();
  });

  it("AskUserQuestion以外のツールを無視する", () => {
    const event = simulateStreamJsonEvent("Read", {
      file_path: "/test/file.ts",
    });

    const block = event.message.content[0];
    const result = detectQuestionFromToolCall(block.name, block.input);
    expect(result.hasQuestion).toBe(false);
  });

  it("質問内容を正しく抽出する", () => {
    const event = simulateStreamJsonEvent("AskUserQuestion", {
      questions: [
        {
          question: "どのアプローチを使用しますか？",
          header: "Approach",
          options: [
            { label: "アプローチA", description: "説明A" },
            { label: "アプローチB", description: "説明B" },
          ],
          multiSelect: false,
        },
      ],
    });

    const block = event.message.content[0];
    const result = detectQuestionFromToolCall(block.name, block.input);

    expect(result.questionText).toBe("どのアプローチを使用しますか？");
    expect(result.questionDetails?.headers).toEqual(["Approach"]);
    expect(result.questionDetails?.options).toHaveLength(2);
    expect(result.questionKey?.question_type).toBe("selection");
  });
});

describe("質問待機状態の管理", () => {
  it("AgentExecutionResultの型が正しい", () => {
    // 型チェックテスト
    const result = {
      success: true,
      output: "テスト出力",
      waitingForInput: true,
      question: "テスト質問",
      questionType: "tool_call" as const,
      questionDetails: {
        headers: ["Test"],
        options: [{ label: "Option1" }],
        multiSelect: false,
      },
      questionKey: {
        status: "awaiting_user_input" as const,
        question_id: "q_test",
        question_type: "selection" as const,
        requires_response: true,
      },
    };

    expect(result.waitingForInput).toBe(true);
    expect(result.questionType).toBe("tool_call");
    expect(result.questionDetails?.headers).toEqual(["Test"]);
    expect(result.questionKey?.status).toBe("awaiting_user_input");
  });

  it("質問なしの場合の状態", () => {
    const result: {
      success: boolean;
      output: string;
      waitingForInput: boolean;
      questionType: "tool_call" | "none";
      question?: string;
      questionDetails?: QuestionDetails;
      questionKey?: QuestionKey;
    } = {
      success: true,
      output: "完了",
      waitingForInput: false,
      questionType: "none",
    };

    expect(result.waitingForInput).toBe(false);
    expect(result.questionType).toBe("none");
    expect(result.question).toBeUndefined();
    expect(result.questionKey).toBeUndefined();
  });
});

describe("QuestionKeyの完全性チェック", () => {
  it("要件で指定されたフォーマットを満たす", () => {
    // 要件で指定されたキーフォーマット:
    // {
    //   "status": "awaiting_user_input" | "processing" | "completed",
    //   "question_id": "unique_identifier",
    //   "question_type": "clarification" | "confirmation" | "selection",
    //   "requires_response": boolean,
    //   "timeout_seconds": number (optional)
    // }

    const key = createQuestionKeyFromToolCall(
      { questions: [{ question: "テスト" }] },
      300
    );

    // status
    expect(["awaiting_user_input", "processing", "completed"]).toContain(key.status);

    // question_id
    expect(typeof key.question_id).toBe("string");
    expect(key.question_id.length).toBeGreaterThan(0);

    // question_type
    expect(["clarification", "confirmation", "selection"]).toContain(key.question_type);

    // requires_response
    expect(typeof key.requires_response).toBe("boolean");

    // timeout_seconds (optional)
    expect(key.timeout_seconds).toBe(300);
  });

  it("すべてのstatusタイプが有効", () => {
    const validStatuses = ["awaiting_user_input", "processing", "completed"];
    for (const status of validStatuses) {
      const key = {
        status,
        question_id: "q_test",
        question_type: "clarification",
        requires_response: true,
      };
      expect(validateQuestionKey(key)).toBe(true);
    }
  });

  it("すべてのquestion_typeが有効", () => {
    const validTypes = ["clarification", "confirmation", "selection"];
    for (const qtype of validTypes) {
      const key = {
        status: "awaiting_user_input",
        question_id: "q_test",
        question_type: qtype,
        requires_response: true,
      };
      expect(validateQuestionKey(key)).toBe(true);
    }
  });
});
