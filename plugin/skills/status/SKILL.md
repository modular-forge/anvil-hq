---
name: status
description: Where this project stands in anvil, the user's project manager. What is in progress, blocked and next, and what has probably fallen behind. Use when the user asks for the status, the open tasks or what to do next in a repository that anvil tracks.
argument-hint: "[project id]"
allowed-tools: Bash(anvil briefing) Bash(anvil briefing *) Bash(anvil item list *) Bash(anvil item show *) Bash(anvil audit) Bash(anvil audit *)
---

# anvil status

Report where the project stands. This command only reads: it never changes an item, never
commits and never pushes. Answer in the language the user writes in.

Call the CLI exactly as `anvil …`, the command on the PATH, even inside the anvil-hq repository:
the commands this skill may run without asking are written that way, and other forms (such as
`node bin/anvil.ts`) wait for the user's approval.

## Steps

1. **Find the project.** If the user gave a project id (`$ARGUMENTS`), use it. Otherwise run
   `anvil briefing` in the repository: its first line reads
   `# anvil: <name> (project <id>, prefix <XX>), <state>`. If it prints nothing, this folder
   is not a project anvil knows. Say so and suggest `anvil project link` (run it yourself only
   if the user asks), then stop.
2. **Read the current state.** Always read it now, even if the session started with a briefing:
   the user may have changed items on the board since then.
   - `anvil item list --project <id>`
   - `anvil audit --project <id>`
   - `anvil item show <id>` for each item in doing or blocked, to see its steps and reason.
3. **Report**, briefly:
   - **Doing:** each item with its step progress and the next unchecked step.
   - **Blocked:** each item with its reason.
   - **Next:** the todo items, highest priority first.
   - **Worth a look:** each audit finding with the command it suggests.
   - **Backup:** if the briefing says there are unpushed commits, remind the user to push the
     data space.

Do not make up progress, dates or evidence. If an item's state seems wrong, say why you think
so and point to `/anvil:wrap-up` or `/anvil:review` to fix it.
