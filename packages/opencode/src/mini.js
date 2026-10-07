// Minimal Opencode CLI wrapper for head-less use
// --------------------------------------------
// Uses the Opencode SDK against the server app in-process: requests are routed
// directly into the bundled server's HTTP handler (same pattern as `opencode
// run`), so no server process, port, or TCP connection is needed.
// Flags mirror the default `opencode run` command.
// --------------------------------------------
import { parseArgs } from "node:util";
import { Server } from "./node.js";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import { basename, resolve } from "node:path";
import { statSync } from "node:fs";
import { pathToFileURL } from "node:url";

const usage = `Usage: opencode [flags] <message>

Flags:
  -c, --continue                continue the last session
  -s, --session <id>            session id to continue
  -m, --model <provider/model>  model to use
      --agent <name>            agent to use
      --variant <variant>       model variant (reasoning effort)
      --title <title>           title for a new session
  -f, --file <path>             attach file(s) to the message (repeatable)
      --command <command>       run a slash-command instead of a prompt
      --thinking                include reasoning blocks in the output
      --format <format>         output format: default (text) or json (raw result)
      --pure                    run without user plugins
  -h, --help                    show this help`;

function filePart(filePath) {
  const resolvedPath = resolve(filePath);
  let stat;
  try {
    stat = statSync(resolvedPath);
  } catch {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }
  if (!stat.isFile() && !stat.isDirectory()) {
    console.error(`Cannot attach special file: ${filePath}`);
    process.exit(1);
  }
  return {
    type: "file",
    url: pathToFileURL(resolvedPath).href,
    filename: basename(resolvedPath),
    mime: stat.isDirectory() ? "application/x-directory" : "text/plain",
  };
}

async function main() {
  const { values: flags, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    strict: false,
    options: {
      continue: { type: "boolean", short: "c" },
      session: { type: "string", short: "s" },
      model: { type: "string", short: "m" },
      agent: { type: "string" },
      variant: { type: "string" },
      title: { type: "string" },
      file: { type: "string", short: "f", multiple: true },
      command: { type: "string" },
      thinking: { type: "boolean" },
      format: { type: "string" },
      pure: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const message = positionals.join(" ");
  if (flags.help) {
    console.log(usage);
    process.exit(0);
  }
  if (!message && !flags.command) {
    console.error(usage);
    process.exit(1);
  }
  if (flags.pure) process.env.OPENCODE_PURE = "true";

  const [providerID, ...modelRest] = (flags.model ?? "").split("/");
  const model = providerID ? { providerID, modelID: modelRest.join("/") } : undefined;
  const files = (flags.file ?? []).map(filePart);
  const client = createOpencodeClient({
    baseUrl: "http://opencode.internal",
    directory: process.cwd(),
    fetch: (request) => Server.Default().app.fetch(request),
  });

  try {
    let sessionID;
    if (flags.session) {
      sessionID = flags.session;
    } else if (flags.continue) {
      const list = await client.session.list();
      const latest = list.data?.[0];
      if (!latest) {
        console.error("No sessions to continue");
        process.exit(1);
      }
      sessionID = latest.id;
    } else {
      const session = await client.session.create({
        title: flags.title,
        agent: flags.agent,
        model: model ? { id: model.modelID, providerID: model.providerID, variant: flags.variant } : undefined,
      });
      if (session.error) {
        console.error("Error creating session:", session.error);
        process.exit(1);
      }
      sessionID = session.data.id;
    }

    const result = flags.command
      ? await client.session.command({
          sessionID,
          agent: flags.agent,
          model: flags.model,
          arguments: message,
          command: flags.command,
          variant: flags.variant,
          parts: files.length ? files : undefined,
        })
      : await client.session.prompt({
          sessionID,
          parts: [...files, { type: "text", text: message }],
          agent: flags.agent,
          variant: flags.variant,
          model: model ? { providerID: model.providerID, modelID: model.modelID } : undefined,
        });
    if (result.data.info?.error) {
      console.error("Model error:", result.data.info.error.data?.message || result.data.info.error);
      process.exit(1);
    }
    if (flags.format === "json") {
      console.log(JSON.stringify(result.data));
      process.exit(0);
    }
    const output = result.data.parts
      .filter((p) => p.type === "text" || (flags.thinking && p.type === "reasoning" && p.time?.end))
      .map((p) => p.text)
      .join("\n");
    console.log(output);
    process.exit(0);
  } catch (err) {
    console.error("Error calling Opencode:", err);
    process.exit(1);
  }
}

main();
