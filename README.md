# status-band
A status band above the Claude Code prompt, drawn as one row when it fits and stacked when it does not:

```
████████████░░░░░░░░ 52:10 until prompt cache expires (1h detected) │ $4.12 today · 5h 63% 7d 21% │ ⎇ 2 open PRs │ ● worker-2 · #groundwork · 3 unread
```

| Segment | Shows |
| --- | --- |
| Cache countdown | Time left before the prompt cache expires (when the next prompt costs more). Green, yellow, then red as it drains; a red "Cache expired" line afterwards. The TTL (5m or 1h) is detected from the cache's behaviour and labelled `assumed`, `detected` or `set`. |
| Cost and limits | Today's cost across all your sessions, and your plan-limit windows (`5h`, `7d`) as percentages, coloured by how full they are. |
| Open PRs | Open PRs in the current repo (`gh pr list`), with drafts counted. |
| Coord bus | This session's seat on an [agent-coord](https://www.npmjs.com/package/agent-coord-mcp) bus: id, rooms, unread count. Hidden when there is no bus. |

When the terminal is narrow the segments shorten (`$4.12 · 7d 22%`, `⎇ 2 PRs`), then stack.

### Install

```
/plugin marketplace add davidbalzan/status-band
/plugin install status-band@status-band
```

From a local clone, use its path instead of `davidbalzan/status-band`.

### Options

Set under `/plugin configure status-band@status-band`.

| Option | Default | |
| --- | --- | --- |
| `ttl` | `auto` | `auto` detects the cache lifetime; `5m` or `1h` forces it. |
| `showUsage` | on | Cost and plan limits. |
| `showPrs` | on | Open PRs. Needs the `gh` CLI, signed in. |
| `showBus` | on | Coord-bus row. |

### How it works, and what it costs

- A one-second redraw runs only while the countdown is on screen. One 15-second poll serves the other segments, each on its own schedule, and redraws only when a value changed.
- The bus row asks the bus server's read-only `whoami` tool (agent-coord-mcp 0.26.46 and later; older servers fall back to `status` and `list_rooms`). With no bus on the machine it backs off to every 10 minutes.
- Open PRs: one `gh pr list` call every 5 minutes, sooner after this session runs `gh pr` or `git push`. A failing call backs off.
- Today's cost: each session adds what it spent to its own store key and the total sums today's keys, so concurrent sessions never overwrite each other. Spend from before the mod loaded in a session is not counted, and sessions without the mod are not counted.
- None of it goes through the model.

### Limits

- Terminal and desktop surfaces only (the band is not drawn on others).
- Plan-limit windows appear only when the API reports them (subscription accounts).
- TTL detection needs one prompt sent after more than five and a half minutes idle; until then the label says `assumed`.

## Development

```
claude plugin validate .
claude plugin test .
```

Logic lives in small modules under `hooks/` (`cache`, `usage`, `prs`, `bus`, `pieces` for layout, `schedule`), with `register.tsx` wiring them to the engine. Tests are beside them.
