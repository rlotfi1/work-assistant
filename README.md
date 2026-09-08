# Work Assistant

A personal, local-first app to capture your work so nothing gets lost — tasks,
email follow-ups, and action items assigned to you during meetings. Tracks **who
requested** each task, due dates, and priority.

![Work Assistant — the Today view](docs/today.png)

Built with a plain Node/Express + vanilla-JS stack (no build step), and dressed in
a warm-dark "flight deck" theme.

## Run it

```bash
cd Assistant
npm install      # first time only
npm start        # http://localhost:3020
```

`npm run dev` runs it with nodemon (auto-reload).

## Where your data lives

One JSON file, `data/assistant.json` (override with the `ASSISTANT_DATA_DIR`
environment variable). No account, no cloud — it stays on your machine until you
choose to deploy it.

## How to use it

### Quick capture (the point)
The bar at the top adds a task in one line. Type naturally and use tokens:

| Token | Means | Example |
|-------|-------|---------|
| `@name` | Requested by | `@Alex` or `@[Alex Rivera]` |
| `#tag` | Project / tag | `#Reporting` |
| `!level` | Priority | `!urgent` `!high` `!low` |
| `^when` | Due date | `^today` `^fri` `^+3d` `^2026-09-30` |

Example: `Prepare Q3 review deck @Alex #Reporting !high ^fri`
Press **Enter**. (Press **/** anywhere to jump to the capture bar.)

Switch the toggle to **Follow-up** to log an email that needs a reply — paste the
message link so you can jump back to it.

### Views
- **Today** — overdue, due today, in-progress, and an inbox of undated captures.
- **My day** — a timeline of what you did each day: free-form activity notes (with
  optional durations like `(45m)`) plus every task you completed, on one tape.
- **Board** — To do / Doing / Done, drag cards between columns.
- **All tasks** — full list with search and filters (status, priority, source,
  requestor, project).
- **Follow-ups** — just the email items awaiting action.
- **Meetings** — make a meeting before a call, then jot each assigned action item
  as it's handed to you; they flow straight into your tasks with the meeting and
  requestor attached.

![Work Assistant — the My day tracker](docs/my-day.png)

### Task activity log
Open any task (click it, or the ✎ pencil) to edit every field and keep a running
**activity log** — post comments as work progresses; status changes are recorded
automatically.

### Reminders
On the **Today** view, click *Enable reminders* to get a browser notification for
overdue / due-today tasks while the app is open in a tab.

## Roadmap (not built yet)
- Microsoft 365 sync (auto-pull flagged Outlook emails + calendar meetings via
  Microsoft Graph) — needs an Entra app registration.
- Deploy behind login.

## License

[MIT](LICENSE) © 2026 Reda Lotfi
