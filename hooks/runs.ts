import type { Segment } from './pieces'

export type RunCount = { queued: number; running: number }

const QUEUED = new Set(['queued', 'waiting', 'pending', 'requested'])

export const parseRuns = (text: string): RunCount | null => {
  try {
    const runs: unknown = JSON.parse(text)

    if (!Array.isArray(runs)) {
      return null
    }

    const statuses = runs.map(run => run?.status)

    return {
      queued: statuses.filter(status => QUEUED.has(status)).length,
      running: statuses.filter(status => status === 'in_progress').length,
    }
  } catch {
    return null
  }
}

export const runLine = ({ queued, running }: RunCount) =>
  `${queued} queued${running > 0 ? ` · ${running} running` : ''}`

export const runSegment = (runs: RunCount): Segment => {
  const color = runs.queued > 0 ? 'warning' : 'success'

  return {
    long: [{ text: '▶', color }, { text: ` ${runLine(runs)}`, dim: true }],
    short: [{ text: '▶', color }, { text: ` ${runs.queued} queued`, dim: true }],
  }
}
