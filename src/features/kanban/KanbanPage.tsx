import { useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import Spinner from '../../components/Spinner'
import { positionAfterLast, positionBetween } from '../../lib/position'
import type { Task, TaskStatus } from '../../lib/types'
import { usePersonalSpace } from '../teamspaces/useTeamspaces'
import { isTaskStatus, KANBAN_COLUMNS } from './columns'
import KanbanColumn from './KanbanColumn'
import TaskEditModal from './TaskEditModal'
import { useMoveTask, useTasks } from './useTasks'

// Внутренний компонент: рендерится только когда личный workspace известен
function KanbanBoard({ personalId }: { personalId: string }) {
  // null — ещё не выбрано (используем personalId по умолчанию)
  const [spaceId, setSpaceId] = useState<string | null>(null)
  const { spaces } = usePersonalSpace()
  // Эффективный spaceId: если пользователь не выбрал явно — личное
  const effectiveSpaceId = spaceId ?? personalId

  const { byStatus, data: tasks, isLoading, isError } = useTasks(effectiveSpaceId)
  const moveTask = useMoveTask(effectiveSpaceId)
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  // Дистанция активации отличает клик (открыть модалку) от перетаскивания
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )
  // Только командные пространства в селекторе
  const teamSpaces = (spaces ?? []).filter((s) => s.kind === 'team')

  if (isLoading) return <Spinner />
  if (isError) {
    return (
      <p style={{ padding: 32, color: 'var(--color-danger)' }}>
        Не удалось загрузить задачи. Проверь соединение и обнови страницу.
      </p>
    )
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveTask(tasks?.find((t) => t.id === event.active.id) ?? null)
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null)
    const { active, over } = event
    if (!over || !tasks) return
    const task = tasks.find((t) => t.id === active.id)
    if (!task) return

    let status: TaskStatus
    let position: number

    if (isTaskStatus(over.id)) {
      // Дроп на колонку (в т.ч. пустую) — в конец
      status = over.id
      const column = (byStatus.get(status) ?? []).filter((t) => t.id !== task.id)
      position = positionAfterLast(column)
    } else {
      const overTask = tasks.find((t) => t.id === over.id)
      if (!overTask || overTask.id === task.id) return
      status = overTask.status
      const column = (byStatus.get(status) ?? []).filter((t) => t.id !== task.id)
      const overIndex = column.findIndex((t) => t.id === overTask.id)
      const movingDownSameColumn =
        task.status === status && task.position < overTask.position
      const index = movingDownSameColumn ? overIndex + 1 : overIndex
      position = positionBetween(
        column[index - 1]?.position,
        column[index]?.position,
      )
    }

    if (status !== task.status || position !== task.position) {
      moveTask.mutate({ id: task.id, status, position })
    }
  }

  return (
    <div style={{ padding: 32 }}>
      <h1 style={{ marginTop: 0 }}>Задачи</h1>
      {/* Переключатель пространства */}
      {/* disabled во время drag: смена пространства рассинхронизирует optimistic-обновление */}
      <select
        value={effectiveSpaceId}
        onChange={(e) => setSpaceId(e.target.value)}
        style={{ marginBottom: 16 }}
        disabled={!!activeTask}
      >
        <option value={personalId}>Личное</option>
        {teamSpaces.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveTask(null)}
      >
        <div className="kanban-board">
          {KANBAN_COLUMNS.map((column) => (
            <KanbanColumn
              key={column.status}
              column={column}
              tasks={byStatus.get(column.status) ?? []}
              onTaskClick={setEditingTask}
              spaceId={effectiveSpaceId}
            />
          ))}
        </div>
        <DragOverlay>
          {activeTask && <div className="task-card">{activeTask.title}</div>}
        </DragOverlay>
      </DndContext>
      {editingTask && (
        <TaskEditModal
          task={editingTask}
          onClose={() => setEditingTask(null)}
        />
      )}
    </div>
  )
}

export default function KanbanPage() {
  const { personal } = usePersonalSpace()

  // Пока личный workspace не загружен — показываем спиннер
  if (!personal) return <Spinner />

  return <KanbanBoard personalId={personal.id} />
}
