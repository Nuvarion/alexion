import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Task, TaskStatus } from '../../lib/types'
import {
  createTask,
  deleteTask,
  fetchTasks,
  updateTask,
  type NewTask,
  type TaskPatch,
} from './api'
import { KANBAN_COLUMNS } from './columns'

export function useTasks(spaceId: string) {
  const query = useQuery({
    queryKey: ['tasks', spaceId],
    queryFn: () => fetchTasks(spaceId),
  })
  const byStatus = useMemo(() => {
    const map = new Map<TaskStatus, Task[]>(
      KANBAN_COLUMNS.map((c) => [c.status, []]),
    )
    for (const task of query.data ?? []) map.get(task.status)?.push(task)
    return map
  }, [query.data])
  return { ...query, byStatus }
}

// Хук сам подставляет teamspace_id — вызывающий код не меняется.
export function useCreateTask(spaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Omit<NewTask, 'teamspace_id'>) =>
      createTask({ ...input, teamspace_id: spaceId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks', spaceId] }),
  })
}

export function useUpdateTask(spaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TaskPatch }) =>
      updateTask(id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks', spaceId] }),
  })
}

// Перенос карточки: optimistic update, откат при ошибке.
export function useMoveTask(spaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      status,
      position,
    }: {
      id: string
      status: TaskStatus
      position: number
    }) => updateTask(id, { status, position }),
    onMutate: async ({ id, status, position }) => {
      await queryClient.cancelQueries({ queryKey: ['tasks', spaceId] })
      const prev = queryClient.getQueryData<Task[]>(['tasks', spaceId])
      queryClient.setQueryData<Task[]>(['tasks', spaceId], (tasks) =>
        (tasks ?? [])
          .map((t) => (t.id === id ? { ...t, status, position } : t))
          .sort((a, b) => a.position - b.position),
      )
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['tasks', spaceId], ctx.prev)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['tasks', spaceId] }),
  })
}

export function useDeleteTask(spaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteTask(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks', spaceId] }),
  })
}
