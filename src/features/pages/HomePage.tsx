import { Link } from 'react-router-dom'
import Spinner from '../../components/Spinner'
import { usePagesTree } from './usePagesTree'
import { useCreatePage } from './usePageMutations'

export default function HomePage() {
  const { tree, isLoading, isError } = usePagesTree()
  const createPage = useCreatePage()

  if (isLoading) return <Spinner />
  if (isError) {
    return (
      <p style={{ padding: 32, color: 'var(--color-danger)' }}>
        Не удалось загрузить страницы. Проверь соединение и обнови страницу.
      </p>
    )
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 32 }}>
      <h1>Мои страницы</h1>
      {tree.length === 0 && (
        <p style={{ color: 'var(--color-text-muted)' }}>
          Пока нет ни одной страницы — создай первую.
        </p>
      )}
      <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {tree.map((page) => (
          <li key={page.id}>
            <Link to={`/page/${page.id}`} className="page-card">
              📄 {page.title || 'Без названия'}
            </Link>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => createPage.mutate(null)}>
        + Новая страница
      </button>
    </div>
  )
}
