/**
 * Whisper Worker (Node.js subprocess)
 *
 * Runs Whisper transcription via @xenova/transformers in a separate Node.js
 * process. Required because Bun has compatibility issues with ONNX runtime.
 * Same pattern as embedding-worker.cjs.
 *
 * Input (stdin): JSON { audioPath: string, language?: string }
 * Output (stdout): JSON { text: string }
 */

const { pipeline } = require("@xenova/transformers");
const fs = require("fs");

let transcriber = null;
const MODEL = "Xenova/whisper-tiny";

async function main() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  const { audioPath, language } = JSON.parse(input);

  if (!transcriber) {
    transcriber = await pipeline("automatic-speech-recognition", MODEL, {
      quantized: true,
    });
  }

  const audioBuffer = fs.readFileSync(audioPath);

  const result = await transcriber(audioBuffer, {
    language: language || "ja",
    task: "transcribe",
    chunk_length_s: 30,
    stride_length_s: 5,
  });

  const text = typeof result === "string" ? result : result.text || "";

  process.stdout.write(JSON.stringify({ text }));
}

main().catch((err) => {
  process.stderr.write(JSON.stringify({ error: err.message }));
  process.exit(1);
});
