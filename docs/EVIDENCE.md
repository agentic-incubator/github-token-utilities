# Evidence

Every external behavior this toolkit depends on, where it is implemented, and the public
source that backs it. Verified on **2026-09-24**.

> [!NOTE]
> **Status** tells you how much to trust each row:
> - **Documented**: stated in official documentation or a changelog.
> - **Source**: confirmed by reading the host's or tool's source code (path given).
> - **Observed**: widely relied on or reproduced in testing, but not officially documented.
>   Code that depends on an *Observed* row degrades gracefully if the behavior changes.
> - **Tested here**: exercised by this repository's tests or by the host load tests below.

## GitHub

| # | Behavior relied on | Implemented in | Status | Evidence |
|---|---|---|---|---|
| G1 | There is no API to create a personal access token; tokens are created in the web UI | `generator.mjs` (browser + paste flow) | Documented | [Managing your personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens); the org PAT endpoints only list, approve and revoke: [REST: personal access tokens](https://docs.github.com/en/rest/orgs/personal-access-tokens) |
| G2 | Fine-grained template URL `/settings/personal-access-tokens/new` accepts `name` (≤ 40), `description` (≤ 1024), `target_name`, `expires_in` (1–366 or `none`) and `<permission>=read\|write\|admin` | `gh-token-lib.mjs` `buildFineGrainedUrl`, `validateTokenName`, `FINE_GRAINED_MAX_DAYS` | Documented | [Managing your personal access tokens → Pre-filling fine-grained personal access token details using URL parameters](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens); [Changelog 2025-08-26](https://github.blog/changelog/2025-08-26-template-urls-for-fine-grained-pats-and-updated-permissions-ui/) |
| G3 | The set of permission names accepted in the template URL | `gh-token-lib.mjs` `FINE_GRAINED_PERMISSIONS`, `parsePermissions` | Documented | Same page as G2 (account, repository and organization permission lists) |
| G4 | Classic prefill `/settings/tokens/new?scopes=…&description=…` | `gh-token-lib.mjs` `buildClassicUrl` | Observed | GitHub calls it "a hidden feature for PAT (Classic)" in the [2025-08-26 changelog](https://github.blog/changelog/2025-08-26-template-urls-for-fine-grained-pats-and-updated-permissions-ui/); third-party tools rely on it. If the parameters are ever ignored, the page opens empty and the user fills it in, and the rest of the flow is unaffected. |
| G5 | Classic expiration cannot be prefilled | `generator.mjs` (tells the user to set it) | Observed | No expiration parameter is documented for classic tokens (G4 sources) |
| G6 | `X-OAuth-Scopes` response header lists a classic token's scopes | `gh-token-lib.mjs` `verifyToken` | Documented | [Scopes for OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps) |
| G7 | `GitHub-Authentication-Token-Expiration` response header carries a PAT's expiry | `gh-token-lib.mjs` `verifyToken`, `parseExpirationHeader` | Documented | [Changelog 2021-07-26: Expiration options for personal access tokens](https://github.blog/changelog/2021-07-26-expiration-options-for-personal-access-tokens/) |
| G8 | Header format `YYYY-MM-DD HH:MM:SS UTC`, sometimes with a numeric offset (`-0700`) | `gh-token-lib.mjs` `parseExpirationHeader` | Source | [go-github `github.go`](https://github.com/google/go-github/blob/master/github/github.go) parses both layouts; unit-tested in `tests/lib.test.mjs` |
| G9 | For fine-grained tokens the expiration header may contain the current time instead of the expiry | `gh-token-lib.mjs` `expiryStatus` (reports `UNKNOWN`) | Observed | [google/go-github#3708](https://github.com/google/go-github/issues/3708) |
| G10 | Actions secret names: `[A-Za-z0-9_]`, no leading digit, no `GITHUB_` prefix, case-insensitive (stored uppercase); values can't be read back | `gh-token-lib.mjs` `validateSecretName`; `rotate.mjs` uppercases names | Documented | [Secrets reference](https://docs.github.com/en/actions/reference/security/secrets) |
| G11 | Listing and setting repository secrets needs admin access to the repo (classic scope `repo`) | `audit.mjs` (`noAccess` list), `rotate.mjs` error text | Documented | [REST: GitHub Actions secrets](https://docs.github.com/en/rest/actions/secrets) |
| G12 | Changing files under `.github/workflows/` needs the `workflow` scope | `skills/core/references/scopes.md` | Documented | [Scopes for OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps) |
| G13 | GitHub Packages authenticates only with classic tokens | `skills/core/references/scopes.md` | Documented | [About permissions for GitHub Packages](https://docs.github.com/en/packages/learn-github-packages/about-permissions-for-github-packages): "GitHub Packages only supports authentication using a personal access token (classic)." |
| G14 | GitHub recommends fine-grained over classic tokens | Generator interactive default; skill guidance | Documented | [Managing your personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) |
| G15 | Organizations can restrict token types and set maximum lifetimes; fine-grained tokens may need approval | Troubleshooting guidance | Documented | [Setting a PAT policy for your organization](https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization); [Changelog 2024-10-18](https://github.blog/changelog/2024-10-18-new-pat-rotation-policies-preview-and-optional-expiration-for-fine-grained-pats/) |
| G16 | You can't revoke your own PAT through the API. `POST /credentials/revoke` is unauthenticated and meant for credentials you don't own | `rotate.mjs` "revoke the old token" step | Documented | [REST: revocation](https://docs.github.com/en/rest/credentials/revoke) |

## GitHub CLI (`gh`)

| # | Behavior relied on | Implemented in | Status | Evidence |
|---|---|---|---|---|
| C1 | Token precedence: `GH_TOKEN`, then `GITHUB_TOKEN`, then stored credentials; an invalid env token is not skipped | `verifyToken` sets `GH_TOKEN` and removes `GITHUB_TOKEN`; skill pre-flight; `audit.mjs` auth hint | Documented, Source | [gh help environment](https://cli.github.com/manual/gh_help_environment); [go-gh `pkg/auth/auth.go`](https://github.com/cli/go-gh/blob/trunk/pkg/auth/auth.go) |
| C2 | `gh secret set NAME --repo O/R` reads the value from stdin when `--body` is omitted, trimming a trailing newline | `rotate.mjs` | Documented, Source, Tested here | [gh secret set](https://cli.github.com/manual/gh_secret_set); [`pkg/cmd/secret/set/set.go`](https://github.com/cli/cli/blob/trunk/pkg/cmd/secret/set/set.go); `tests/cli.test.mjs` asserts the token arrives on stdin and never in argv |
| C3 | `gh secret list --json name,updatedAt` | `audit.mjs`, `rotate.mjs` | Documented | [gh secret list](https://cli.github.com/manual/gh_secret_list) |
| C4 | `gh repo list [<owner>] --no-archived --limit N --json nameWithOwner` (there is no `--owner` flag) | `audit.mjs` | Documented | [gh repo list](https://cli.github.com/manual/gh_repo_list) |
| C5 | `gh api -i` prints response headers before the body | `verifyToken` | Documented | [gh api](https://cli.github.com/manual/gh_api) (`--include`) |
| C6 | `gh auth login` sets up the stored credentials | Requirements; skill pre-flight | Documented | [gh auth login](https://cli.github.com/manual/gh_auth_login) |

## Shells and operating systems

| # | Behavior relied on | Implemented in | Status | Evidence |
|---|---|---|---|---|
| O1 | `export NAME=value` sets an exported variable in bash, zsh, sh, ksh and dash; `. file` runs it in the current shell | `ENV_FORMATS.sh` | Documented, Tested here | [Bash: Bourne Shell Builtins](https://www.gnu.org/software/bash/manual/html_node/Bourne-Shell-Builtins.html); [POSIX: dot](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html#dot); `tests/shells.test.mjs` sources the file in bash, zsh, sh, dash and ksh |
| O2 | bash reads `~/.bash_profile` for login shells (macOS Terminal) and `~/.bashrc` for interactive non-login shells (typical Linux terminals) | `setup.mjs`, `store.mjs` startup-file choice | Documented | [Bash Startup Files](https://www.gnu.org/software/bash/manual/html_node/Bash-Startup-Files.html) |
| O3 | fish: `set -gx NAME value` exports a global; `~/.config/fish/conf.d/*.fish` runs at every startup | `ENV_FORMATS.fish`; fish alias file in `setup.mjs` | Documented | [fish: set](https://fishshell.com/docs/current/cmds/set.html); [fish: Configuration files](https://fishshell.com/docs/current/language.html#configuration-files) |
| O4 | csh/tcsh: `setenv NAME value`; `source file`; tcsh reads `~/.tcshrc`, else `~/.cshrc` | `ENV_FORMATS.csh`; `setup.mjs`, `store.mjs` | Documented, Tested here | [tcsh(1)](https://man.freebsd.org/cgi/man.cgi?query=tcsh); `tests/shells.test.mjs` (csh, tcsh) |
| O5 | PowerShell: `$env:NAME = 'value'` sets an environment variable; dot-sourcing a `.ps1` file runs it in the current scope; only `.ps1` files are scripts | `ENV_FORMATS.powershell`; `store.mjs` rejects non-`.ps1` files | Documented, Tested here | [about_Environment_Variables](https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_environment_variables); [about_Scripts](https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_scripts); `tests/shells.test.mjs` (pwsh) |
| O6 | Windows' default execution policy blocks scripts, including profiles | Troubleshooting | Documented | [about_Scripts](https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_scripts); [about_Execution_Policies](https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_execution_policies) |
| O7 | `$PROFILE.CurrentUserAllHosts` gives the profile path, which differs between PowerShell 7 and 5.1 and follows redirected Documents folders | `getPowerShellProfile` (setup and store) | Documented | [about_Profiles](https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_profiles) |
| O8 | `icacls FILE /inheritance:r /grant:r USER:F` leaves only the owner's access | `restrictToOwner` | Documented | [icacls](https://learn.microsoft.com/windows-server/administration/windows-commands/icacls) |
| O9 | Node.js 20 reached end-of-life on 2026-04-30; 22 is supported until 2027-04-30 and 24 until 2028-04-30 | `package.json` `engines`, CI matrix | Documented | [nodejs/Release schedule](https://github.com/nodejs/Release#release-schedule) |

## Agent Skills format and hosts

| # | Behavior relied on | Implemented in | Status | Evidence |
|---|---|---|---|---|
| S1 | `SKILL.md` frontmatter: `name` (lowercase and hyphens, ≤ 64, equal to its folder name), `description` (≤ 1024), optional `license`, `compatibility` (≤ 500), `metadata`, `allowed-tools`; optional `references/` and `scripts/` | `scripts/build-skills.mjs` `validateSkill` | Documented | [Agent Skills specification](https://agentskills.io/specification) |
| S2 | The reference validator allows only those six top-level keys and rejects YAML flow style (strictyaml) | `ALLOWED_TOP_LEVEL_KEYS`; block-style emitter | Source, Tested here | [`skills-ref`](https://github.com/agentskills/agentskills/tree/main/skills-ref) (`validator.py`, `parser.py`); `npm run validate:skills` passes for all six variants |
| S3 | Claude Code loads `~/.claude/skills/<name>/` and `.claude/skills/<name>/`; question tool `AskUserQuestion`; shell tool `Bash`; `!` output enters the conversation | `skills/hosts.json` → `claude` | Documented, Tested here | [Claude Code: Skills](https://code.claude.com/docs/en/skills); [Interactive mode → Shell mode](https://code.claude.com/docs/en/interactive-mode) |
| S4 | Codex loads `~/.agents/skills` and repo `.agents/skills`; `~/.codex/skills` is deprecated; relative paths in `SKILL.md` resolve against the skill folder; `request_user_input` is Plan-mode only by default; `!` commands get no stdin and their output goes to the model | `hosts.json` → `codex` | Documented, Source, Tested here | [Codex: Build skills](https://developers.openai.com/codex/skills); [`codex-rs/ext/skills/src/host_roots.rs`, `catalog_prompt.rs`](https://github.com/openai/codex); [openai/codex#11536](https://github.com/openai/codex/issues/11536); `codex-rs/core/src/spawn.rs` |
| S5 | OpenCode loads `.opencode/skills`, `~/.config/opencode/skills`, and `.claude`/`.agents` folders; the `skill` tool gives the agent the base directory and allows reads inside it; question tool `question`, shell tool `bash` | `hosts.json` → `opencode` | Documented, Source, Tested here | [OpenCode: Skills](https://opencode.ai/docs/skills/); [OpenCode: Tools](https://opencode.ai/docs/tools/); `packages/opencode/src/tool/skill.ts` in [sst/opencode](https://github.com/sst/opencode); `opencode debug skill` found the project install |
| S6 | Gemini CLI loads `~/.gemini/skills` and `.gemini/skills`; `activate_skill` adds the skill folder to the workspace so `references/` can be read; project skills need a trusted folder; `ask_user` and `run_shell_command`; `!` mode is interactive (PTY) by default | `hosts.json` → `gemini`; installer notice | Documented, Source, Tested here | [Gemini CLI: Skills](https://geminicli.com/docs/cli/skills/); [Trusted Folders](https://geminicli.com/docs/cli/trusted-folders/); [ask_user](https://geminicli.com/docs/tools/ask-user/); [Shell](https://geminicli.com/docs/tools/shell/); `packages/core/src/tools/activate-skill.ts` in [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli); `gemini skills list` found the user-level install |
| S7 | Hermes loads `~/.hermes/skills` (flat or by category) and `.hermes/skills`/`.agents/skills`; a missing top-level `version` is a lint warning only; the index truncates descriptions at about 57 characters; `clarify` and `terminal` tools; `skill_view` exposes `references/*.md` | `hosts.json` → `hermes`; description wording | Documented, Source | [Hermes: Skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills); [Creating skills](https://hermes-agent.nousresearch.com/docs/developer-guide/creating-skills); [Tools](https://hermes-agent.nousresearch.com/docs/user-guide/features/tools); `agent/skill_utils.py`, `tools/skill_linter.py`, `tools/skills_tool.py` in [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) |
| S8 | Grok Build loads `~/.grok/skills`, `.grok/skills`, `.agents/skills` and `.claude/skills`; ignores unknown frontmatter keys; rewrites markdown links to bundled files but not bare paths; `ask_user_question` and `bash` tools | `hosts.json` → `grok`; reference links in `SKILL.md` | Documented, Source | [xAI: Skills, plugins and marketplaces](https://docs.x.ai/build/features/skills-plugins-marketplaces); [Configuration guide](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/05-configuration.md); `xai-grok-tools/src/implementations/skills/discovery.rs` and `skill.rs` in [xai-org/grok-build](https://github.com/xai-org/grok-build) |

## Host load tests (2026-09-24)

Each variant was installed into a throwaway project, and the host was asked, without
running any command, which question tool it would use, which dry-run command it would run,
and which permissions the scopes reference recommends.

| Host (version) | Discovered the skill | Answered from the skill |
|---|---|---|
| Claude Code 2.1.281 | ✅ | ✅ `AskUserQuestion`; `node ~/rotate.mjs acme/api GH_TOKEN --dry-run`; `contents=write` |
| Codex CLI 0.156.1 | ✅ | ✅ plain-text questions (`request_user_input` is Plan-mode only); same command; `contents=write` |
| OpenCode 1.18.32 | ✅ via `opencode debug skill` | Not run: no reachable model provider in the test environment |
| Gemini CLI 0.60.0 | ✅ via `gemini skills list` (user level) | Not run: interactive sign-in required |
| Hermes Agent | Not installed | Spec-validated and checked against its source (S7) |
| Grok Build | Not installed | Spec-validated and checked against its source (S8) |
