import type { Piece, Segment } from './pieces'

export type PlanLimit = { kind: string; percentUsed: number }

/** What a session spent since the last reading; a counter that went backwards (a clear) restarts from zero. */
export const costDelta = (previousUsd: number, currentUsd: number) =>
  currentUsd >= previousUsd ? currentUsd - previousUsd : currentUsd

export const localDay = (ms: number) => {
  const date = new Date(ms)

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export const formatUsd = (usd: number) => (usd >= 100 ? `$${Math.round(usd)}` : `$${usd.toFixed(2)}`)

const LIMIT_LABELS: Readonly<Record<string, string>> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

export const limitLabel = (kind: string) => LIMIT_LABELS[kind] ?? kind

export const limitColor = (percentUsed: number) =>
  percentUsed < 60 ? 'success' : percentUsed < 85 ? 'warning' : 'error'

const percentText = (percentUsed: number) => `${Math.round(percentUsed)}%`

const gap = (pieces: readonly Piece[]): Piece[] => (pieces.length > 0 ? [{ text: ' · ', dim: true }] : [])

export const usageSegment = (todayUsd: number | null, limits: readonly PlanLimit[]): Segment | null => {
  if (todayUsd === null && limits.length === 0) {
    return null
  }

  const cost: Piece[] = todayUsd === null ? [] : [{ text: formatUsd(todayUsd) }, { text: ' today', dim: true }]
  const busiest = limits.reduce<PlanLimit | null>(
    (worst, limit) => (!worst || limit.percentUsed > worst.percentUsed ? limit : worst),
    null,
  )

  return {
    long: [
      ...cost,
      ...limits.flatMap((limit, index) => [
        ...(index === 0 ? gap(cost) : [{ text: ' ', dim: true }]),
        { text: `${limitLabel(limit.kind)} `, dim: true },
        { text: percentText(limit.percentUsed), color: limitColor(limit.percentUsed) },
      ]),
    ],
    short: [
      ...(todayUsd === null ? [] : [{ text: formatUsd(todayUsd) }]),
      ...(busiest
        ? [
            ...gap(todayUsd === null ? [] : cost),
            { text: `${limitLabel(busiest.kind)} `, dim: true },
            { text: percentText(busiest.percentUsed), color: limitColor(busiest.percentUsed) },
          ]
        : []),
    ],
  }
}
