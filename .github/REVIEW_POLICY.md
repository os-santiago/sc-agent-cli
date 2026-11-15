# Main-branch review policy

The repository requires pull requests, resolved review conversations, no pending
change-requesting review, and successful required quality/security checks. It
does not require a separate approving identity or approval of the latest push.
A new commit does not automatically dismiss a request for changes.

`main-ruleset.json` is the desired configuration of repository ruleset
`18226792`. It preserves the existing linear-history, deletion, force-push and
bypass settings. Twenty named checks are bound to their GitHub integration IDs.
GitHub treats successful, neutral or skipped required checks as satisfying a
status requirement; a failing, pending or missing required check blocks merge.
The title workflow also runs on `synchronize`, so each new head receives its
required title result without needing a title edit.
Review conversations must be resolved after verifying the correction; an outdated
thread is not automatically resolved. General PR discussion comments have no
resolvable state in GitHub.

An authorized repository administrator can reapply this configuration with:

```bash
gh api --method PUT repos/os-santiago/sc-agent-cli/rulesets/18226792 \
  --input .github/main-ruleset.json
gh api repos/os-santiago/sc-agent-cli/rulesets/18226792
```

Check names must be updated here when workflows rename jobs. This file does not
change repository settings merely by being merged; the API command applies the
reviewed desired state. Do not use administrator bypass to substitute for passing
checks or resolving a requested change.

GitHub documents [rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
and [change-requesting reviews](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/reviewing-proposed-changes-in-a-pull-request).
