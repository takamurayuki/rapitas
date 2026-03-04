/**
 * デバッグログ解析APIエンドポイント
 */

import { Elysia, t, type Context } from "elysia";
import DebugLogAnalyzer, {
  LogType,
  LogLevel,
  LogAnalysisResult,
  AnalyzeOptions
} from "../utils/debug-log-analyzer";
import { LogParserFactory } from "../utils/debug-log-parsers";

// デバッグログ解析ルーター
export const debugLogsRouter = new Elysia({ prefix: "/debug-logs" })
  // ログ解析エンドポイント
  .post(
    "/analyze",
    async (context) => {
      const { body } = context as { body: { content: string; type?: string; options?: any } };
      try {
        const { content, type, options  } = body as any;

        // アナライザーのインスタンスを作成
        const analyzer = new DebugLogAnalyzer();

        // 追加パーサーを登録
        const additionalParsers = LogParserFactory.createAllParsers();
        additionalParsers.forEach(parser => analyzer.addParser(parser));

        // ログタイプの自動検出または指定されたタイプを使用
        const detectedType = type || analyzer.detectLogType(content);

        // ログを解析
        const result = analyzer.analyze(content, options);

        return {
          success: true,
          result,
          detectedType
        };
      } catch (error) {
        console.error("Log analysis error:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "ログ解析中にエラーが発生しました"
        };
      }
    },
    {
      body: t.Object({
        content: t.String({
          minLength: 1,
          error: "ログコンテンツは必須です"
        }),
        type: t.Optional(
          t.Union([
            t.Literal("json"),
            t.Literal("syslog"),
            t.Literal("apache_common"),
            t.Literal("apache_combined"),
            t.Literal("nginx"),
            t.Literal("nodejs"),
            t.Literal("custom"),
            t.Literal("unknown")
          ])
        ),
        options: t.Optional(
          t.Object({
            filter: t.Optional(
              t.Object({
                level: t.Optional(
                  t.Union([
                    t.Literal("trace"),
                    t.Literal("debug"),
                    t.Literal("info"),
                    t.Literal("warn"),
                    t.Literal("error"),
                    t.Literal("fatal")
                  ])
                ),
                startTime: t.Optional(t.String()),
                endTime: t.Optional(t.String()),
                source: t.Optional(t.String()),
                searchText: t.Optional(t.String())
              })
            ),
            limit: t.Optional(t.Number({ minimum: 1, maximum: 10000 }))
          })
        )
      }),
      detail: {
        tags: ["Debug Logs"],
        summary: "ログを解析",
        description: "デバッグログを解析し、構造化されたデータと統計情報を返します"
      }
    }
  )

  // ログタイプの検出
  .post(
    "/detect-type",
    async (context) => {
      const { body } = context as { body: { content: string } };
      try {
        const { content  } = body as any;

        const analyzer = new DebugLogAnalyzer();
        const additionalParsers = LogParserFactory.createAllParsers();
        additionalParsers.forEach(parser => analyzer.addParser(parser));

        const detectedType = analyzer.detectLogType(content);

        return {
          success: true,
          type: detectedType
        };
      } catch (error) {
        console.error("Type detection error:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "タイプ検出中にエラーが発生しました"
        };
      }
    },
    {
      body: t.Object({
        content: t.String({ minLength: 1 })
      }),
      detail: {
        tags: ["Debug Logs"],
        summary: "ログタイプを検出",
        description: "ログコンテンツからログタイプを自動検出します"
      }
    }
  )

  // ストリーム解析エンドポイント（大きなファイル用）
  .post(
    "/analyze-stream",
    async (context) => {
      const { body, set } = context as { body: { url: string; type?: string; options?: any }; set: any };
      try {
        const { url, type, options  } = body as any;

        // URLからログをストリーミングで取得
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch log from URL: ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("Failed to create stream reader");
        }

        const decoder = new TextDecoder();
        const analyzer = new DebugLogAnalyzer();
        const additionalParsers = LogParserFactory.createAllParsers();
        additionalParsers.forEach(parser => analyzer.addParser(parser));

        const entries: any[] = [];
        let buffer = "";

        // ストリーム処理
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) continue;

            // 各行を解析（本来はanalyzeStreamを使うべきですが、簡略化）
            const lineResult = analyzer.analyze(line, options);
            if (lineResult.entries.length > 0) {
              entries.push(...lineResult.entries);
            }

            // リミットチェック
            if (options?.limit && entries.length >= options.limit) {
              reader.cancel();
              break;
            }
          }
        }

        // 残りのバッファを処理
        if (buffer.trim()) {
          const lineResult = analyzer.analyze(buffer, options);
          if (lineResult.entries.length > 0) {
            entries.push(...lineResult.entries);
          }
        }

        // 全体の解析結果を生成
        const fullContent = entries.map(e => e.raw).join('\n');
        const result = analyzer.analyze(fullContent, options);

        return {
          success: true,
          result,
          processedLines: entries.length
        };
      } catch (error) {
        console.error("Stream analysis error:", error);
        set.status = 500;
        return {
          success: false,
          error: error instanceof Error ? error.message : "ストリーム解析中にエラーが発生しました"
        };
      }
    },
    {
      body: t.Object({
        url: t.String({ format: "uri" }),
        type: t.Optional(
          t.Union([
            t.Literal("json"),
            t.Literal("syslog"),
            t.Literal("apache_common"),
            t.Literal("apache_combined"),
            t.Literal("nginx"),
            t.Literal("nodejs"),
            t.Literal("custom"),
            t.Literal("unknown")
          ])
        ),
        options: t.Optional(
          t.Object({
            filter: t.Optional(
              t.Object({
                level: t.Optional(t.String()),
                startTime: t.Optional(t.String()),
                endTime: t.Optional(t.String()),
                source: t.Optional(t.String()),
                searchText: t.Optional(t.String())
              })
            ),
            limit: t.Optional(t.Number({ minimum: 1, maximum: 100000 }))
          })
        )
      }),
      detail: {
        tags: ["Debug Logs"],
        summary: "ログをストリーム解析",
        description: "URLから大きなログファイルをストリーミングで解析します"
      }
    }
  )

  // サポートされているログタイプの一覧
  .get(
    "/supported-types",
    async () => {
      return {
        success: true,
        types: [
          {
            id: "json",
            name: "JSON",
            description: "JSON形式のログ",
            example: '{"timestamp":"2024-01-01T00:00:00Z","level":"info","message":"Test"}'
          },
          {
            id: "syslog",
            name: "Syslog",
            description: "標準的なSyslog形式",
            example: "<14>Jan 1 00:00:00 hostname process[1234]: Test message"
          },
          {
            id: "apache_common",
            name: "Apache Common Log",
            description: "Apache Common Log形式",
            example: '127.0.0.1 - - [01/Jan/2024:00:00:00 +0000] "GET /index.html HTTP/1.1" 200 1234'
          },
          {
            id: "apache_combined",
            name: "Apache Combined Log",
            description: "Apache Combined Log形式（RefererとUser-Agent付き）",
            example: '127.0.0.1 - - [01/Jan/2024:00:00:00 +0000] "GET /index.html HTTP/1.1" 200 1234 "-" "Mozilla/5.0"'
          },
          {
            id: "nginx",
            name: "Nginx",
            description: "Nginx標準ログ形式",
            example: '127.0.0.1 - - [01/Jan/2024:00:00:00 +0000] "GET /index.html HTTP/1.1" 200 1234 "-" "Mozilla/5.0"'
          },
          {
            id: "nodejs",
            name: "Node.js",
            description: "Node.jsアプリケーションログ",
            example: "[2024-01-01T00:00:00.000Z] INFO: Application started"
          },
          {
            id: "docker",
            name: "Docker",
            description: "Dockerコンテナログ",
            example: '{"log":"Application started\\n","stream":"stdout","time":"2024-01-01T00:00:00.000Z"}'
          },
          {
            id: "postgresql",
            name: "PostgreSQL",
            description: "PostgreSQLサーバーログ",
            example: "2024-01-01 00:00:00.000 UTC [1234] LOG: database system is ready"
          },
          {
            id: "python",
            name: "Python",
            description: "Python loggingモジュールの標準形式",
            example: "2024-01-01 00:00:00,000 - app.main - INFO - Application started"
          }
        ]
      };
    },
    {
      detail: {
        tags: ["Debug Logs"],
        summary: "サポートされているログタイプ",
        description: "解析可能なログタイプの一覧を返します"
      }
    }
  );