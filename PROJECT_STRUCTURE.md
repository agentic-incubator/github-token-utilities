# Project Structure

```
github-token-utilities/
├── generator.mjs            # gen-gh-token: create, verify and save a PAT
├── audit.mjs                # audit-gh-tokens: token-like repo secrets + local token health
├── rotate.mjs               # rotate-gh-token: replace a repo Actions secret
├── store.mjs                # store-gh-token: write a token into the shell secrets file
├── gh-token-lib.mjs         # shared helpers used by all the commands
├── setup.mjs                # copies the scripts to ~ and adds shell aliases
├── skills/
│   ├── hosts.json           # skill metadata + per-host differences (paths, tool names)
│   ├── core/                # the single source of the skill, edit here
│   │   ├── SKILL.md.tmpl
│   │   └── references/      # setup, audit, rotate, generate, terminal, scopes, troubleshooting
│   └── dist/<host>/github-token-utilities/   # generated variants, do not edit
├── scripts/
│   ├── build-skills.mjs     # render core → dist and validate against the spec
│   └── install-skills.mjs   # copy a variant into a host's skills folder
├── tests/
│   ├── lib.test.mjs         # unit tests for gh-token-lib.mjs
│   ├── cli.test.mjs         # end-to-end tests against a fake gh
│   ├── skills.test.mjs      # skill rendering and portability tests
│   └── shells.test.mjs      # generated files loaded in real bash/zsh/sh/dash/ksh/fish/csh/tcsh/pwsh
├── docs/
│   └── EVIDENCE.md          # every external behavior relied on, with sources
├── .github/workflows/ci.yml # tests on Ubuntu/macOS/Windows × Node 22/24; skill validation
├── README.md
├── QUICKSTART.md
├── CHANGELOG.md
├── LICENSE
└── package.json
```

## Runtime files

| File | Role | Notes |
|---|---|---|
| `generator.mjs` | Builds the prefilled GitHub URL (fine-grained or classic), takes the pasted token through hidden input or `--token-stdin`, verifies it, and writes `~/<name>.ght` with mode `600` | Interactive by default; every prompt has a flag, so agents can hand users one complete command |
| `audit.mjs` | Scans repositories with `gh repo list` and `gh secret list`; checks each `~/*.ght` against `GET /user` | `--json` output is what the agent skill reads |
| `rotate.mjs` | Validates input, previews with `--dry-run`, generates a token (or uses `--existing`), then pipes it to `gh secret set` on stdin | Never places the token on a command line |
| `store.mjs` | Adds or replaces `GITHUB_TOKEN` and a `GITHUB_PERSONAL_ACCESS_TOKEN` reference in the shell secrets file (sh, fish, csh, or PowerShell syntax), refuses long-lived tokens, backs up, and restricts to the owner | `--dry-run` previews; `--ensure-loaded` wires the file into your shell startup |
| `gh-token-lib.mjs` | Validation, URL builders, header parsing, `verifyToken`, secrets-file editing, platform helpers, and the `gh()` call wrapper | Pure functions are unit-tested; `setup.mjs` copies it next to the scripts |
| `setup.mjs` | Copies the five runtime files to `~` and adds aliases in the syntax and startup file of your shell | `--dry-run` previews; safe to re-run |

> [!NOTE]
> After `setup.mjs`, the scripts live in your home directory (`~/generator.mjs` and so on).
> Agent skills call them by path (`node ~/audit.mjs`) because the shells agents use
> usually don't load your aliases.

## Skill build pipeline

```
skills/core/SKILL.md.tmpl ─┐
skills/core/references/*   ├─► scripts/build-skills.mjs ─► skills/dist/<host>/github-token-utilities/
skills/hosts.json ─────────┘          │
                                      └─► validates each variant (spec limits, allowed keys,
                                          block-style YAML, links to references)
```

> [!IMPORTANT]
> Don't edit `skills/dist/` by hand. `npm run check:skills` (and the test suite) fails when
> `dist/` doesn't match what `core/` would produce.

## Testing hook

> [!NOTE]
> `GTU_GH_SHIM` (a path to a Node script) replaces the real `gh` for every call. It exists so
> the test suite can use one fake `gh` on every OS; don't set it in normal use.

## Local state that is never committed

`.gitignore` excludes token files (`*.ght`), environment files, and local agent-orchestration
state (`.swarm/`, `.claude-flow/`, `*.db` and similar), which can contain session memory.
