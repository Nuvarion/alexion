import Papa from 'papaparse'
import { insertTasks, type NewTask } from '../kanban/api'
import { statusFromCsv } from '../kanban/columns'

export interface TasksImportReport {
  created: number
  skipped: number
}

const TITLE_HEADER = /^(name|task|имя|название|задача)$/i
const STATUS_HEADER = /status|статус/i

// Импорт задач из CSV — помещает их в указанное пространство (spaceId)
export async function importTasksCsv(text: string, spaceId: string): Promise<TasksImportReport> {
  const { data } = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  })
  const headers = data.length > 0 ? Object.keys(data[0]) : []
  const titleKey =
    headers.find((h) => TITLE_HEADER.test(h.trim())) ?? headers[0]
  const statusKey = headers.find((h) => STATUS_HEADER.test(h))

  const rows: NewTask[] = data
    .map((row, i) => ({
      title: (row[titleKey] ?? '').trim(),
      status: statusKey ? statusFromCsv(row[statusKey] ?? '') : ('todo' as const),
      position: Date.now() + i,
      description: '',
      teamspace_id: spaceId,
    }))
    .filter((row) => row.title.length > 0)

  const created = await insertTasks(rows)
  return { created, skipped: data.length - rows.length }
}
