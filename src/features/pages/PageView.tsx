import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import Spinner from '../../components/Spinner'
import { useDebouncedSave } from '../../hooks/useDebouncedSave'
import type { Page } from '../../lib/types'
import { fetchPage, updatePageTitle } from './api'
import Breadcrumbs from './Breadcrumbs'
import PageEditor from './PageEditor'
import { useAutosave, type SaveStatus } from './useAutosave'

const STATUS_LABEL: Record<SaveStatus, string> = {
  saved: 'Сохранено',
  pending: 'Изменено…',
  saving: 'Сохранение…',
  error: 'Ошибка сохранения!',
}

function PageContent({ page }: { page: Page }) {
  const queryClient = useQueryClient()
  const autosave = useAutosave(page.id)

  const titleSave = useDebouncedSave<string>(async (title) => {
    await updatePageTitle(page.id, title)
    queryClient.setQueryData<Page>(['page', page.id], (prev) =>
      prev ? { ...prev, title } : prev,
    )
    await queryClient.invalidateQueries({ queryKey: ['pages'] })
  })

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Breadcrumbs pageId={page.id} />
        <span
          style={{
            fontSize: 13,
            color: autosave.status === 'error' ? 'var(--color-danger)' : 'var(--color-text-muted)',
          }}
        >
          {STATUS_LABEL[autosave.status]}
        </span>
      </div>
      <input
        className="page-title-input"
        defaultValue={page.title}
        placeholder="Без названия"
        onChange={(e) => titleSave.schedule(e.target.value)}
        onBlur={titleSave.flush}
      />
      <div style={{ margin: '16px -54px 0' }}>
        <PageEditor initialContent={page.content} onChange={autosave.onChange} />
      </div>
    </div>
  )
}

export default function PageView() {
  const { id } = useParams<{ id: string }>()
  const { data: page, isLoading, isError } = useQuery({
    queryKey: ['page', id],
    queryFn: () => fetchPage(id!),
    enabled: Boolean(id),
    refetchOnWindowFocus: false,
  })

  if (isLoading) return <Spinner />
  if (isError || !page) {
    return (
      <div style={{ padding: 32, color: 'var(--color-text-muted)' }}>
        Страница не найдена.
      </div>
    )
  }

  // key: при смене страницы пересоздаём заголовок, автосейв и редактор —
  // useCreateBlockNote и defaultValue не реактивны к новым данным.
  return <PageContent key={page.id} page={page} />
}
