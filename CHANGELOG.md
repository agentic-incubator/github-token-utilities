# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2026-09-24

> [!IMPORTANT]
> Breaking: Node.js 22 or later is now required, token generation now goes through the
> browser instead of a (nonexistent) API, and `setup.mjs` installs more files. Re-run
> `node setup.mjs` after updating.

### Added

- **`store-gh-token`** (`store.mjs`): writes a token into the shell secrets file your shell
  loads at startup, as `GITHUB_TOKEN` plus a `GITHUB_PERSONAL_ACCESS_TOKEN` reference.
  - Supports bash/zsh/sh/ksh/dash, fish, csh/tcsh and PowerShell, detected from the OS and
    `$SHELL`.
  - Adds or replaces entries in place and fixes the reference order.
  - Refuses long-lived tokens (`--max-days`), keeps a backup, and restricts the file to its
    owner (mode 600 on macOS/Linux, `icacls` on Windows).
  - Reports whether the replaced token is still active.
- **Fine-grained tokens** in `gen-gh-token`: `--type fine-grained`, `--permissions`
  (checked against GitHub's documented list) and `--owner`, using GitHub's documented template
  URL. Expiration is prefilled.
- **Non-interactive flags** for every prompt (`--name`, `--scopes`, `--expiration`, `--yes`,
  `--print-url`, `--token-stdin`, `--no-open`, `--force`), so an agent can prepare one complete
  command.
- `rotate-gh-token`:
  - `--existing <name>` reuses a saved token;
  - `--dry-run` previews;
  - `--type`, `--permissions`, `--owner` and `--scopes` are passed through to the generator.
- `audit-gh-tokens`:
  - `--json`, `--owner` argument, `--stale-days`, `--match`, `--no-local`, `--no-remote`;
  - checks local `~/*.ght` tokens and the shell secrets file (`--secrets-file`, `--format`)
    for validity, expiry and loose permissions.
- `setup.mjs --dry-run`.
- **Agent Skills** for Claude Code, OpenAI Codex CLI, OpenCode, Gemini CLI, Hermes Agent and
  Grok Build, generated from one source (`skills/core`). They come with a build/validation
  script and an installer (`npm run build:skills`, `check:skills`, `validate:skills`,
  `install:skills`).
- Test suite (`npm test`):
  - unit tests;
  - end-to-end tests against a fake `gh`;
  - skill portability tests;
  - tests that load generated files in real shells.
- CI on Ubuntu, macOS and Windows with Node 22 and 24, plus skill validation.
- `docs/EVIDENCE.md` traces every external behavior to a public source. Also added
  `CHANGELOG.md` and `LICENSE`.

### Changed

- **Generation now opens GitHub's prefilled "new token" page** and takes the token through a
  hidden paste. It verifies the token with `GET /user` and saves it with mode 600. The previous
  version called an API that doesn't exist, so generation always failed.
- `setup.mjs`:
  - copies from its own directory instead of the current directory;
  - chooses the startup file and alias syntax from `$SHELL` (zsh, bash, ksh, sh, fish,
    csh/tcsh);
  - on Windows, asks PowerShell for the real profile path, which also covers OneDrive-redirected
    Documents folders.
- The audit reports when each token-like secret was **last set** instead of an expiry that
  can't be known. It also checks secrets in parallel and lists repositories it couldn't read.
- Secret names are validated against GitHub's rules (no `GITHUB_` prefix) and matched
  case-insensitively.
- `.gitignore` also excludes credentials and local agent/orchestration state.
- Minimum Node.js version raised from 14 to **22**, because Node 20 reached end-of-life on
  2026-04-30.

### Fixed

- `audit-gh-tokens` failed immediately: `gh repo list` has no `--owner` flag.
- `rotate-gh-token` could not find the token it had just generated, because the file name
  never matched.
- `rotate-gh-token` passed the token on the command line (`gh secret set --body`), which
  exposed it in the process list; it now uses stdin.
- Repository and secret names were interpolated into shell commands; `gh` is now called with
  argument arrays.
- A stale `GITHUB_TOKEN` in the environment could override the token being verified.

### Removed

- The generator's call to the nonexistent `POST user/personal-access-tokens` endpoint.

## [2.0.0]

Initial release of `gen-gh-token`, `audit-gh-tokens`, `rotate-gh-token` and `setup.mjs`.

[3.0.0]: https://github.com/agentic-incubator/github-token-utilities/releases/tag/v3.0.0
