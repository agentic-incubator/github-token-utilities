# Development

[README](../README.md) › [Documentation](../README.md#documentation) › Project › Development

Running the tests, building and validating the agent skills, and cutting a release.

```bash
npm test                # unit + end-to-end tests (a fake `gh` is used; nothing touches GitHub)
npm run build:skills    # render skills/core into skills/dist/<host>/
npm run check:skills    # validate every variant and fail if dist/ is out of date
```

```bash
npm run validate:skills # --check, then the spec's reference validator on every variant (needs uv)
```

Edit the skill only in `skills/core/` (`SKILL.md.tmpl`, `references/`) and in
`skills/hosts.json`. The files in `skills/dist/` are generated. The build validates each
variant against the Agent Skills rules[^agentskills-spec]:

- frontmatter uses only the spec's top-level keys (`name`, `description`, `license`,
  `compatibility`, `metadata`, `allowed-tools`) in YAML block style, which is what the
  reference validator (`skills-ref`) accepts;[^skills-ref]
- `name` is lowercase with single hyphens, at most 64 characters, and matches its folder;
- `description` is at most 1024 characters and `compatibility` at most 500;
- `SKILL.md` stays under 500 lines;
- every referenced file exists.

See [PROJECT_STRUCTURE.md](PROJECT-STRUCTURE.md) for a map of the repository.

## Releasing

1. Bump `version` in `package.json`, and add a matching `## [x.y.z]` section to
   `CHANGELOG.md`. Its text becomes the release notes.
2. `npm run build:skills && npm test`, then commit and push to `main`.
3. Tag and push:

   ```bash
   git tag v3.1.0 && git push origin v3.1.0
   ```

[`release.yml`](../.github/workflows/release.yml) then runs the full CI matrix. It fails if the
tag doesn't match `package.json` or the CHANGELOG has no matching section. Otherwise it
builds the assets with `npm run package`, signs build provenance,[^attest] and creates the
GitHub Release.[^gh-release] Tags with a hyphen (`v3.2.0-rc.1`) are marked as prereleases.
You can build the same assets locally with `npm run package`; they go in `release/`, which is
git-ignored.

[^skills-ref]: Agent Skills reference validator (`skills-ref`; on PyPI the command is `agentskills`): allowed keys, strictyaml parsing. <https://github.com/agentskills/agentskills/tree/main/skills-ref>
[^attest]: GitHub Docs, *Using artifact attestations to establish provenance for builds*; `actions/attest-build-provenance`. <https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds>
[^gh-release]: GitHub CLI manual, *gh release create* (`--verify-tag`, `--notes-file`, `--prerelease`). <https://cli.github.com/manual/gh_release_create>
