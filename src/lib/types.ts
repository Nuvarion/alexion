import type { Block } from '@blocknote/core'

// Для дерева/крошек контент не нужен — сайдбар грузит только PageMeta.
export interface PageMeta {
  id: string
  parent_id: string | null
  title: string
  position: number
  // После миграции 0005 teamspace_id обязателен (NOT NULL)
  teamspace_id: string
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
  // После миграции 0005 teamspace_id обязателен (NOT NULL)
  teamspace_id: string
}

export interface Teamspace {
  id: string
  name: string
  owner_id: string
  // personal — личное пространство пользователя, team — командное
  kind: 'personal' | 'team'
}

export interface TeamspaceMember {
  teamspace_id: string
  email: string
  user_id: string
  role: 'owner' | 'member'
}
