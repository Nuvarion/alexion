import { useState, type FormEvent } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { positionAfterLast } from '../../lib/position'
import type { Task } from '../../lib/types'
import type { KanbanColumnConfig } from './columns'
import TaskCard from './TaskCard'
import { useCreateTask } from './useTasks'

interface KanbanColumnProps {
  column: KanbanColumnConfig
  tasks: Task[]
  onTaskClick: (task: Task) => void
}

export default function KanbanColumn({ column, tasks, onTaskClick }: KanbanColumnProps) {
  const { setNodeRef } = useDroppable({ id: column.status })
  const createTask = useCreateTask()
  const [title, setTitle] = useState('')

  function handleQuickAdd(e: FormEvent) {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) return
    createTask.mutate({
      title: trimmed,
      status: column.status,
      position: positionAfterLast(tasks),
    })
    setTitle('')
  }

  return (
    <div className="kanban-column" ref={setNodeRef}>
      <div className="kanban-column-header">
        {column.title}
        <span className="kanban-count">{tasks.length}</span>
      </div>
      <SortableContext
        items={tasks.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="kanban-cards">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} onClick={onTaskClick} />
          ))}
        </div>
      </SortableContext>
      <form onSubmit={handleQuickAdd}>
        <input
          className="kanban-quick-add"
          placeholder="+ Новая задача"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </form>
    </div>
  )
}
