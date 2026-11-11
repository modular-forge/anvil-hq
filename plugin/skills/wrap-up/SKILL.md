---
name: wrap-up
description: Close a work session. Bring the project's anvil items up to date with what was done (steps, statuses with evidence, new follow-ups, a journal note) after the user approves the list, and remind them to push.
argument-hint: "[project id]"
disable-model-invocation: true
allowed-tools: Bash(anvil briefing) Bash(anvil briefing *) Bash(anvil item list *) Bash(anvil item show *) Bash(anvil audit) Bash(anvil audit *) Bash(git status) Bash(git status *) Bash(git log *)
---

# anvil wrap-up

Close the session: make the project's items in anvil say what is true now. You propose every
change, the user approves it, and then you apply it with the anvil CLI. Answer in the language
the user writes in.

Call the CLI exactly as `anvil …`, the command on the PATH, even inside the anvil-hq repository:
the commands this skill may run without asking are written that way, and other forms (such as
`node bin/anvil.ts`) wait for the user's approval.

## Rules

- **Nothing is written before the user says yes** to the list of changes, even when tools run
  without asking for permission. The user may drop or edit entries; apply only what they approved.
- **Only the anvil CLI changes items.** Never edit the files in the data space by hand: the CLI
  validates each change and commits only what it touched.
- **Read again before proposing.** What you saw earlier in the session, the starting briefing
  included, may be out of date: the user may have moved items on the board meanwhile.
- **Evidence must be real:** a commit hash, a pull request or a test run from this session. Never
  invent it. If there is none, ask, or leave the item in its status.
- **Never push**, not the data space and not the project. Remind the user instead.
- If the CLI refuses a change, show its message and do not work around it (for example by
  skipping steps or closing tasks the user did not approve).

## Steps

1. **Find the project.** Use `$ARGUMENTS` if given; otherwise the id on the first line of
   `anvil briefing` (`# anvil: <name> (project <id>, prefix <XX>), …`). If there is none, say this
   folder is not a project anvil knows and stop.
2. **Read the current state:** `anvil item list --project <id>`, then `anvil item show <id>` for
   the items in doing and blocked and for any item this session worked on.
3. **Gather what this session did:** the conversation, plus `git status` and
   `git log --oneline -20` in the project's repository.
4. **Propose the changes** as a numbered list of exact commands, each with a short reason:
   - steps done: `anvil step check <id> <n>`; steps no longer needed:
     `anvil step skip <id> <n> --reason "…"` (only if the user agrees they are not needed);
   - statuses: `anvil item status <id> doing`, `… blocked --reason "…"`,
     `… done --evidence "<commit or PR>"`;
   - follow-ups found during the session: `anvil item create <project> --kind task|bug --title "…"`;
   - one journal note for the session: `anvil journal add <project> "…"` (what was done, what is
     next, open questions; a few lines).

   Then ask: "Apply these changes?" and wait.
5. **Apply** the approved commands one at a time, in order. Stop at the first refusal and show it.
6. **Close:** run `anvil briefing` again and say what changed. If it reports unpushed commits in the
   data space, or `git status -sb` shows the project's branch ahead of its remote, remind the user
   to push.
