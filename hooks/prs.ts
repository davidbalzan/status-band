import type { Segment } from './pieces'

export type PrCount = { open: number; drafts: number }

export const parsePrs = (text: string): PrCount | null => {
  try {
    const prs: unknown = JSON.parse(text)

    return Array.isArray(prs)
      ? { open: prs.length, drafts: prs.filter(pr => pr?.isDraft === true).length }
      : null
  } catch {
    return null
  }
}

export const prLine = ({ open, drafts }: PrCount) =>
  `${open} open PR${open === 1 ? '' : 's'}${drafts > 0 ? ` (${drafts} draft)` : ''}`

export const prSegment = (prs: PrCount): Segment => {
  const color = prs.open > 0 ? 'warning' : 'success'

  return {
    long: [{ text: '⎇', color }, { text: ` ${prLine(prs)}`, dim: true }],
    short: [{ text: '⎇', color }, { text: ` ${prs.open} PR${prs.open === 1 ? '' : 's'}`, dim: true }],
  }
}
