// Minimal Opencode CLI wrapper for head-less use
// --------------------------------------------
// Uses the Opencode SDK against the server app in-process: requests are routed
// directly into the bundled server's HTTP handler (same pattern as `opencode
// run`), so no server process, port, or TCP connection is needed.
// --------------------------------------------
import { Server } from "./node.js";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";

async function main() {
  const prompt = process.argv[2];
  if (!prompt) {
    console.error("Usage: node mini.js <prompt>");
    process.exit(1);
  }

  const client = createOpencodeClient({
    baseUrl: "http://opencode.internal",
    directory: process.cwd(),
    fetch: (request) => Server.Default().app.fetch(request),
  });

  try {
    const session = await client.session.create();
    if (session.error) {
      console.error("Error creating session:", session.error);
      process.exit(1);
    }
    const result = await client.session.prompt({
      sessionID: session.data.id,
      parts: [{ type: "text", text: prompt }],
    });
    if (result.data.info?.error) {
      console.error("Model error:", result.data.info.error.data?.message || result.data.info.error);
      process.exit(1);
    }
    const output = result.data.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n");
    console.log(output);
    process.exit(0);
  } catch (err) {
    console.error("Error calling Opencode:", err);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Unexpected error:", e);
  process.exit(1);
});
