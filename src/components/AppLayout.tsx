import { NavLink, Outlet } from 'react-router-dom'
import { signOut } from '../features/auth/api'
import Sidebar from '../features/pages/Sidebar'

export default function AppLayout() {
  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <aside
        style={{
          width: 260,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          background: 'var(--color-bg-sidebar)',
          borderRight: '1px solid var(--color-border)',
          padding: 12,
          overflow: 'hidden',
        }}
      >
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <NavLink to="/" className="nav-link" end>
            🏠 Главная
          </NavLink>
          <NavLink to="/tasks" className="nav-link">
            ✓ Задачи
          </NavLink>
          <NavLink to="/import" className="nav-link">
            ⤓ Импорт
          </NavLink>
        </nav>
        <Sidebar />
        <button type="button" className="ghost-button" onClick={() => void signOut()}>
          Выйти
        </button>
      </aside>
      <main style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
        <Outlet />
      </main>
    </div>
  )
}
