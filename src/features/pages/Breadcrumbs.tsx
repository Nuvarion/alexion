import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { getAncestry, usePagesTree } from './usePagesTree'

export default function Breadcrumbs({ pageId }: { pageId: string }) {
  const { metas } = usePagesTree()
  const chain = getAncestry(metas, pageId)
  if (chain.length === 0) return null

  return (
    <nav style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 8 }}>
      <Link to="/">Главная</Link>
      {chain.map((page, i) => (
        <Fragment key={page.id}>
          {' / '}
          {i === chain.length - 1 ? (
            <span>{page.title || 'Без названия'}</span>
          ) : (
            <Link to={`/page/${page.id}`}>{page.title || 'Без названия'}</Link>
          )}
        </Fragment>
      ))}
    </nav>
  )
}
