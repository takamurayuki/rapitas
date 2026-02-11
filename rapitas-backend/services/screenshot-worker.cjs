/**
 * Screenshot Worker (Node.js)
 *
 * Bun 環境では Playwright の pipe 接続がハングするため、
 * このスクリプトを Node.js サブプロセスとして実行してスクリーンショットを撮影する。
 *
 * 引数: JSON文字列 (stdin 経由)
 * 出力: JSON文字列 (stdout 経由)
 */
const { chromium } = require("playwright");
const { join } = require("path");
const { randomUUID } = require("crypto");
const fs = require("fs");

const MAX_LAUNCH_RETRIES = 2;

/**
 * ブラウザを起動する（リトライ付き）
 */
async function launchBrowser(executablePath) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_LAUNCH_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        process.stderr.write(
          `[ScreenshotWorker] Retry browser launch (attempt ${attempt + 1}/${MAX_LAUNCH_RETRIES + 1})\n`
        );
        // リトライ前に少し待つ
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }

      const browser = await chromium.launch({
        executablePath,
        headless: true,
        timeout: 20000,
        args: [
          "--no-sandbox",
          "--disable-gpu",
          "--disable-dev-shm-usage",
          "--disable-software-rasterizer",
        ],
      });
      return browser;
    } catch (err) {
      lastError = err;
      process.stderr.write(
        `[ScreenshotWorker] Launch attempt ${attempt + 1} failed: ${err.message}\n`
      );
    }
  }
  throw lastError;
}

async function main() {
  // stdin からオプションを読み取り
  let inputData = "";
  for await (const chunk of process.stdin) {
    inputData += chunk;
  }

  const options = JSON.parse(inputData);
  const {
    baseUrl = "http://localhost:3000",
    pages = [{ path: "/", label: "home" }],
    viewport = { width: 1280, height: 720 },
    waitMs = 1500,
    darkMode = false,
    screenshotDir,
  } = options;

  // スクリーンショット保存ディレクトリの確認
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  const targetPages = pages;
  const results = [];

  // ページごとのタイムアウト（ナビゲーション + 待機 + スクリーンショット）
  const perPageTimeoutMs = 30000;

  let browser;
  try {
    const executablePath = chromium.executablePath();
    process.stderr.write(
      `[ScreenshotWorker] Using browser: ${executablePath}\n`
    );

    browser = await launchBrowser(executablePath);

    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
    });

    const page = await context.newPage();

    for (const target of targetPages) {
      const pageStart = Date.now();
      try {
        const url = target.path.startsWith("http")
          ? target.path
          : `${baseUrl}${target.path}`;
        process.stderr.write(`[ScreenshotWorker] Capturing: ${url}\n`);

        // ページごとにタイムアウトを設定
        const capturePromise = (async () => {
          await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 20000,
          });

          await page.waitForTimeout(waitMs);

          if (darkMode) {
            await page.evaluate(() => {
              document.documentElement.classList.add("dark");
            });
            await page.waitForTimeout(500);
          }

          const screenshotId = randomUUID();
          const filename = `${screenshotId}.png`;
          const filePath = join(screenshotDir, filename);

          await page.screenshot({
            path: filePath,
            fullPage: false,
          });

          return {
            id: screenshotId,
            filename,
            path: filePath,
            url: `/screenshots/${filename}`,
            page: target.path,
            label: target.label,
            capturedAt: new Date().toISOString(),
          };
        })();

        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`Page capture timed out after ${perPageTimeoutMs / 1000}s`)), perPageTimeoutMs);
        });

        const result = await Promise.race([capturePromise, timeoutPromise]);

        results.push(result);

        // 逐次出力: 1行1JSON（NDJSON）でタイムアウト時も途中結果を回収可能にする
        process.stdout.write(JSON.stringify(result) + "\n");

        const elapsed = Date.now() - pageStart;
        process.stderr.write(
          `[ScreenshotWorker] Captured: ${target.path} -> ${result.filename} (${Math.round(elapsed / 1000)}s)\n`
        );
      } catch (err) {
        const elapsed = Date.now() - pageStart;
        process.stderr.write(
          `[ScreenshotWorker] Failed to capture ${target.path} (${Math.round(elapsed / 1000)}s): ${err.message}\n`
        );
      }
    }

    await browser.close();
  } catch (err) {
    process.stderr.write(
      `[ScreenshotWorker] Browser launch failed: ${err.message}\n`
    );
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

main().catch((err) => {
  process.stderr.write(`[ScreenshotWorker] Fatal error: ${err.message}\n`);
  process.exit(1);
});
