import type { Block } from '@blocknote/core'

// Для дерева/крошек контент не нужен — сайдбар грузит только PageMeta.
export interface PageMeta {
  id: string
  parent_id: string | null
  title: string
  position: number
}

export interface Page extends PageMeta {
  content: Block[]
}

export type TaskStatus = 'todo' | 'in_progress' | 'done'

export interface Task {
  id: string
  title: string
  description: string
  status: TaskStatus
  position: number
}
