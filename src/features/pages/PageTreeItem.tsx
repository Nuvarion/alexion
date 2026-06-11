import { useDraggable, useDroppable } from '@dnd-kit/core'
import { useNavigate, useParams } from 'react-router-dom'
import { useToast } from '../../components/toastContext'
import { MAX_PAGE_DEPTH, type PageNode } from './usePagesTree'
import { useCreatePage, useDeletePage } from './usePageMutations'
import { treeIndent, zoneDropId, type TreeDragState } from './treeDnd'

interface PageTreeItemProps {
  node: PageNode
  depth: number
  expanded: Set<string>
  onToggle: (id: string) => void
  drag: TreeDragState | null
  spaceId: string
}

// Зоны дропа поверх строки: верхняя четверть — «выше», середина — «внутрь»,
// нижняя четверть — «ниже». Смонтированы всегда (pointer-events: none,
// dnd-kit меряет коллизии по координатам) и выключены вне перетаскивания —
// если монтировать их по старту drag, быстрый drop успевает раньше рендера.
function RowDropZones({
  node,
  depth,
  drag,
  expanded,
}: {
  node: PageNode
  depth: number
  drag: TreeDragState | null
  expanded: Set<string>
}) {
  // «ниже» развёрнутой страницы с детьми = первым ребёнком (см. computeDrop)
  const afterActsAsInside =
    expanded.has(node.id) && node.children.length > 0
  // Глубину здесь не проверяем: превышение лимита ловится на дропе
  // (SpaceTree.handleDragEnd) и показывается тостом
  const disabled = !drag || drag.invalidIds.has(node.id)

  const { setNodeRef: setBeforeRef, isOver: beforeOver } = useDroppable({
    id: zoneDropId(node.id, 'before'),
    disabled,
  })
  const { setNodeRef: setInsideRef, isOver: insideOver } = useDroppable({
    id: zoneDropId(node.id, 'inside'),
    disabled,
  })
  const { setNodeRef: setAfterRef, isOver: afterOver } = useDroppable({
    id: zoneDropId(node.id, 'after'),
    disabled,
  })

  const indent = treeIndent(depth)

  return (
    <>
      <div ref={setBeforeRef} className="tree-dropzone" style={{ top: 0, height: '25%' }} />
      <div ref={setInsideRef} className="tree-dropzone" style={{ top: '25%', height: '50%' }} />
      <div ref={setAfterRef} className="tree-dropzone" style={{ bottom: 0, height: '25%' }} />
      {beforeOver && <div className="tree-drop-line" style={{ top: -2, left: indent }} />}
      {afterOver && !afterActsAsInside && (
        <div className="tree-drop-line" style={{ bottom: -2, left: indent }} />
      )}
      {afterOver && afterActsAsInside && (
        <div className="tree-drop-line" style={{ bottom: -2, left: indent + 14 }} />
      )}
      {insideOver && <div className="tree-drop-inside" />}
    </>
  )
}

export default function PageTreeItem({
  node,
  depth,
  expanded,
  onToggle,
  drag,
  spaceId,
}: PageTreeItemProps) {
  const { id: activeId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const createPage = useCreatePage(spaceId)
  const deletePage = useDeletePage(spaceId)
  const isExpanded = expanded.has(node.id)
  const isActive = activeId === node.id

  const { setNodeRef, listeners, attributes } = useDraggable({ id: node.id })
  const isDragSource = drag?.activeId === node.id

  function handleDelete() {
    const message = node.children.length
      ? 'Удалить страницу вместе со всеми вложенными?'
      : 'Удалить страницу?'
    if (!window.confirm(message)) return
    deletePage.mutate(node.id, {
      onSuccess: () => {
        if (isActive) navigate('/')
      },
    })
  }

  return (
    <div className={isDragSource ? 'tree-subtree-dragging' : undefined}>
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        className={`tree-item${isActive ? ' tree-item-active' : ''}`}
        style={{ paddingLeft: treeIndent(depth) }}
      >
        <button
          type="button"
          className="tree-toggle"
          onClick={() => onToggle(node.id)}
          aria-label={isExpanded ? 'Свернуть' : 'Развернуть'}
        >
          {node.children.length > 0 ? (isExpanded ? '▾' : '▸') : '·'}
        </button>
        <button
          type="button"
          className="tree-title"
          onClick={() => navigate(`/page/${node.id}`)}
        >
          {node.title || 'Без названия'}
        </button>
        <span className="tree-actions">
          <button
            type="button"
            title="Добавить подстраницу"
            onClick={() => {
              if (depth >= MAX_PAGE_DEPTH) {
                toast(`Лимит вложенности — ${MAX_PAGE_DEPTH} уровней`)
                return
              }
              createPage.mutate(node.id)
            }}
          >
            +
          </button>
          <button type="button" title="Удалить" onClick={handleDelete}>
            ×
          </button>
        </span>
        <RowDropZones node={node} depth={depth} drag={drag} expanded={expanded} />
      </div>
      {isExpanded &&
        node.children.map((child) => (
          <PageTreeItem
            key={child.id}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            drag={drag}
            spaceId={spaceId}
          />
        ))}
    </div>
  )
}
