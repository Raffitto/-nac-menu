/**
 * Jest worker for historical logbook replay parsing (CRA/babel).
 * Invoked by tmp-vault-verify/historical-logbook-recovery.mjs with RECOVERY_PARSE=1.
 */
import fs from "fs";
import path from "path";
import { parseVaultStructuredFile } from "./vaultIngestion";

const BATCH_INPUT = process.env.RECOVERY_BATCH_INPUT;
const BATCH_OUTPUT = process.env.RECOVERY_BATCH_OUTPUT;

function serializeParseResult(result) {
  return {
    ok: result.ok,
    publish: result.publish ?? result.confidenceMeta?.publish,
    error: result.error,
    confidence: result.confidence,
    confidenceMeta: result.confidenceMeta,
    periodStart: result.periodStart,
    periodEnd: result.periodEnd,
    publishedFacts: result.publishedFacts || [],
    stats: result.stats,
  };
}

describe("historical logbook recovery parse worker", () => {
  test("parse vault file for recovery", async () => {
    if (process.env.RECOVERY_PARSE !== "1") return;

    if (BATCH_INPUT && BATCH_OUTPUT) {
      const batch = JSON.parse(fs.readFileSync(BATCH_INPUT, "utf8"));
      const results = {};
      for (const item of batch.items || []) {
        try {
          const buffer = Buffer.from(item.bufferB64, "base64");
          const file = {
            name: item.context.originalFilename || "logbook",
            type: item.mimeType || "application/octet-stream",
            content: buffer,
            arrayBuffer: async () =>
              buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
          };
          const result = await parseVaultStructuredFile(file, item.context);
          results[item.fileId] = serializeParseResult(result);
        } catch (err) {
          results[item.fileId] = {
            ok: false,
            publish: false,
            error: err?.message || "Parse failed",
            publishedFacts: [],
          };
        }
      }
      fs.mkdirSync(path.dirname(BATCH_OUTPUT), { recursive: true });
      fs.writeFileSync(BATCH_OUTPUT, JSON.stringify({ results }));
      return;
    }

    const INPUT = process.env.RECOVERY_PARSE_INPUT;
    const OUTPUT = process.env.RECOVERY_PARSE_OUTPUT;
    if (!INPUT || !OUTPUT) return;

    const payload = JSON.parse(fs.readFileSync(INPUT, "utf8"));
    const buffer = Buffer.from(payload.bufferB64, "base64");
    const file = {
      name: payload.context.originalFilename || "logbook",
      type: payload.mimeType || "application/octet-stream",
      content: buffer,
      arrayBuffer: async () =>
        buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    };

    const result = await parseVaultStructuredFile(file, payload.context);
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, JSON.stringify(serializeParseResult(result)));
  });
});
