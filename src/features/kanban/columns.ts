import type { TaskStatus } from '../../lib/types'

// Единственное описание колонок: от него работают рендер доски
// и маппинг статусов при CSV-импорте (OCP — новая колонка = одна запись).
export interface KanbanColumnConfig {
  status: TaskStatus
  title: string
  csvPatterns: RegExp
}

export const KANBAN_COLUMNS: KanbanColumnConfig[] = [
  {
    status: 'todo',
    title: 'To Do',
    csvPatterns: /not started|todo|к выполнению|не начат/i,
  },
  {
    status: 'in_progress',
    title: 'In Progress',
    csvPatterns: /progress|doing|в работе|выполняется/i,
  },
  {
    status: 'done',
    title: 'Done',
    csvPatterns: /done|complete|готово|завершен/i,
  },
]

const STATUSES = new Set<string>(KANBAN_COLUMNS.map((c) => c.status))

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && STATUSES.has(value)
}

export function statusFromCsv(value: string): TaskStatus {
  // todo проверяем последним: это статус по умолчанию для нераспознанного
  for (const column of [...KANBAN_COLUMNS].reverse()) {
    if (column.csvPatterns.test(value)) return column.status
  }
  return 'todo'
}
