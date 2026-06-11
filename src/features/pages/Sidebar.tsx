import { useCallback, useState } from 'react'
import PageTreeItem from './PageTreeItem'
import { usePagesTree } from './usePagesTree'
import { useCreatePage } from './usePageMutations'

const EXPANDED_KEY = 'sidebar-expanded'

function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

export default function Sidebar() {
  const { tree, isLoading } = usePagesTree()
  const createPage = useCreatePage()
  const [expanded, setExpanded] = useState(loadExpanded)

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]))
      return next
    })
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minHeight: 0, overflowY: 'auto' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          color: 'var(--color-text-muted)',
          fontSize: 13,
        }}
      >
        <span>Страницы</span>
        <button
          type="button"
          title="Новая страница"
          onClick={() => createPage.mutate(null)}
        >
          +
        </button>
      </div>
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
          onToggle={toggle}
        />
      ))}
    </div>
  )
}
