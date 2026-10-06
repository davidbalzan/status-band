import type { Piece, Segment } from './pieces'

export const BAR_CELLS = 20
export const SHORT_BAR_CELLS = 10
export const TTL_MS = { '5m': 5 * 60_000, '1h': 60 * 60_000 } as const
const MARGIN_MS = 30_000

export type Ttl = keyof typeof TTL_MS

export type RequestUsage = {
  input_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export const isTtl = (value: unknown): value is Ttl => value === '5m' || value === '1h'

export const formatRemaining = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export const barColor = (fraction: number) => (fraction > 0.5 ? 'success' : fraction > 0.2 ? 'warning' : 'error')

/**
 * Reads the TTL off the first request after an idle gap. If the previous context was still served from
 * cache after more than 5 minutes the cache lives an hour; if a good part of it was written afresh within
 * the hour it lives 5 minutes (a shared system-prompt prefix can stay cached either way, so the rebuilt
 * share is what counts, not the cached one). Anything else (short gap, nothing to compare, an hour or
 * more, a mixed result) says nothing.
 */
export const judgeTtl = (gapMs: number, previousTokens: number, usage: RequestUsage): Ttl | null => {
  if (previousTokens <= 0 || gapMs <= TTL_MS['5m'] + MARGIN_MS) {
    return null
  }

  if (usage.cache_read_input_tokens / previousTokens >= 0.8) {
    return '1h'
  }

  const isRebuilt = usage.cache_creation_input_tokens / previousTokens >= 0.3

  return isRebuilt && gapMs < TTL_MS['1h'] - MARGIN_MS ? '5m' : null
}

export const describeCheck = (gapMs: number, previousTokens: number, usage: RequestUsage) => {
  const percent = (tokens: number) => (previousTokens > 0 ? Math.round((tokens / previousTokens) * 100) : 0)

  return `last check: idle ${formatRemaining(gapMs)}, ${percent(usage.cache_read_input_tokens)}% read, ${percent(usage.cache_creation_input_tokens)}% written`
}

const barPieces = (fraction: number, cells: number, color: string): Piece[] => {
  const filled = Math.max(1, Math.ceil(fraction * cells))

  return [{ text: '█'.repeat(filled), color }, { text: '░'.repeat(cells - filled), dim: true }]
}

export type CacheState =
  | { kind: 'waiting' }
  | { kind: 'working' }
  | { kind: 'expired' }
  | { kind: 'ticking'; remainingMs: number; ttl: Ttl; source: string; lastCheck: string | null }

export const cacheSegment = (state: CacheState): Segment => {
  switch (state.kind) {
    case 'waiting':
      return {
        long: [{ text: 'Cache timer: starts after the next response', dim: true }],
        short: [{ text: 'cache: waiting', dim: true }],
      }
    case 'working':
      return {
        long: [{ text: 'Cache: refreshing while the model works', dim: true }],
        short: [{ text: 'cache: refreshing', dim: true }],
      }
    case 'expired':
      return {
        long: [
          { text: '░'.repeat(BAR_CELLS), color: 'error' },
          { text: ' Cache expired: next prompt re-caches the context at a higher cost', color: 'error', bold: true },
        ],
        short: [{ text: 'Cache expired: next prompt costs more', color: 'error', bold: true }],
      }
    case 'ticking': {
      const fraction = state.remainingMs / TTL_MS[state.ttl]
      const color = barColor(fraction)
      const time: Piece = { text: ` ${formatRemaining(state.remainingMs)}`, color }
      const check = state.lastCheck && state.source === 'assumed' ? `; ${state.lastCheck}` : ''

      return {
        long: [
          ...barPieces(fraction, BAR_CELLS, color),
          time,
          { text: ` until prompt cache expires (${state.ttl} ${state.source}${check})`, dim: true },
        ],
        short: [...barPieces(fraction, SHORT_BAR_CELLS, color), time, { text: ' cache', dim: true }],
      }
    }
  }
}
