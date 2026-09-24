# Changelog

[README](../README.md) › [Documentation](../README.md#documentation) › Project › Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The external link check retries with backoff, reports the underlying network error, and
  treats "no response" from known flaky hosts (currently `www.gnu.org`, which intermittently
  refuses GitHub's runners) as a warning. HTTP error statuses still fail.

## [3.2.1] - 2026-09-24

### Changed

- **Documentation reorganized.** `README.md` is now a short entry point. Everything else lives
  in `docs/` under uppercase names, grouped as Get started (QUICKSTART, INSTALLATION), Guides
  (GENERATE, AUDIT, ROTATE, STORE, REVOKE, AGENT-SKILLS), Reference (COMPATIBILITY,
  SECURITY-MODEL, TROUBLESHOOTING, EVIDENCE) and Project (DEVELOPMENT, PROJECT-STRUCTURE,
  CHANGELOG). `PROJECT_STRUCTURE.md` became `docs/PROJECT-STRUCTURE.md`.
- `tests/docs.test.mjs` fails the build if any Markdown link, anchor or footnote breaks, or if
  a document breaks the naming convention.
- `npm run check:links` (and the weekly `links.yml` workflow) checks every external URL and
  `#fragment` in the docs, skill sources and code comments.

### Fixed

- `package.json` homepage used `#readme`, an anchor GitHub no longer renders.
- The CHANGELOG linked to a `v3.0.0` release that was never tagged; it now links to the
  commit that shipped it.

## [3.2.0] - 2026-09-24

### Added

- **`revoke-gh-token`** (`revoke.mjs`) permanently revokes a token and removes local copies.
  - **Token sources:** `--from <name>` (a `.ght` file), `--stored` (the token your shell
    secrets file exports), `--previous` (the token `store-gh-token` replaced, from the
    `.bak` file), or `--token-stdin`.
  - **Before revoking:** it shows the account, type, scopes and expiry, with the token
    masked. It asks you to type the account name to confirm (`--yes` skips this), refuses
    `gh`'s own login token without `--force`, and warns if your shell exports the token.
  - **Revoking:** it uses GitHub's unauthenticated `POST /credentials/revoke`, then polls
    until GitHub rejects the token.
  - **Cleanup:** it deletes the `.ght` file, only the secrets-file variables holding that
    token (and references to them), or the `.bak` file. `--keep-files` keeps them.
  - **`--web`** opens GitHub's token settings page instead of calling the API.
- `store-gh-token --revoke-previous` revokes the replaced token right after storing the new
  one, and deletes the backup that held it.
- Setup installs `revoke.mjs` and a `revoke-gh-token` alias for every supported shell.

> [!CAUTION]
> Revocation is irreversible and GitHub emails the token's owner. GitHub documents the
> endpoint for credentials the caller does *not* own. Using it on your own token works, but
> `--web` is the conservative alternative.

## [3.1.0] - 2026-09-24

### Added

- `store-gh-token --generate` creates and stores a token in one command. It:
  - opens GitHub's new-token page for the account `gh` is signed in as, with scopes
    prefilled (all 48 by default, or `--scopes`) and a dated note (`--name`), recommending a
    7-day expiration (`--expiration`);
  - reads the copied token from the clipboard, then clears it (macOS, Windows, Wayland, X11);
    falls back to a hidden prompt, or use `--no-clipboard`;
  - refuses a token that belongs to a different account than `gh`;
  - adds or replaces `GITHUB_TOKEN` and the `GITHUB_PERSONAL_ACCESS_TOKEN` reference.
- The current `gh` account is detected from the stored `gh` login first, so an expired
  `GITHUB_TOKEN` in the environment doesn't get in the way.
- **GitHub Releases**, published automatically when a `v*` tag is pushed:
  - the release runs the full CI matrix first;
  - it attaches an npm tarball (`npm install -g <url>`), a zip, one skill zip per agent host,
    and `SHA256SUMS`;
  - it adds signed build provenance and uses this CHANGELOG section as release notes.

  `npm run package` builds the same assets locally.

### Fixed

- Documentation said the classic `default` scope set had 51 scopes; it has 48. The generator
  now computes the number.

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
- CI on Ubuntu, macOS and Windows with Node 22 and 24, plus skill validation. Actions are
  pinned to commit SHAs, and Dependabot checks GitHub Actions and npm weekly.
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

[Unreleased]: https://github.com/agentic-incubator/github-token-utilities/compare/v3.2.1...HEAD
[3.2.1]: https://github.com/agentic-incubator/github-token-utilities/compare/v3.2.0...v3.2.1
[3.2.0]: https://github.com/agentic-incubator/github-token-utilities/releases/tag/v3.2.0
[3.1.0]: https://github.com/agentic-incubator/github-token-utilities/releases/tag/v3.1.0
[3.0.0]: https://github.com/agentic-incubator/github-token-utilities/tree/febb16c
