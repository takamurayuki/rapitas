/**
 * briefing-speech-command
 *
 * Chooses the OS speech-synthesis command. The script text is NEVER placed in
 * argv — only file paths — so quoting bugs and shell injection cannot occur
 * regardless of what task titles contain.
 */

/** Executable and argv for one synthesis run. */
export interface SpeechCommand {
  command: string;
  args: string[];
}

// Reads UTF-8 text from $i and writes a WAV to $o via System.Speech (SAPI).
const WIN_SCRIPT =
  '& { param($i,$o) Add-Type -AssemblyName System.Speech; ' +
  '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ' +
  '$s.SetOutputToWaveFile($o); ' +
  '$s.Speak([System.IO.File]::ReadAllText($i, [System.Text.Encoding]::UTF8)); ' +
  '$s.Dispose() }';

/**
 * Resolve the synthesis command for a platform.
 *
 * @param platform - process.platform value / プラットフォーム
 * @param inputPath - UTF-8 text file / 台本ファイル
 * @param outputPath - WAV output path / 出力 WAV
 * @returns Command and args / コマンドと引数
 */
export function resolveSpeechCommand(
  platform: NodeJS.Platform,
  inputPath: string,
  outputPath: string,
): SpeechCommand {
  if (platform === 'win32') {
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', WIN_SCRIPT, inputPath, outputPath],
    };
  }
  if (platform === 'darwin') {
    return {
      command: 'say',
      args: ['-f', inputPath, '-o', outputPath, '--file-format=WAVE', '--data-format=LEI16@22050'],
    };
  }
  return { command: 'espeak-ng', args: ['-v', 'ja', '-f', inputPath, '-w', outputPath] };
}
