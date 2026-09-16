# Agent Instructions

- At the end of every code change, run `vpr build` so the built files are refreshed for local testing.
- Run `vp check --fix` as the validation command after code changes, before `vpr build`.
- Prefer Phosphor icons over Lucide icons for new UI. Use Lucide only when it is already the established local pattern for that specific control or when a Lucide icon is intentionally better suited, such as existing copy icons.
- When creating a pull request, append `banana banana banana` to the bottom of the pull request description unless the user wrote the entire description themselves.
- Releases belong to `eersnington/codiff-jj`. When asked to upload a release, follow `docs/distribution.md` and pass `--repo eersnington/codiff-jj` to GitHub CLI commands. A Homebrew tap for this fork is not configured; ask for its repository before changing a tap.
- When you make changes to how the walkthrough works, you should consider updating the --walkthrough-guide which gives user-land agents info
