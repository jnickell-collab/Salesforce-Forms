# Execution Playbook

## Goal

Use this as a lightweight operating guide for multi-step tasks in this workspace.

## Task Flow

1. Identify the exact user goal.
2. Inspect the relevant files before editing.
3. Make the smallest change that solves the problem.
4. Validate the result.
5. Report what changed, what was checked, and any remaining risk.

## Editing Rules

- Do not modify unrelated files.
- Keep existing style and structure unless a change requires otherwise.
- Prefer shared theme or utility sources over duplicated logic when the project already has them.
- If a shared source exists, extend it carefully rather than replacing it wholesale.

## Validation Rules

- Run file-level checks after edits when available.
- Fix errors that are directly caused by the change.
- Do not keep iterating blindly if the third attempt still fails.

## Output Rules

- Be concise.
- Mention file paths only when they help the user act.
- Include next steps only if they are natural and useful.
- If the work cannot be completed, state the blocker plainly.

## Reuse Notes

- If a project already has a shared style source, use it as the source of truth.
- If the project uses per-component styles, keep the shared tokens consistent across components.
