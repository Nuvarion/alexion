// Fractional indexing: позиция элемента — среднее между соседями,
// перенос меняет одну строку в БД. Общее для дерева страниц и канбана.

const STEP = 1

export function positionBetween(
  before: number | undefined,
  after: number | undefined,
): number {
  if (before === undefined && after === undefined) return 0
  if (before === undefined) return after! - STEP
  if (after === undefined) return before + STEP
  return (before + after) / 2
}

export function positionAfterLast(items: { position: number }[]): number {
  if (items.length === 0) return 0
  return Math.max(...items.map((i) => i.position)) + STEP
}
