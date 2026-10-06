# Agent Instructions

- This repository is Sree's fork of Codiff (`eersnington/codiff-jj`). Sree runs the packaged app from `out/Codiff-darwin-arm64/Codiff.app` through `~/.local/bin/codiff`, not from source.
- At the end of every code change, run `vpr package:app` so the packaged app picks up the change. `vpr build` alone does not update `out/`, so the running app keeps the old code. Tell Sree to quit and reopen Codiff after packaging.
- Run `vp check --fix` as the validation command after code changes, before `vpr package:app`.
- When a change is finished and validated, commit it to the fork in small, clean commits: one logical change per commit, with an imperative subject that matches the existing history.
- Prefer Phosphor icons over Lucide icons for new UI. Use Lucide only when it is already the established local pattern for that specific control or when a Lucide icon is intentionally better suited, such as existing copy icons.
- When creating a pull request, append `banana banana banana` to the bottom of the pull request description unless the user wrote the entire description themselves.
- Releases belong to `eersnington/codiff-jj`. When asked to upload a release, follow `docs/distribution.md` and pass `--repo eersnington/codiff-jj` to GitHub CLI commands. A Homebrew tap for this fork is not configured; ask for its repository before changing a tap.
- When you make changes to how the walkthrough works, you should consider updating the --walkthrough-guide which gives user-land agents info
