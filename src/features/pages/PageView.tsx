import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
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
  const navigate = useNavigate()
  const autosave = useAutosave(page.id)

  // Внутренние ссылки (/page/<id>) ведём через роутер: без перезагрузки
  // и независимо от base-пути на хостинге. BlockNote открывает ссылки в новой
  // вкладке по mouseup — гасим и mouseup, и click в capture-фазе.
  function matchInternalLink(e: React.MouseEvent): string | null {
    const anchor = (e.target as HTMLElement).closest('a')
    if (!anchor) return null
    const url = new URL(anchor.href, window.location.origin)
    const match = url.pathname.match(/^\/page\/([0-9a-f-]{36})$/i)
    return url.origin === window.location.origin && match ? match[1] : null
  }

  function handleEditorMouseUp(e: React.MouseEvent) {
    if (matchInternalLink(e)) e.stopPropagation()
  }

  function handleEditorClick(e: React.MouseEvent) {
    const pageId = matchInternalLink(e)
    if (!pageId) return
    e.preventDefault()
    e.stopPropagation()
    navigate(`/page/${pageId}`)
  }

  const titleSave = useDebouncedSave<string>(async (title) => {
    await updatePageTitle(page.id, title)
    // updatedAt прежний — см. комментарий про ремаунт в PageView ниже
    queryClient.setQueryData<Page>(
      ['page', page.id],
      (prev) => (prev ? { ...prev, title } : prev),
      { updatedAt: queryClient.getQueryState(['page', page.id])?.dataUpdatedAt },
    )
    await queryClient.invalidateQueries({ queryKey: ['pages'] })
  })

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Breadcrumbs pageId={page.id} spaceId={page.teamspace_id} />
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
      <div
        style={{ margin: '16px -54px 0' }}
        onMouseUpCapture={handleEditorMouseUp}
        onClickCapture={handleEditorClick}
      >
        <PageEditor initialContent={page.content} onChange={autosave.onChange} />
      </div>
    </div>
  )
}

export default function PageView() {
  const { id } = useParams<{ id: string }>()
  const { data: page, isLoading, isError, dataUpdatedAt } = useQuery({
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

  // key: при смене страницы или внешнем изменении контента (рефетч после
  // переноса ссылки) пересоздаём заголовок, автосейв и редактор —
  // useCreateBlockNote и defaultValue не реактивны к новым данным. Автосейв
  // обновляет кэш через setQueryData, не меняя dataUpdatedAt рефетчем.
  return <PageContent key={`${page.id}:${dataUpdatedAt}`} page={page} />
}
