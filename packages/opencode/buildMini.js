#!/usr/bin/env bun
import { Script } from "@opencode-ai/script"

await Bun.$`mkdir -p dist/node`
await Bun.write(
  "dist/node/mini.js",
  (await Bun.file("src/mini.js").text()).replaceAll("__OPENCODE_VERSION__", Script.version),
)
