import { useState, type ChangeEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { importPages, type PagesImportReport } from './importPages'
import { importTasksCsv, type TasksImportReport } from './importTasksCsv'
import {
  countPages,
  parseNotionZip,
  type NotionParseResult,
} from './parseNotionZip'

type Step =
  | { name: 'idle' }
  | { name: 'parsing' }
  | { name: 'parsed'; result: NotionParseResult }
  | { name: 'importing'; done: number; total: number }
  | {
      name: 'done'
      pages: PagesImportReport
      tasks: TasksImportReport | null
      skippedFiles: number
    }
  | { name: 'error'; message: string }

export default function ImportPage() {
  const [step, setStep] = useState<Step>({ name: 'idle' })
  const [csvPath, setCsvPath] = useState<string>('')
  const queryClient = useQueryClient()

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setStep({ name: 'parsing' })
    try {
      const result = await parseNotionZip(file)
      // эвристика: по умолчанию выбираем CSV с колонкой статуса
      const candidate = result.csvFiles.find((c) =>
        /status|статус/i.test(c.text.split('\n')[0] ?? ''),
      )
      setCsvPath(candidate?.path ?? '')
      setStep({ name: 'parsed', result })
    } catch {
      setStep({ name: 'error', message: 'Не удалось прочитать архив. Это zip-экспорт Notion (Markdown & CSV)?' })
    }
  }

  async function handleImport(result: NotionParseResult) {
    const total = countPages(result.pages)
    setStep({ name: 'importing', done: 0, total })
    try {
      const pagesReport = await importPages(result.pages, total, (done) =>
        setStep({ name: 'importing', done, total }),
      )
      const csv = result.csvFiles.find((c) => c.path === csvPath)
      const tasksReport = csv ? await importTasksCsv(csv.text) : null
      await queryClient.invalidateQueries({ queryKey: ['pages'] })
      await queryClient.invalidateQueries({ queryKey: ['tasks'] })
      setStep({
        name: 'done',
        pages: pagesReport,
        tasks: tasksReport,
        skippedFiles: result.skippedFiles,
      })
    } catch {
      setStep({
        name: 'error',
        message:
          'Импорт прервался (ошибка сети?). Уже созданные страницы остались — удали контейнер «Imported …» и попробуй снова.',
      })
    }
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: 32 }}>
      <h1>Импорт из Notion</h1>
      <p style={{ color: 'var(--color-text-muted)' }}>
        В Notion: Settings → Export content → формат «Markdown & CSV». Загрузи
        полученный zip сюда. Страницы попадут в новую страницу-контейнер
        «Imported», задачи из CSV — в трекер. Вложения (картинки, файлы) не
        импортируются. Повторный импорт создаст дубликаты.
      </p>

      {(step.name === 'idle' || step.name === 'error' || step.name === 'parsed') && (
        <input type="file" accept=".zip" onChange={handleFile} />
      )}
      {step.name === 'parsing' && <p>Читаю архив…</p>}

      {step.name === 'error' && (
        <p style={{ color: 'var(--color-danger)' }}>{step.message}</p>
      )}

      {step.name === 'parsed' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
          <div>
            Найдено страниц: <b>{countPages(step.result.pages)}</b>
            {step.result.skippedFiles > 0 &&
              `, пропущено вложений: ${step.result.skippedFiles}`}
          </div>
          {step.result.csvFiles.length > 0 && (
            <label>
              Таблица с задачами:{' '}
              <select value={csvPath} onChange={(e) => setCsvPath(e.target.value)}>
                <option value="">— не импортировать задачи —</option>
                {step.result.csvFiles.map((csv) => (
                  <option key={csv.path} value={csv.path}>
                    {csv.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" onClick={() => void handleImport(step.result)}>
            Импортировать
          </button>
        </div>
      )}

      {step.name === 'importing' && (
        <div style={{ marginTop: 16 }}>
          <p>
            Импорт страниц: {step.done} / {step.total}
          </p>
          <progress value={step.done} max={step.total} style={{ width: '100%' }} />
        </div>
      )}

      {step.name === 'done' && (
        <div style={{ marginTop: 16 }}>
          <p>
            Готово! Создано страниц: <b>{step.pages.created}</b>
            {step.pages.flattened > 0 && (
              <>
                {' '}
                (из них {step.pages.flattened} подняты выше по дереву из-за
                лимита вложенности 10)
              </>
            )}
            {step.tasks && (
              <>
                , задач: <b>{step.tasks.created}</b>
                {step.tasks.skipped > 0 && ` (пропущено строк без названия: ${step.tasks.skipped})`}
              </>
            )}
            {step.skippedFiles > 0 && `, вложений пропущено: ${step.skippedFiles}`}
          </p>
          <Link to={`/page/${step.pages.containerId}`}>
            Открыть импортированные страницы →
          </Link>
        </div>
      )}
    </div>
  )
}
