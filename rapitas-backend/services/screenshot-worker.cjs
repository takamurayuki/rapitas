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
        timeout: 30000,
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
    waitMs = 5000,
    darkMode = false,
    screenshotDir,
  } = options;

  // スクリーンショット保存ディレクトリの確認
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  const targetPages = pages.slice(0, 5);
  const results = [];

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
      try {
        const url = target.path.startsWith("http")
          ? target.path
          : `${baseUrl}${target.path}`;
        process.stderr.write(`[ScreenshotWorker] Capturing: ${url}\n`);

        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
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

        results.push({
          id: screenshotId,
          filename,
          path: filePath,
          url: `/screenshots/${filename}`,
          page: target.path,
          label: target.label,
          capturedAt: new Date().toISOString(),
        });

        process.stderr.write(
          `[ScreenshotWorker] Captured: ${target.path} -> ${filename}\n`
        );
      } catch (err) {
        process.stderr.write(
          `[ScreenshotWorker] Failed to capture ${target.path}: ${err.message}\n`
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

  // 結果を stdout に JSON で出力
  process.stdout.write(JSON.stringify(results));
}

main().catch((err) => {
  process.stderr.write(`[ScreenshotWorker] Fatal error: ${err.message}\n`);
  process.stdout.write(JSON.stringify([]));
  process.exit(1);
});
