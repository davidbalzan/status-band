export type Piece = { text: string; color?: string; dim?: boolean; bold?: boolean }

/** One status item in a long and a short form; the layout picks the form that fits. */
export type Segment = { long: readonly Piece[]; short: readonly Piece[] }

type Form = keyof Segment

const SEPARATOR: Piece = { text: ' │ ', dim: true }

export const widthOf = (pieces: readonly Piece[]) => pieces.reduce((total, piece) => total + [...piece.text].length, 0)

const joinRow = (pieces: readonly (readonly Piece[])[]) =>
  pieces.flatMap((row, index) => (index === 0 ? [...row] : [SEPARATOR, ...row]))

/**
 * Fits the segments (cache first, then the optional ones) into as few rows as the width allows,
 * shortening the extras before the cache. Falls back to one row each, shortened only if it must.
 */
export const layoutRows = (width: number, segments: readonly Segment[]): Piece[][] => {
  const fits = (rows: readonly (readonly Piece[])[]) => rows.every(row => widthOf(row) <= width)
  const oneRow = (forms: readonly Form[]) => [joinRow(segments.map((segment, i) => segment[forms[i] ?? 'short']))]
  const [cache, ...extras] = segments
  const all = (form: Form) => segments.map(() => form)
  const plans: (() => Piece[][])[] = [
    () => oneRow(all('long')),
    () => oneRow(segments.map((_, i) => (i === 0 ? 'long' : 'short'))),
    () => oneRow(all('short')),
  ]

  if (cache && extras.length > 0) {
    plans.push(
      () => [[...cache.long], joinRow(extras.map(segment => segment.long))],
      () => [[...cache.long], joinRow(extras.map(segment => segment.short))],
    )
  }

  for (const plan of plans) {
    const rows = plan()

    if (fits(rows)) {
      return rows
    }
  }

  return segments.map(segment => (widthOf(segment.long) <= width ? [...segment.long] : [...segment.short]))
}
