import { supabase } from '../../lib/supabase'
import type { Task, TaskStatus } from '../../lib/types'

const COLUMNS = 'id, title, description, status, position, teamspace_id'

// После миграции 0005 teamspace_id обязателен — всегда фильтруем по .eq
export async function fetchTasks(spaceId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select(COLUMNS)
    .eq('teamspace_id', spaceId)
    .order('position')
  if (error) throw error
  return data
}

export interface NewTask {
  title: string
  status: TaskStatus
  position: number
  description?: string
  teamspace_id: string
}

export async function createTask(input: NewTask): Promise<Task> {
  const { data, error } = await supabase
    .from('tasks')
    .insert(input)
    .select(COLUMNS)
    .single()
  if (error) throw error
  return data
}

export async function insertTasks(rows: NewTask[]): Promise<number> {
  if (rows.length === 0) return 0
  const { data, error } = await supabase.from('tasks').insert(rows).select('id')
  if (error) throw error
  return data.length
}

export type TaskPatch = Partial<
  Pick<Task, 'title' | 'description' | 'status' | 'position'>
>

export async function updateTask(id: string, patch: TaskPatch): Promise<void> {
  const { error } = await supabase.from('tasks').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteTask(id: string): Promise<void> {
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) throw error
}
