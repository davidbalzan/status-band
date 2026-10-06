import { expect, test } from 'claude-code/testing'

import { busLine, busSegment, findJoin } from './bus'
import { barColor, cacheSegment, describeCheck, formatRemaining, judgeTtl } from './cache'
import { layoutRows, widthOf } from './pieces'
import { parsePrs, prLine, prSegment } from './prs'
import { backoff } from './schedule'
import { costDelta, formatUsd, limitColor, limitLabel, localDay, usageSegment } from './usage'

const MIN = 60_000
const usage = (read: number, creation: number) => ({
  input_tokens: 10,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: creation,
})

test('formats the remaining time as m:ss', () => {
  expect(formatRemaining(299_001)).toBe('5:00')
  expect(formatRemaining(61_000)).toBe('1:01')
  expect(formatRemaining(-5)).toBe('0:00')
})

test('colours the bar by how much of the TTL is left', () => {
  expect(barColor(0.9)).toBe('success')
  expect(barColor(0.4)).toBe('warning')
  expect(barColor(0.1)).toBe('error')
})

test('a context still cached after 10 minutes means a 1h TTL', () => {
  expect(judgeTtl(10 * MIN, 100_000, usage(95_000, 2_000))).toBe('1h')
})

test('a context rebuilt after 10 minutes means a 5m TTL', () => {
  expect(judgeTtl(10 * MIN, 100_000, usage(3_000, 97_000))).toBe('5m')
})

test('a context rebuilt next to a still-cached shared prefix means a 5m TTL', () => {
  expect(judgeTtl(10 * MIN, 100_000, usage(30_000, 70_000))).toBe('5m')
})

test('says nothing when the gap is short, past an hour, or there is no baseline', () => {
  expect(judgeTtl(2 * MIN, 100_000, usage(0, 100_000))).toBeNull()
  expect(judgeTtl(90 * MIN, 100_000, usage(0, 100_000))).toBeNull()
  expect(judgeTtl(10 * MIN, 0, usage(0, 100_000))).toBeNull()
  expect(judgeTtl(10 * MIN, 100_000, usage(50_000, 5_000))).toBeNull()
})

test('summarises the bus seat on one line', () => {
  expect(busLine({ agentId: 'kit-david-worker', rooms: ['kit', 'general'], unread: 3 })).toBe(
    'kit-david-worker · #kit #general · 3 unread',
  )
  expect(busLine({ agentId: 'a', rooms: [], unread: 0 })).toBe('a · no room · inbox clear')
  expect(busLine({ agentId: 'a', rooms: ['kit'], unread: null })).toBe('a · #kit')
})

test('counts open and draft PRs from gh output', () => {
  expect(parsePrs('[{"number":1,"isDraft":false},{"number":2,"isDraft":true}]')).toEqual({ open: 2, drafts: 1 })
  expect(parsePrs('[]')).toEqual({ open: 0, drafts: 0 })
  expect(parsePrs('not json')).toBeNull()
  expect(parsePrs('{"message":"error"}')).toBeNull()
})

test('words the PR count', () => {
  expect(prLine({ open: 1, drafts: 0 })).toBe('1 open PR')
  expect(prLine({ open: 3, drafts: 1 })).toBe('3 open PRs (1 draft)')
})

const call = (name: string, input: Record<string, unknown>) => ({
  role: 'assistant',
  content: [{ type: 'tool_use', name, input }],
})

test('finds the seat a transcript joined the bus as', () => {
  expect(findJoin([call('Bash', { command: 'ls' }), { content: 'hi' }])).toBeNull()
  expect(findJoin([call('mcp__agent-coord__join', { agentId: 'kit-worker', role: 'worker' })])).toEqual({
    agentId: 'kit-worker',
    role: 'worker',
  })
  expect(
    findJoin([
      call('mcp__agent-coord__join', { agentId: 'a' }),
      call('mcp__agent-coord__join', { agentId: 'b', role: { displayName: 'QA' } }),
    ]),
  ).toEqual({ agentId: 'b', role: 'QA' })
  expect(
    findJoin([call('mcp__agent-coord__join', { agentId: 'a' }), call('mcp__agent-coord__unregister', { agentId: 'a' })]),
  ).toBeNull()
})

const text = (row: readonly { text: string }[]) => row.map(piece => piece.text).join('')
const ticking = cacheSegment({ kind: 'ticking', remainingMs: 4 * MIN, ttl: '5m', source: 'detected', lastCheck: null })
const prs = prSegment({ open: 2, drafts: 0 })
const bus = busSegment({ agentId: 'kit-worker', rooms: ['kit'], unread: 3 })

