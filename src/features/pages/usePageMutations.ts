import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { positionAfterLast } from '../../lib/position'
import type { PageMeta } from '../../lib/types'
import { createPage, deletePage, updatePageTitle } from './api'

export function useCreatePage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: (parentId: string | null) => {
      const metas = queryClient.getQueryData<PageMeta[]>(['pages']) ?? []
      const siblings = metas.filter((m) => m.parent_id === parentId)
      return createPage(parentId, positionAfterLast(siblings))
    },
    onSuccess: async (page) => {
      await queryClient.invalidateQueries({ queryKey: ['pages'] })
      navigate(`/page/${page.id}`)
    },
  })
}

export function useRenamePage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      updatePageTitle(id, title),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pages'] }),
  })
}

export function useDeletePage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deletePage(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pages'] }),
  })
}
