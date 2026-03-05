/**
 * Git操作ヘルパー
 * AgentOrchestratorからGit関連の操作を分離
 */
import { exec } from "child_process";
import { promisify } from "util";
import { createLogger } from "../../../config/logger";

const execAsync = promisify(exec);
const logger = createLogger("git-operations");

/**
 * Git操作を提供するクラス
 */
export class GitOperations {
  /**
   * 作業ディレクトリのgit diffを取得
   */
  async getGitDiff(workingDirectory: string): Promise<string> {
    try {
      const { stdout } = await execAsync("git diff", {
        cwd: workingDirectory,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout;
    } catch (error) {
      logger.error({ err: error }, "Failed to get git diff");
      return "";
    }
  }

  /**
   * ステージされていない変更も含めた全diffを取得
   */
  async getFullGitDiff(workingDirectory: string): Promise<string> {
    try {
      // ステージされた変更
      const { stdout: staged } = await execAsync("git diff --cached", {
        cwd: workingDirectory,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      });
      // ステージされていない変更
      const { stdout: unstaged } = await execAsync("git diff", {
        cwd: workingDirectory,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      });
      // 新規ファイル
      const { stdout: untracked } = await execAsync(
        "git ls-files --others --exclude-standard",
        {
          cwd: workingDirectory,
          encoding: "utf8",
        },
      );

      let result = "";
      if (staged) result += "=== Staged Changes ===\n" + staged + "\n";
      if (unstaged) result += "=== Unstaged Changes ===\n" + unstaged + "\n";
      if (untracked.trim()) result += "=== New Files ===\n" + untracked + "\n";

      return result || "No changes detected";
    } catch (error) {
      logger.error({ err: error }, "Failed to get full git diff");
      return "";
    }
  }

  /**
   * 変更をコミット
   */
  async commitChanges(
    workingDirectory: string,
    message: string,
    taskTitle?: string,
  ): Promise<{ success: boolean; commitHash?: string; error?: string }> {
    try {
      // すべての変更をステージ
      await execAsync("git add -A", { cwd: workingDirectory });

      // コミットメッセージを作成
      const fullMessage = taskTitle
        ? `${message}\n\nTask: ${taskTitle}\n\nCo-Authored-By: Claude Code <noreply@anthropic.com>`
        : `${message}\n\nCo-Authored-By: Claude Code <noreply@anthropic.com>`;

      // コミット
      await execAsync(
        `git commit -m "${fullMessage.replace(/"/g, '\\"')}"`,
        { cwd: workingDirectory, encoding: "utf8" },
      );

      // コミットハッシュを取得
      const { stdout: hash } = await execAsync("git rev-parse HEAD", {
        cwd: workingDirectory,
        encoding: "utf8",
      });

      return { success: true, commitHash: hash.trim() };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * PRを作成
   */
  async createPullRequest(
    workingDirectory: string,
    title: string,
    body: string,
    baseBranch: string = "main",
  ): Promise<{
    success: boolean;
    prUrl?: string;
    prNumber?: number;
    error?: string;
  }> {
    try {
      // ghコマンドのパス
      const ghPath =
        process.platform === "win32"
          ? '"C:\\Program Files\\GitHub CLI\\gh.exe"'
          : "gh";

      // 現在のブランチ名を取得
      const { stdout: currentBranch } = await execAsync(
        "git branch --show-current",
        {
          cwd: workingDirectory,
          encoding: "utf8",
        },
      );

      // リモートにプッシュ
      await execAsync(`git push -u origin ${currentBranch.trim()}`, {
        cwd: workingDirectory,
      });

      // PR作成
      const { stdout } = await execAsync(
        `${ghPath} pr create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}" --base ${baseBranch}`,
        { cwd: workingDirectory, encoding: "utf8" },
      );

      // PR URLからPR番号を抽出
      const prUrl = stdout.trim();
      const prMatch = prUrl.match(/\/pull\/(\d+)/);

      if (!prMatch || !prMatch[1]) {
        return { success: false, error: "Failed to parse PR number from URL" };
      }

      const prNumber = prMatch ? parseInt(prMatch[1], 10) : undefined;

      return { success: true, prUrl, prNumber };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * PRを自動マージする
   * コミット数が閾値以上の場合はsquash merge、未満の場合は通常のmerge commitを使用
   */
  async mergePullRequest(
    workingDirectory: string,
    prNumber: number,
    commitThreshold: number = 5,
  ): Promise<{
    success: boolean;
    mergeStrategy?: "squash" | "merge";
    error?: string;
  }> {
    try {
      const ghPath =
        process.platform === "win32"
          ? '"C:\\Program Files\\GitHub CLI\\gh.exe"'
          : "gh";

      // PRのコミット数を取得
      const { stdout } = await execAsync(
        `${ghPath} pr view ${prNumber} --json commits --jq ".commits | length"`,
        { cwd: workingDirectory, encoding: "utf8" },
      );
      const commitCount = parseInt(stdout.trim(), 10) || 1;
      const mergeStrategy =
        commitCount >= commitThreshold ? "squash" : "merge";
      const mergeFlag =
        mergeStrategy === "squash" ? "--squash" : "--merge";

      // マージ + リモートブランチ削除
      await execAsync(
        `${ghPath} pr merge ${prNumber} ${mergeFlag} --delete-branch`,
        { cwd: workingDirectory, encoding: "utf8" },
      );

      // ベースブランチに戻って最新化
      await execAsync("git checkout master", {
        cwd: workingDirectory,
      });
      await execAsync("git pull", { cwd: workingDirectory });

      return { success: true, mergeStrategy };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 変更を元に戻す
   */
  async revertChanges(workingDirectory: string): Promise<boolean> {
    try {
      // ステージされた変更を取り消し
      await execAsync("git reset HEAD", { cwd: workingDirectory });
      // 変更を破棄
      await execAsync("git checkout -- .", { cwd: workingDirectory });
      // 新規ファイルを削除
      await execAsync("git clean -fd", { cwd: workingDirectory });
      return true;
    } catch (error) {
      logger.error({ err: error }, "Failed to revert changes");
      return false;
    }
  }

  /**
   * 新しいブランチを作成してチェックアウト
   */
  async createBranch(
    workingDirectory: string,
    branchName: string,
  ): Promise<boolean> {
    try {
      // 既存ブランチの存在チェック
      const { stdout } = await execAsync(`git branch --list ${branchName}`, {
        cwd: workingDirectory,
      });

      if (stdout.trim()) {
        // 既存ブランチが存在する場合はチェックアウト
        logger.info(`[createBranch] Branch ${branchName} already exists, checking out`);
        await execAsync(`git checkout ${branchName}`, {
          cwd: workingDirectory,
        });
      } else {
        // 新規ブランチを作成
        logger.info(`[createBranch] Creating new branch ${branchName}`);
        await execAsync(`git checkout -b ${branchName}`, {
          cwd: workingDirectory,
        });
      }
      return true;
    } catch (error) {
      logger.error({ err: error }, "Failed to create/checkout branch");
      return false;
    }
  }

  /**
   * コミットを作成（フル機能版）
   */
  async createCommit(
    workingDirectory: string,
    message: string,
  ): Promise<{
    hash: string;
    branch: string;
    filesChanged: number;
    additions: number;
    deletions: number;
  }> {
    // 現在のブランチ名を取得
    const { stdout: currentBranch } = await execAsync(
      "git branch --show-current",
      {
        cwd: workingDirectory,
        encoding: "utf8",
      },
    );
    const branch = currentBranch.trim();

    // フィーチャーブランチでない場合は新規作成
    if (branch === "main" || branch === "master" || branch === "develop") {
      const timestamp = Date.now();
      const featureBranch = `feature/auto-${timestamp}`;
      await execAsync(`git checkout -b ${featureBranch}`, {
        cwd: workingDirectory,
      });
    }

    // すべての変更をステージ
    await execAsync("git add -A", { cwd: workingDirectory });

    // 変更統計を取得
    const { stdout: diffStat } = await execAsync(
      "git diff --cached --numstat",
      {
        cwd: workingDirectory,
        encoding: "utf8",
      },
    );

    let filesChanged = 0;
    let additions = 0;
    let deletions = 0;

    diffStat
      .split("\n")
      .filter(Boolean)
      .forEach((line) => {
        const parts = line.split("\t");
        if (parts.length >= 2) {
          filesChanged++;
          const added = parseInt(parts[0]!, 10) || 0;
          const deleted = parseInt(parts[1]!, 10) || 0;
          additions += added;
          deletions += deleted;
        }
      });

    // コミットメッセージを作成
    const fullMessage = `${message}\n\nCo-Authored-By: Claude Code <noreply@anthropic.com>`;

    // コミット
    await execAsync(`git commit -m "${fullMessage.replace(/"/g, '\\"')}"`, {
      cwd: workingDirectory,
      encoding: "utf8",
    });

    // コミットハッシュを取得
    const { stdout: hash } = await execAsync("git rev-parse HEAD", {
      cwd: workingDirectory,
      encoding: "utf8",
    });

    // 最新のブランチ名を取得
    const { stdout: finalBranch } = await execAsync(
      "git branch --show-current",
      {
        cwd: workingDirectory,
        encoding: "utf8",
      },
    );

    return {
      hash: hash.trim(),
      branch: finalBranch.trim(),
      filesChanged,
      additions,
      deletions,
    };
  }

  /**
   * 差分を構造化された形式で取得
   */
  async getDiff(workingDirectory: string): Promise<
    Array<{
      filename: string;
      status: string;
      additions: number;
      deletions: number;
      patch?: string;
    }>
  > {
    const files: Array<{
      filename: string;
      status: string;
      additions: number;
      deletions: number;
      patch?: string;
    }> = [];

    try {
      // ステージされた変更
      const { stdout: stagedNumstat } = await execAsync(
        "git diff --cached --numstat",
        {
          cwd: workingDirectory,
          encoding: "utf8",
        },
      );

      // ステージされていない変更
      const { stdout: unstagedNumstat } = await execAsync(
        "git diff --numstat",
        {
          cwd: workingDirectory,
          encoding: "utf8",
        },
      );

      // 新規ファイル
      const { stdout: untracked } = await execAsync(
        "git ls-files --others --exclude-standard",
        {
          cwd: workingDirectory,
          encoding: "utf8",
        },
      );

      // ステータスを取得
      const { stdout: status } = await execAsync("git status --porcelain", {
        cwd: workingDirectory,
        encoding: "utf8",
      });

      // ファイル情報をマップに格納
      const fileMap = new Map<
        string,
        {
          additions: number;
          deletions: number;
          status: string;
        }
      >();

      // numstatを解析
      const parseNumstat = (numstat: string) => {
        numstat
          .split("\n")
          .filter(Boolean)
          .forEach((line) => {
            const parts = line.split("\t");
            if (parts.length >= 3) {
              const additions = parseInt(parts[0]!, 10) || 0;
              const deletions = parseInt(parts[1]!, 10) || 0;
              const filename = parts[2]!;
              const existing = fileMap.get(filename);
              fileMap.set(filename, {
                additions: (existing?.additions || 0) + additions,
                deletions: (existing?.deletions || 0) + deletions,
                status: existing?.status || "modified",
              });
            }
          });
      };

      parseNumstat(stagedNumstat);
      parseNumstat(unstagedNumstat);

      // 新規ファイルを追加
      untracked
        .split("\n")
        .filter(Boolean)
        .forEach((filename) => {
          if (!fileMap.has(filename)) {
            fileMap.set(filename, {
              additions: 0,
              deletions: 0,
              status: "added",
            });
          }
        });

      // ステータスからファイル状態を更新
      status
        .split("\n")
        .filter(Boolean)
        .forEach((line) => {
          const statusCode = line.substring(0, 2);
          const filename = line.substring(3);
          const existing = fileMap.get(filename);
          let fileStatus = "modified";

          if (statusCode.includes("A") || statusCode.includes("?")) {
            fileStatus = "added";
          } else if (statusCode.includes("D")) {
            fileStatus = "deleted";
          } else if (statusCode.includes("R")) {
            fileStatus = "renamed";
          }

          if (existing) {
            existing.status = fileStatus;
          } else {
            fileMap.set(filename, {
              additions: 0,
              deletions: 0,
              status: fileStatus,
            });
          }
        });

      // 各ファイルのパッチを取得
      for (const [filename, info] of fileMap) {
        let patch = "";
        try {
          if (info.status !== "added") {
            const { stdout: filePatch } = await execAsync(
              `git diff HEAD -- "${filename}"`,
              {
                cwd: workingDirectory,
                encoding: "utf8",
                maxBuffer: 5 * 1024 * 1024,
              },
            );
            patch = filePatch;
          }
        } catch {
          // パッチ取得に失敗した場合は空
        }

        files.push({
          filename,
          status: info.status,
          additions: info.additions,
          deletions: info.deletions,
          patch: patch || undefined,
        });
      }

      return files;
    } catch (error) {
      logger.error({ err: error }, "Failed to get diff");
      return [];
    }
  }
}
