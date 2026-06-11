import { useState } from 'react'
import type { Task, TaskStatus } from '../../lib/types'
import { KANBAN_COLUMNS } from './columns'
import { useDeleteTask, useUpdateTask } from './useTasks'

interface TaskEditModalProps {
  task: Task
  onClose: () => void
}

export default function TaskEditModal({ task, onClose }: TaskEditModalProps) {
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const [status, setStatus] = useState<TaskStatus>(task.status)
  // Используем teamspace_id из самой задачи, чтобы инвалидировать правильный кэш
  // даже если пользователь успел переключить пространство в главном селекте.
  // После миграции 0005 teamspace_id гарантированно string.
  const updateTask = useUpdateTask(task.teamspace_id)
  const deleteTask = useDeleteTask(task.teamspace_id)

  function handleSave() {
    updateTask.mutate(
      { id: task.id, patch: { title: title.trim() || task.title, description, status } },
      { onSuccess: onClose },
    )
  }

  function handleDelete() {
    if (!window.confirm('Удалить задачу?')) return
    deleteTask.mutate(task.id, { onSuccess: onClose })
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Название задачи"
          autoFocus
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Описание"
          rows={5}
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as TaskStatus)}
        >
          {KANBAN_COLUMNS.map((c) => (
            <option key={c.status} value={c.status}>
              {c.title}
            </option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <button
            type="button"
            style={{ color: 'var(--color-danger)' }}
            onClick={handleDelete}
          >
            Удалить
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={onClose}>
              Отмена
            </button>
            <button type="button" onClick={handleSave} disabled={updateTask.isPending}>
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
