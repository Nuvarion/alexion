import { useDroppable } from '@dnd-kit/core'
import PageTreeItem from './PageTreeItem'
import { usePagesTree } from './usePagesTree'
import { rootEndId, type TreeDragState } from './treeDnd'

interface SpaceTreeProps {
  spaceId: string
  expanded: Set<string>
  onToggle: (id: string) => void
  drag: TreeDragState | null
}

// Зона дропа в корень пространства: дроп сюда — в конец корневого уровня.
// Id включает spaceId — у каждой секции своя зона в общем DndContext.
function RootDropZone({ spaceId }: { spaceId: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: rootEndId(spaceId) })
  return (
    <div ref={setNodeRef} style={{ minHeight: 24, position: 'relative' }}>
      {isOver && <div className="tree-drop-line" style={{ top: 0, left: 4 }} />}
    </div>
  )
}

// Секция-дерево одного пространства. DndContext, drag-state и DragOverlay
// живут в Sidebar (единый контекст на весь сайдбар) — здесь только рендер
// строк и droppable-зон, регистрируемых в общий контекст через React-дерево.
export default function SpaceTree({
  spaceId,
  expanded,
  onToggle,
  drag,
}: SpaceTreeProps) {
  const { tree, isLoading } = usePagesTree(spaceId)

  return (
    <>
      {isLoading && (
        <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
          Загрузка…
        </span>
      )}
      {tree.map((node) => (
        <PageTreeItem
          key={node.id}
          node={node}
          depth={1}
          expanded={expanded}
          onToggle={onToggle}
          drag={drag}
          spaceId={spaceId}
        />
      ))}
      <RootDropZone spaceId={spaceId} />
    </>
  )
}
