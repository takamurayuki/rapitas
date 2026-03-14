/**
 * Node.jsサブプロセスでembeddingを生成するワーカー
 * Bunとの互換性問題がある場合のフォールバック
 *
 * 使い方: echo '{"text":"hello","model":"Xenova/all-MiniLM-L6-v2"}' | node embedding-worker.cjs
 */
const { pipeline } = require("@xenova/transformers");

let extractor = null;

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString("utf-8"));

  const { text, model } = input;

  if (!extractor) {
    extractor = await pipeline("feature-extraction", model || "Xenova/all-MiniLM-L6-v2");
  }

  const output = await extractor(text, { pooling: "mean", normalize: true });
  const embedding = Array.from(output.data);

  process.stdout.write(JSON.stringify({ embedding, dimension: embedding.length }));
}

main().catch((err) => {
  process.stderr.write(err.message || String(err));
  process.exit(1);
});
