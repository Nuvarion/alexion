import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { positionAfterLast } from '../../lib/position'
import type { PageMeta } from '../../lib/types'
import {
  createPage,
  deletePage,
  fetchPage,
  movePage,
  movePageToSpace,
  updatePageContent,
  updatePageTitle,
} from './api'
import { appendPageLink, hasPageLink, removePageLink } from './pageLinks'

export interface MovePageInput {
  id: string
  parentId: string | null
  position: number
  oldParentId: string | null
  title: string
  // пространства источника и назначения: равны — перенос внутри секции,
  // различны — кросс-пространственный перенос через RPC
  sourceSpaceId: string
  targetSpaceId: string
}

// Собирает id всего поддерева страницы по parent-связям метаданных кэша.
function collectSubtreeIds(metas: PageMeta[], rootId: string): Set<string> {
  const childrenOf = new Map<string | null, PageMeta[]>()
  for (const m of metas) {
    const list = childrenOf.get(m.parent_id) ?? []
    list.push(m)
    childrenOf.set(m.parent_id, list)
  }
  const ids = new Set<string>()
  const stack = [rootId]
  while (stack.length) {
    const id = stack.pop()!
    ids.add(id)
    for (const child of childrenOf.get(id) ?? []) stack.push(child.id)
  }
  return ids
}

// Перенос страницы в дереве: optimistic update, откат при ошибке.
// При смене родителя ссылка на страницу «переезжает» вместе с ней:
// удаляется из контента старого родителя и добавляется в конец нового.
// Если source !== target — перенос между пространствами через RPC
// (поддерево меняет teamspace_id на сервере).
export function useMovePage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      parentId,
      position,
      oldParentId,
      title,
      sourceSpaceId,
      targetSpaceId,
    }: MovePageInput) => {
      if (sourceSpaceId === targetSpaceId) {
        await movePage(id, parentId, position)
      } else {
        await movePageToSpace(id, targetSpaceId, parentId, position)
      }
      if (parentId === oldParentId) return

      // «переезд ссылки» работает по id и одинаков для обоих случаев
      if (oldParentId) {
        const parent = await fetchPage(oldParentId)
        const { blocks, removed } = removePageLink(parent.content, id)
        if (removed) await updatePageContent(oldParentId, blocks)
      }
      if (parentId) {
        const parent = await fetchPage(parentId)
        if (!hasPageLink(parent.content, id)) {
          await updatePageContent(parentId, appendPageLink(parent.content, id, title))
        }
      }
    },
    onMutate: async ({ id, parentId, position, sourceSpaceId, targetSpaceId }) => {
      await queryClient.cancelQueries({ queryKey: ['pages', sourceSpaceId] })
      const prev = queryClient.getQueryData<PageMeta[]>(['pages', sourceSpaceId])
      if (sourceSpaceId === targetSpaceId) {
        // тот же список: переставляем страницу внутри него
        queryClient.setQueryData<PageMeta[]>(['pages', sourceSpaceId], (metas) =>
          (metas ?? []).map((m) =>
            m.id === id ? { ...m, parent_id: parentId, position } : m,
          ),
        )
      } else {
        // кросс-перенос: убираем страницу и её поддерево из источника,
        // в целевой список придёт инвалидацией onSettled
        const ids = collectSubtreeIds(prev ?? [], id)
        queryClient.setQueryData<PageMeta[]>(['pages', sourceSpaceId], (metas) =>
          (metas ?? []).filter((m) => !ids.has(m.id)),
        )
      }
      return { prev }
    },
    onError: (_err, { sourceSpaceId }, context) => {
      // Откат может разойтись с сервером (RPC прошёл, упал перенос ссылки) —
      // источником истины остаётся двойная инвалидация в onSettled
      if (context?.prev) {
        queryClient.setQueryData(['pages', sourceSpaceId], context.prev)
      }
    },
    onSettled: (_data, _err, { parentId, oldParentId, sourceSpaceId, targetSpaceId }) => {
      void queryClient.invalidateQueries({ queryKey: ['pages', sourceSpaceId] })
      if (targetSpaceId !== sourceSpaceId) {
        void queryClient.invalidateQueries({ queryKey: ['pages', targetSpaceId] })
      }
      // обновляем открытые редакторы родителей, чей контент мы трогали
      if (oldParentId) {
        void queryClient.invalidateQueries({ queryKey: ['page', oldParentId] })
      }
      if (parentId && parentId !== oldParentId) {
        void queryClient.invalidateQueries({ queryKey: ['page', parentId] })
      }
    },
  })
}

export function useCreatePage(spaceId: string) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: (parentId: string | null) => {
      const metas = queryClient.getQueryData<PageMeta[]>(['pages', spaceId]) ?? []
      const siblings = metas.filter((m) => m.parent_id === parentId)
      return createPage(parentId, positionAfterLast(siblings), spaceId)
    },
    onSuccess: async (page) => {
      await queryClient.invalidateQueries({ queryKey: ['pages', spaceId] })
      navigate(`/page/${page.id}`)
    },
  })
}

export function useRenamePage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      updatePageTitle(id, title),
    // префиксная инвалидация покрывает все пространства
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pages'] }),
  })
}

export function useDeletePage(spaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deletePage(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pages', spaceId] }),
  })
}
