# opencode headless

A head-less deployment of [opencode](https://github.com/anomalyco/opencode) (our fork) that can
run AI prompts from anywhere: Docker Compose for building, docker images and a portable tarball
for running, and a release script that tracks the latest opencode version.

The repo lives at the top level (branch `node-release`, based on upstream release tags). Everything lives here, including this document (NODE-RELEASE.md).
All work is on that branch; the clone is mounted into the build containers as `/app/src`.

## Plan and objectives

1. Build a head-less Opencode setup via Docker Compose: compile the minimal client (`mini.js`),
   build the server bundle, start a server, send a prompt, shut down.
2. Drop the HTTP server: run the prompt in-process (no port, no TCP), like `opencode run` does.
3. Make the runtime accept the same flags as the default CLI (`--model`, `--continue`, files, etc.).
4. Package the result so any containerized project can use it: a docker image, and a portable
   gzipped tarball that a container downloads, extracts, and executes with plain node (no bun).
5. A repeatable script (`release.sh`) that builds the latest opencode version and deploys it to
   the `base3` server, runnable every time a new version is released.

## Layout

| Path | What it is |
|------|------------|
| `opencode` | Wrapper script; resolves `mini.js` relative to its own location |
| `compose.yml` | `builder`, `runtime`, `headless` (image build) services |
| `Dockerfile.mini` | node:lts-slim image carrying the node-based runtime (works on any x86-64) |
| `release.sh` | One-command release: detect version → build → ship to base3 → tarball |
| `releases/opencode-node-linux-x64.tar.gz` | Portable node-based tarball (~7 MB) |
| `.docker-context` | Staging dir for the headless image build (generated) |

## Key changes (branch `node-release`)

```
2aff354 feat(opencode): add release script with portable node tarball
9c6efb3 feat(opencode): add release-style single binary build with version override
b8f4b2c feat(opencode): add file, command, thinking, format and pure flags to mini
ff89224 chore: add headless docker image build
aaa8361 chore: use node:lts-slim in compose
1d90fde feat(opencode): add cli flags to mini runner
10360bc chore: run runtime via opencode wrapper script
cb476ef chore: add opencode wrapper script
b03c202 chore: add docker compose for headless build and runtime
dd9145b chore(opencode): allow OPENCODE_VERSION override in node build
bbf9147 chore(sdk): point exports at compiled dist
d559a2b fix(opencode): use node:url in run footer for node target
cdda46d feat(opencode): add headless mini prompt runner
```

11 files changed, 323 insertions, 11 deletions. Highlights:

- **`mini.js`** (new): headless one-shot runner. Uses the SDK v2 against the server app
  in-process — SDK requests are routed directly into the bundled server's HTTP handler
  (`Server.Default().app.fetch`), the same pattern `opencode run` uses. No server process,
  port, or TCP connection. Flags: `-c/--continue`, `-s/--session`, `-m/--model`,
  `--agent`, `--variant`, `--title`, `-f/--file` (repeatable), `--command`,
  `--thinking`, `--format json`, `--pure`, `-h/--help`.
- **`compose.yml`**: builder chain (SDK `tsc` first — the SDK exports point at `dist/`,
  so the server bundle must be built after it — then server bundle, mini copy, runtime
  externals from bun's store, image staging).
- **`packages/sdk/js/package.json`**: exports point at compiled `dist/` (needed so plain
  node can resolve `@opencode-ai/sdk/v2`; bun resolves TS source, node can't).
- **`build-node.ts` / `build.ts`**: `OPENCODE_VERSION` env override — the opencode free
  tier requires the client to report >= 1.18.0; dev builds report `0.0.0-dev`.

## Key findings

- **base3's CPU (Pentium E2160, 2008, x86-64-v1) cannot run ANY bun-compiled binary** —
  even `--target bun-linux-x64-baseline` (verified with a hello-world: SIGILL). It lacks
  more than AVX2 (SSE4/POPCNT generation). The node-based runtime works fine there, since
  node interprets the JS bundle with no bun codegen. That's why the base3 deploy is the
  `opencode-headless` image / node tarball, not the bun binary.
- **npm cannot install into a tree with bun `catalog:` versions** (EUNSUPPORTEDPROTOCOL) —
  runtime externals (`jsonc-parser`, `@lydell/node-pty` + its real platform binary, which
  is a symlink in bun's store) are copied from `node_modules/.bun/` instead.
- **`node.js` is a library module, not a CLI** — `serve`/`run` both exit silently. The
  server starts via `Server.listen()` or the in-process fetch loopback.
- **bun build order matters**: the SDK `dist` must exist before the server bundle is built,
  because `@opencode-ai/sdk`'s exports resolve into it.
- The release build's `rm -rf dist` wipes `dist/node`; `release.sh` preserves and restores
  it so the headless image keeps working.

## Progress

**Working and verified:**
- `mini.js` runner with full flag set (tested: `--help`, `--thinking`, `--format json`,
  `--file`, `--command`, `--pure`, `-c` session continuation)
- `opencode-headless:latest` built and deployed on base3 (v1.18.34, smoke-tested with a
  live prompt)
- Portable node tarball verified in a bare container (download → extract → run)
- `release.sh` end-to-end

**Pending / next:**
- Publish the tarball as a GitHub release (needs `gh` installed, or manual web upload) and
  reference it from consumer Dockerfiles instead of copying
- `--auto` flag (permission handling: auto-approve instead of the default hang — currently
  any prompt that triggers a permission request hangs mini, which has no event listener)
- `cli-main.ts` is broken (grabs `Session.Service` from the default runtime); untracked —
  fix or delete
- Stray untracked files: `packages/sdk/js/openapi.json`, `script/build-mini.ts` (safe to delete)

## Fork and keeping things updated

Remotes: `origin` = the original repo (`anomalyco/opencode`), `fork` = `aleguacaran/opencode`.

`node-release` is the fork's **default branch** and the only branch the automation needs.
It is structured as an **upstream release tag plus our patch series** (one commit with
the mini pipeline, release workflow and tooling). Whenever a new npm version appears,
the release workflow rebases that series onto the matching upstream tag (`v<version>`)
and force-pushes — upstream cuts each release tag as a separate lineage, so a rebase is
the only conflict-free sync — and then builds. The code always matches the version stamp,
and there is no drift from following the nightly `dev`. The fork's `dev` branch is
irrelevant to the automation; update it manually only if you want a live mirror:

```sh
git fetch origin dev && git push fork origin/dev:dev
```

Upstream lines, for reference: npm `opencode-ai@latest` is the 1.x stable line (what the
workflow builds). OpenCode 2 is published as a separate npm package, `@opencode-ai/cli`
(currently `0.0.0-beta-*`, beta channel), with its own `v2.0.x` GitHub tags. The v2 line
carries the restructured monorepo (`packages/core`/`cli`/`client`), so building it needs a
one-time port of the mini pipeline; dispatching the workflow with a v2 version today fails
at the tag merge (loudly, by design). Port when v2 approaches npm-stable — either when
`opencode-ai@latest` moves to 2.x or when `@opencode-ai/cli` becomes the primary package
(the detection line then changes to that package).

`.github/workflows/release-node.yml` runs every other day (06:00 UTC, odd days of the
month) and on demand:
detect the latest npm version → merge upstream tag `v<version>` into `node-release` →
build the node tarball → publish it as `node-v<version>` on the fork, skipping versions
already released. Tag merges that conflict fail the run loudly for manual resolution
(resolve locally with `git fetch origin tag v<version> && git merge v<version>`).

The repo needs Settings → Actions → Workflow permissions → "Read and write" so the
workflow can push the merge and create releases.

For PRs to the original, cut a clean branch from `origin/dev` with just the upstreamable
commits — the docker/release machinery stays out of PRs.

## Usage

Build everything and run a prompt locally:

```sh
cd ~/Proyectos/ai/opencode-src
docker compose run --rm builder   # SDK + server bundle + mini + staging
docker compose run --rm runtime   # ./opencode "write a short poem about the sun"
```

Deploy the latest version to base3 (build + ship + smoke test + tarball):

```sh
cd ~/Proyectos/ai/opencode-src
./release.sh              # or: ./release.sh 1.19.0
```

Run inside any containerized project (needs node >= 22 in the image):

```dockerfile
ADD opencode-node-linux-x64.tar.gz /opt/
RUN tar -xzf /opt/opencode-node-linux-x64.tar.gz -C /opt
CMD ["/opt/opencode", "your prompt"]
```

Always install the **latest** released version — `install-opencode.sh` resolves the newest
`node-v<version>` release from GitHub, verifies it against the sha256 digest reported by
the API, and extracts the launcher plus its `packages/` tree:

```sh
./install-opencode.sh              # installs to /opt/opencode
./install-opencode.sh /usr/local   # custom destination
```

In a Dockerfile (the launcher is self-relative and symlink-aware, so either put the
install directory on PATH or symlink the launcher into a bin dir; symlink support
ships with releases built after the fix — the `node-v1.19.0` tarball predates it,
so use `ENV PATH` with that one):

```dockerfile
FROM node:lts-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY install-opencode.sh /tmp/
RUN bash /tmp/install-opencode.sh /opt/opencode && rm /tmp/install-opencode.sh
ENV PATH="/opt/opencode:$PATH"
CMD ["opencode", "your prompt"]
```

Or pipe it straight from the fork (requires curl in the image):

```dockerfile
RUN curl -fsSL https://raw.githubusercontent.com/aleguacaran/opencode/node-release/install-opencode.sh | bash
```

On Debian, install the release's `.deb` instead (tree at `/opt/opencode`, launcher at
`/usr/bin/opencode`; the filename is constant so the stable latest-download URL works —
dpkg reads the version from the package metadata):

```sh
curl -fLO https://github.com/aleguacaran/opencode/releases/latest/download/opencode-node-linux-x64.deb
sudo dpkg -i opencode-node-linux-x64.deb
opencode --version
```

Runtime needs node >= 22 in PATH (not declared as a package dependency, since node is
often installed outside apt).

Or with docker directly:

```sh
docker run --rm opencode-headless:latest "your prompt"
```
