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

export function useTasks() {
  const query = useQuery({ queryKey: ['tasks'], queryFn: fetchTasks })
  const byStatus = useMemo(() => {
    const map = new Map<TaskStatus, Task[]>(
      KANBAN_COLUMNS.map((c) => [c.status, []]),
    )
    for (const task of query.data ?? []) map.get(task.status)?.push(task)
    return map
  }, [query.data])
  return { ...query, byStatus }
}

export function useCreateTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: NewTask) => createTask(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

export function useUpdateTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TaskPatch }) =>
      updateTask(id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

// Перенос карточки: optimistic update, откат при ошибке.
export function useMoveTask() {
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
      await queryClient.cancelQueries({ queryKey: ['tasks'] })
      const prev = queryClient.getQueryData<Task[]>(['tasks'])
      queryClient.setQueryData<Task[]>(['tasks'], (tasks) =>
        (tasks ?? [])
          .map((t) => (t.id === id ? { ...t, status, position } : t))
          .sort((a, b) => a.position - b.position),
      )
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['tasks'], ctx.prev)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

export function useDeleteTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteTask(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  })
}
