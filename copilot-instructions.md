# Workspace Assistant Instructions

This file makes the project's assistant guidance discoverable to tools and agents.

Follow these rules when working in this workspace:

- Read and follow the guidance in `assistant-principles.md` and `execution-playbook.md` before making edits.
- Prefer shared sources and tokens (for example `c/cssLibrary`) when modifying styles.
- Keep changes minimal and clearly documented in commit messages and PR descriptions.

- CSS Rule: Always reference the shared theme tokens in `c/cssLibrary` (force-app/main/default/lwc/cssLibrary/cssLibrary.css) when making CSS changes; do NOT modify that file in PRs — coordinate and obtain explicit approval before changing it.

Files to consult (source of truth):

- `assistant-principles.md`
- `execution-playbook.md`

If you need a stricter agent format, copy the content of the two files into this file or into `.instructions.md`.
