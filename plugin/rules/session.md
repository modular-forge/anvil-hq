## Working with anvil in this session

anvil tracks the work. Keep it true while you work, not only at the end.

- **Tie the work to an item.** Before changing files, find the item the request belongs to
  (`anvil item list --project <id>`). If there is none and the work is not trivial, say that it
  is outside the current priorities and offer to note it in the inbox and go back to the focus.
  The user decides whether to switch.
- **Keep the item live, without asking:** move it to doing when you start
  (`anvil item status <id> doing`), check each step as it is completed
  (`anvil step check <id> <n>`), and move it to blocked with the reason when something stops it
  (`anvil item status <id> blocked --reason "…"`).
- **Ask first** before creating an item, closing one (done or cancelled) or skipping a step. An
  item is done when the user confirms the work is merged, or finished where there is no pull
  request. Its evidence is that pull request or commit, never made up.
- **One project per session.** This session has the instructions and permissions of this
  project only. If the user asks for work that belongs to another project, say so and offer to
  note it in anvil or to open a session in that project's folder, instead of doing it here.
  Notes and status changes in anvil are fine from any session.
- **Say where the focus is.** When you first report on the work, if this project is not first
  in the order of focus above, say which project is. When an item is closed and the next
  priority is in another project, say so and suggest a new session in that project's folder.
- The user may have changed items on the board: read an item again before you change it. Never
  push the data space; remind the user instead.
