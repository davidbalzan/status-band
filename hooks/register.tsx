import type { Register, Timer } from 'claude-code'

import { busSegment, findJoin, parseJsonBlock, type Bus, type WhoamiView } from './bus'
import { cacheSegment, describeCheck, isTtl, judgeTtl, TTL_MS, type CacheState, type Ttl } from './cache'
import { layoutRows } from './pieces'
import { parsePrs, prSegment, type PrCount } from './prs'
import { backoff } from './schedule'
import { costDelta, localDay, usageSegment, type PlanLimit } from './usage'

const STORE_TTL_KEY = 'detected-ttl'
const STORE_COST_PREFIX = 'usage-cost:'
const COST_KEEP_DAYS = 14

// One display tick (while a countdown is on screen) and one slow poll; each source below keeps its own due time.
const POLL_MS = 15_000
const BUS_MS = 15_000
const BUS_IDLE_MS = 60_000
const USAGE_MS = 30_000
const OTHER_SESSIONS_MS = 120_000
const PR_REFRESH_MS = 5 * 60_000
const PR_SETTLE_MS = 10_000
const BACKOFF_MAX_MS = 10 * 60_000

export const register: Register = (on, options) => {
  const configured = isTtl(options.ttl) ? options.ttl : null
  const showBus = options.showBus !== false
  const showPrs = options.showPrs !== false
  const showUsage = options.showUsage !== false

  // Cache: every API response refreshes it, so the clock restarts at each one.
  let lastResponseAt: number | null = null
  let previousTokens = 0
  let gapBeforeTurn: number | null = null
  let detected: Ttl | null = null
  let isDetectedLoaded = false
  let lastCheck: string | null = null

  // Redraw: the 1s tick only draws while a countdown is showing; the poll draws only when a value changed.
  let tick: Timer | undefined
  let poll: Timer | undefined
  let isTicking = false
  let hasPolledOnce = false

  // Bus
  let bus: Bus | null = null
  let isBusChecked = false
  let hasWhoami: boolean | null = null
  let busDueAt = 0
  let busDelayMs = BUS_MS

  // Usage: today's cost is every session's spend since midnight, one store key per session so concurrent
  // sessions never overwrite each other. Spend before the mod loaded in a session is not counted.
  let todayUsd: number | null = null
  let limits: readonly PlanLimit[] = []
  let usageDueAt = 0
  let lastSessionUsd: number | null = null
  let ownDay = ''
  let ownUsd = 0
  let othersUsd = 0
  let othersDay = ''
  let othersDueAt = 0
  let isUsagePruned = false

  // Open PRs
  let prs: PrCount | null = null
  let prsDueAt = 0
  let prsDelayMs = PR_REFRESH_MS

  on('classic.SessionStart', async ($, e, next) => {
    if (e.seconds_since_last_response !== undefined) {
      lastResponseAt = (await $.clock.now()) - e.seconds_since_last_response * 1000
      previousTokens = e.context_tokens ?? 0
    }

    return next(e)
  })

  on('session.end', ($, e, next) => {
    tick?.cancel()
    tick = undefined
    poll?.cancel()
    poll = undefined
    bus = null

    return next(e)
  })

  on('classic.PostModelSwitch', async ($, e, next) => {
    detected = e.cache_ttl
    await $.store.set(STORE_TTL_KEY, detected)

    return next(e)
  })

  // `e.agentId` on a tool.call is the subagent loop's id, not the tool's own `agentId` argument, so the
  // identity is never read off the event: a join only says to look again, soon.
  on('tool.call', { tool: 'mcp__agent-coord__join' }, async ($, e, next) => {
    const ran = await next(e)

    if (ran.deny === undefined && ran.isError !== true) {
      bus = null
      isBusChecked = false
      busDueAt = 0
      busDelayMs = BUS_MS
    }

    return ran
  })

  on('tool.call', { tool: 'mcp__agent-coord__unregister' }, ($, e, next) => {
    bus = null

    return next(e)
  })

  // A PR changes when this agent pushes or runs gh, so that is when the count is worth refetching early.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (/\bgh\s+pr\b|\bgit\s+push\b/.test(e.command)) {
      prsDueAt = Math.min(prsDueAt, (await $.clock.now()) + PR_SETTLE_MS)
    }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    gapBeforeTurn = lastResponseAt === null ? null : (await $.clock.now()) - lastResponseAt

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    for await (const chunk of next(e)) {
      if (chunk.kind === 'stop' && chunk.usage) {
        const { usage } = chunk

        if (gapBeforeTurn !== null) {
          const verdict = judgeTtl(gapBeforeTurn, previousTokens, usage)
          lastCheck = describeCheck(gapBeforeTurn, previousTokens, usage)
          gapBeforeTurn = null

          if (verdict && verdict !== detected) {
            detected = verdict
            await $.store.set(STORE_TTL_KEY, verdict)
          }
        }

        previousTokens = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
        lastResponseAt = await $.clock.now()
        $.ui.invalidate('ui.render')
      }

      yield chunk
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    // Drawing must not depend on the timers, so a failure to start them is not a failure to draw.
    try {
      tick ??= $.clock.every(1000, () => {
        if (isTicking) {
          $.ui.invalidate('ui.render')
        }
      })

      const runPoll = async () => {
        const now = await $.clock.now()
        let isChanged = false

        if (showBus && now >= busDueAt) {
          const seen = JSON.stringify(bus)
          let outcome: 'ok' | 'none' | 'failed' = 'failed'

          // `whoami` answers in one read-only call; a server without it falls back to the id in this session's
          // own `join` call (read once from the transcript) plus `status` and `list_rooms`.
          if (hasWhoami !== false) {
            const call = await $.mcp.call('agent-coord', 'whoami').catch(() => null)
            const me = call && parseJsonBlock<WhoamiView>(call.content, call.isError)

            if (me) {
              hasWhoami = true
              bus = me.bound && me.agentId ? { agentId: me.agentId, rooms: me.rooms ?? [], unread: me.inboxUnread ?? null } : null
              outcome = bus ? 'ok' : 'none'
            } else if (call?.isError) {
              hasWhoami = false
            }
          }

          if (hasWhoami === false) {
            if (!bus && !isBusChecked) {
              isBusChecked = true
              const joined = findJoin(await $.session.messages({ as: 'api' }))
              bus = joined ? { agentId: joined.agentId, rooms: [], unread: null } : null
            }

            const seat = bus

            if (!seat) {
              outcome = 'none'
            } else {
              const [statusCall, roomsCall] = await Promise.all([
                $.mcp.call('agent-coord', 'status', { agentId: seat.agentId }).catch(() => null),
                $.mcp.call('agent-coord', 'list_rooms').catch(() => null),
              ])
              const status = statusCall && parseJsonBlock<{ registered?: boolean; inboxUnread?: number }>(statusCall.content, statusCall.isError)
              const listing = roomsCall && parseJsonBlock<{ rooms?: { room: string; members?: string[] }[] }>(roomsCall.content, roomsCall.isError)

              if (status?.registered === false) {
                bus = null
                outcome = 'none'
              } else if (status || listing) {
                bus = {
                  ...seat,
                  unread: status?.inboxUnread ?? seat.unread,
                  rooms: listing?.rooms?.filter(r => r.members?.includes(seat.agentId)).map(r => r.room) ?? seat.rooms,
                }
                outcome = 'ok'
              }
            }
          }

          // No bus on this machine backs off instead of asking every 15 seconds forever; a `join` resets it.
          busDelayMs = outcome === 'ok' ? BUS_MS : outcome === 'none' ? BUS_IDLE_MS : backoff(busDelayMs, BUS_IDLE_MS, BACKOFF_MAX_MS)
          busDueAt = now + busDelayMs
          isChanged ||= JSON.stringify(bus) !== seen
        }

        if (showUsage && now >= usageDueAt) {
          usageDueAt = now + USAGE_MS
          const usage = await $.session.usage().catch(() => null)

          if (usage) {
            const seen = JSON.stringify([todayUsd, limits])
            const day = localDay(now)
            const keyPrefix = `${STORE_COST_PREFIX}${day}:`
            const sessionUsd = usage.cost?.usd
            limits = usage.rateLimits

            if (sessionUsd === undefined) {
              todayUsd = null
            } else {
              const ownKey = `${keyPrefix}${await $.session.id()}`
              const delta = lastSessionUsd === null ? 0 : costDelta(lastSessionUsd, sessionUsd)
              lastSessionUsd = sessionUsd
              ownUsd = ownDay === day ? ownUsd + delta : delta
              ownDay = day

              if (delta > 0) {
                await $.store.set(ownKey, ownUsd)
              }

              // The other sessions' spend changes slowly, so it is re-read every couple of minutes, not every poll.
              if (othersDay !== day || now >= othersDueAt) {
                othersDay = day
                othersDueAt = now + OTHER_SESSIONS_MS
                const keys = await $.store.keys()

                if (!isUsagePruned) {
                  isUsagePruned = true
                  const cutoff = localDay(now - COST_KEEP_DAYS * 24 * 60 * 60_000)
                  const dateAt = STORE_COST_PREFIX.length

                  await Promise.all(
                    keys
                      .filter(key => key.startsWith(STORE_COST_PREFIX) && key.slice(dateAt, dateAt + 10) < cutoff)
                      .map(key => $.store.delete(key)),
                  )
                }

                const amounts = await Promise.all(
                  keys.filter(key => key.startsWith(keyPrefix) && key !== ownKey).map(key => $.store.get(key)),
                )
                othersUsd = amounts.reduce<number>((sum, value) => sum + (typeof value === 'number' ? value : 0), 0)
              }

              todayUsd = othersUsd + ownUsd
            }

            isChanged ||= seen !== JSON.stringify([todayUsd, limits])
          }
        }

        if (showPrs && now >= prsDueAt) {
          const repo = await $.session.repo()

          if (!repo?.remote) {
            isChanged ||= prs !== null
            prs = null
            prsDelayMs = PR_REFRESH_MS
          } else {
            const ran = await $.process
              .run(['gh', 'pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number,isDraft'], {
                cwd: repo.root,
                timeoutMs: 15_000,
              })
              .catch(() => null)
            const counted = ran?.exitCode === 0 ? parsePrs(ran.stdout) : null

            prsDelayMs = counted ? PR_REFRESH_MS : backoff(prsDelayMs, PR_REFRESH_MS, BACKOFF_MAX_MS)
            isChanged ||= counted !== null && (counted.open !== prs?.open || counted.drafts !== prs?.drafts)
            prs = counted ?? prs
          }

          prsDueAt = now + prsDelayMs
        }

        if (isChanged) {
          $.ui.invalidate('ui.render')
        }
      }

      poll ??= $.clock.every(POLL_MS, runPoll)

      if (!hasPolledOnce) {
        hasPolledOnce = true
        $.clock.after(500, runPoll)
      }
    } catch {
      // see above
    }

    if (!isDetectedLoaded) {
      isDetectedLoaded = true
      const stored = await $.store.get(STORE_TTL_KEY).catch(() => undefined)
      detected ??= isTtl(stored) ? stored : null
    }

    const { Box, Text } = $.ui.resolve(e)
    const ttl = configured ?? detected ?? '5m'
    const remainingMs = lastResponseAt === null ? 0 : TTL_MS[ttl] - ((await $.clock.now()) - lastResponseAt)
    const cacheState: CacheState =
      lastResponseAt === null
        ? { kind: 'waiting' }
        : e.props.isWorking
          ? { kind: 'working' }
          : remainingMs <= 0
            ? { kind: 'expired' }
            : { kind: 'ticking', remainingMs, ttl, source: configured ? 'set' : detected ? 'detected' : 'assumed', lastCheck }
    isTicking = cacheState.kind === 'ticking'

    const usage = showUsage ? usageSegment(todayUsd, limits) : null
    const width = Math.max(20, (e.props.bodyColumns || e.viewport?.columns || 100) - 2)
    const rows = layoutRows(width, [
      cacheSegment(cacheState),
      ...(usage ? [usage] : []),
      ...(showPrs && prs ? [prSegment(prs)] : []),
      ...(showBus && bus ? [busSegment(bus)] : []),
    ])

    return (
      <Box flexDirection="column">
        {rows.map(row => (
          <Box>
            {row.map(piece => (
              <Text color={piece.color} dimColor={piece.dim} bold={piece.bold}>
                {piece.text}
              </Text>
            ))}
          </Box>
        ))}
      </Box>
    )
  })
}
