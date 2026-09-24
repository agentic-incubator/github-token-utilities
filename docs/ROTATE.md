# Rotate a repository secret

[README](../README.md) › [Documentation](../README.md#documentation) › Guides › Rotate

`rotate-gh-token` replaces the token stored in a repository Actions secret.

```bash
rotate-gh-token acme/api GH_TOKEN --dry-run                   # preview; changes nothing
rotate-gh-token acme/api GH_TOKEN --existing acme-api-deploy  # use a token you already generated
rotate-gh-token acme/api GH_TOKEN --type fine-grained --permissions contents=write --expiration 30
```

`rotate-gh-token` checks your access to the repository and shows whether the secret exists
and when it was last set. After you confirm, it either runs the generator or uses the token
in `~/<name>.ght` (`--existing`). It then writes the token to the secret with
`gh secret set`, passing the value on **standard input**.[^gh-secret-set]

> [!IMPORTANT]
> Rotation does **not** revoke the old token. It stays valid until you revoke it. GitHub never
> reveals a secret's value, so the tool can't find the old token for you. If you still have
> it locally, use [`revoke-gh-token --from <name>`](REVOKE.md); otherwise delete it at
> <https://github.com/settings/tokens>.

> [!NOTE]
> Actions secret names can contain only letters, numbers and underscores. They can't start
> with a number or with `GITHUB_`, and they're case-insensitive.[^secrets] The tool checks
> names before calling GitHub, so use `GH_TOKEN` rather than `GITHUB_TOKEN`.

[^gh-secret-set]: GitHub CLI manual, *gh secret set*: `--body` "reads from standard input if not specified". <https://cli.github.com/manual/gh_secret_set>
[^secrets]: GitHub Docs, *Secrets reference*: naming rules (letters, numbers, underscores; no leading digit; no `GITHUB_` prefix; case-insensitive) and that values are not readable. <https://docs.github.com/en/actions/reference/security/secrets>
