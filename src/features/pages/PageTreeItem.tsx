import { useNavigate, useParams } from 'react-router-dom'
import { MAX_PAGE_DEPTH, type PageNode } from './usePagesTree'
import { useCreatePage, useDeletePage } from './usePageMutations'

interface PageTreeItemProps {
  node: PageNode
  depth: number
  expanded: Set<string>
  onToggle: (id: string) => void
}

export default function PageTreeItem({
  node,
  depth,
  expanded,
  onToggle,
}: PageTreeItemProps) {
  const { id: activeId } = useParams()
  const navigate = useNavigate()
  const createPage = useCreatePage()
  const deletePage = useDeletePage()
  const isExpanded = expanded.has(node.id)
  const isActive = activeId === node.id

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
    <div>
      <div
        className={`tree-item${isActive ? ' tree-item-active' : ''}`}
        style={{ paddingLeft: 4 + (depth - 1) * 14 }}
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
          {depth < MAX_PAGE_DEPTH && (
            <button
              type="button"
              title="Добавить подстраницу"
              onClick={() => createPage.mutate(node.id)}
            >
              +
            </button>
          )}
          <button type="button" title="Удалить" onClick={handleDelete}>
            ×
          </button>
        </span>
      </div>
      {isExpanded &&
        node.children.map((child) => (
          <PageTreeItem
            key={child.id}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
          />
        ))}
    </div>
  )
}