test('one wide row when everything fits', () => {
  const rows = layoutRows(160, [ticking, prs, bus])

  expect(rows).toHaveLength(1)
  expect(text(rows[0] ?? [])).toContain('until prompt cache expires')
  expect(text(rows[0] ?? [])).toContain('bus: kit-worker')
})

test('shortens the extras, then everything, before it adds rows', () => {
  const medium = layoutRows(105, [ticking, prs, bus])

  expect(medium).toHaveLength(1)
  expect(text(medium[0] ?? [])).toContain('until prompt cache expires')
  expect(text(medium[0] ?? [])).toContain('2 PRs')

  const narrow = layoutRows(60, [ticking, prs, bus])

  expect(narrow).toHaveLength(1)
  expect(text(narrow[0] ?? [])).toContain('cache')
  expect(text(narrow[0] ?? [])).not.toContain('until prompt cache expires')
})

test('stacks rows when even the short forms do not share a line', () => {
  const rows = layoutRows(40, [ticking, prs, bus])

  expect(rows.length).toBeGreaterThan(1)
  expect(rows.every(row => widthOf(row) <= 40)).toBe(true)
})

test('a lone cache segment is shortened to fit', () => {
  const rows = layoutRows(30, [ticking])

  expect(rows).toHaveLength(1)
  expect(widthOf(rows[0] ?? [])).toBeLessThanOrEqual(30)
})

test('counts what a session spent since the last reading, restarting after a clear', () => {
  expect(costDelta(1.5, 2)).toBe(0.5)
  expect(costDelta(2, 2)).toBe(0)
  expect(costDelta(5, 0.3)).toBe(0.3)
})

test('names the local day and formats money', () => {
  expect(localDay(new Date(2026, 9, 6, 23, 59).getTime())).toBe('2026-10-06')
  expect(localDay(new Date(2026, 0, 3, 0, 1).getTime())).toBe('2026-01-03')
  expect(formatUsd(4.123)).toBe('$4.12')
  expect(formatUsd(0)).toBe('$0.00')
  expect(formatUsd(123.4)).toBe('$123')
})

test('labels and colours plan limits', () => {
  expect(limitLabel('five_hour')).toBe('5h')
  expect(limitLabel('seven_day')).toBe('7d')
  expect(limitLabel('something_new')).toBe('something_new')
  expect(limitColor(10)).toBe('success')
  expect(limitColor(70)).toBe('warning')
  expect(limitColor(90)).toBe('error')
})

test('the usage segment shows cost and every limit, and shortens to the busiest one', () => {
  const segment = usageSegment(4.12, [
    { kind: 'five_hour', percentUsed: 63.4 },
    { kind: 'seven_day', percentUsed: 21 },
  ])

  expect(text(segment?.long ?? [])).toBe('$4.12 today · 5h 63% 7d 21%')
  expect(text(segment?.short ?? [])).toBe('$4.12 · 5h 63%')
  expect(text(usageSegment(1.39, [{ kind: 'seven_day', percentUsed: 22 }])?.short ?? [])).toBe('$1.39 · 7d 22%')
  expect(text(usageSegment(1, [])?.long ?? [])).toBe('$1.00 today')
  expect(text(usageSegment(null, [{ kind: 'five_hour', percentUsed: 5 }])?.long ?? [])).toBe('5h 5%')
  expect(usageSegment(null, [])).toBeNull()
})

test('backs off by doubling between the base and the cap', () => {
  expect(backoff(0, 60_000, 600_000)).toBe(60_000)
  expect(backoff(60_000, 60_000, 600_000)).toBe(120_000)
  expect(backoff(400_000, 60_000, 600_000)).toBe(600_000)
  expect(backoff(600_000, 60_000, 600_000)).toBe(600_000)
})

test('describes the last TTL check', () => {
  expect(describeCheck(372_000, 100_000, { input_tokens: 10, cache_read_input_tokens: 31_000, cache_creation_input_tokens: 69_000 })).toBe(
    'last check: idle 6:12, 31% read, 69% written',
  )
})

test('cache segments cover every state', () => {
  const text = (segment: ReturnType<typeof cacheSegment>) => segment.long.map(piece => piece.text).join('')

  expect(text(cacheSegment({ kind: 'waiting' }))).toContain('starts after the next response')
  expect(text(cacheSegment({ kind: 'working' }))).toContain('refreshing')
  expect(text(cacheSegment({ kind: 'expired' }))).toContain('Cache expired')
})
