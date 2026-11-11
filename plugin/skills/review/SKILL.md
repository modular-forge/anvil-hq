---
name: review
description: Audit the anvil data space for items whose status no longer matches reality, with the read-only anvil:auditor subagent. Reports each finding with its evidence and the command that would fix it; nothing changes until the user approves a fix.
argument-hint: "[project id | all]"
disable-model-invocation: true
context: fork
agent: anvil:auditor
background: false
allowed-tools: Bash(anvil briefing) Bash(anvil briefing *) Bash(anvil validate) Bash(anvil validate *) Bash(anvil audit) Bash(anvil audit *) Bash(anvil item list *) Bash(anvil item show *) Bash(anvil search *) Bash(anvil journal list *) Bash(git log *) Bash(git show *) Bash(git status) Bash(git status *) Bash(gh pr list *) Bash(gh pr view *) Bash(gh issue view *)
---

# anvil review

Audit anvil and report what has drifted. Answer in the language of the user's request.

**Scope:** `$ARGUMENTS`

- A project id: audit that project.
- `all`: audit the whole data space.
- Empty: audit the project of the current folder, the id on the first line of `anvil briefing`
  (`# anvil: <name> (project <id>, prefix <XX>), …`). If `anvil briefing` prints nothing, the folder
  is not a known project: audit the whole data space and say so.

Follow your instructions as the anvil auditor: read only, check each finding against the item,
give evidence, and end with the numbered fix commands and the question of which to apply.
