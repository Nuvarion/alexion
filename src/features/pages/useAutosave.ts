import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Block } from '@blocknote/core'
import { useDebouncedSave } from '../../hooks/useDebouncedSave'
import type { Page } from '../../lib/types'
import { updatePageContent } from './api'

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error'

// Сохраняет контент редактора. Кэш ['page', id] обновляется вручную
// (setQueryData), а не инвалидацией — иначе редактор перерисуется под руками.
export function useAutosave(pageId: string) {
  const [status, setStatus] = useState<SaveStatus>('saved')
  const queryClient = useQueryClient()

  const { schedule, flush } = useDebouncedSave<Block[]>(async (content) => {
    setStatus('saving')
    try {
      await updatePageContent(pageId, content)
      queryClient.setQueryData<Page>(['page', pageId], (prev) =>
        prev ? { ...prev, content } : prev,
      )
      setStatus('saved')
    } catch {
      setStatus('error')
    }
  })

  function onChange(content: Block[]) {
    setStatus('pending')
    schedule(content)
  }

  return { onChange, flush, status }
}
