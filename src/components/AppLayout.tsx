import { useEffect, useRef } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { signOut } from '../features/auth/api'
import Sidebar from '../features/pages/Sidebar'
import { acceptInvite } from '../features/teamspaces/api'
import { PENDING_INVITE_KEY } from '../features/teamspaces/pendingInvite'
import { useTeamspaces } from '../features/teamspaces/useTeamspaces'
import { useSpaceRealtime } from '../features/teamspaces/useSpaceRealtime'
import { useToast } from './toastContext'

export default function AppLayout() {
  // Подписываемся на realtime только для командных пространств:
  // личное — один пользователь, realtime там не нужен
  const { data: spaces } = useTeamspaces()
  useSpaceRealtime((spaces ?? []).filter((s) => s.kind === 'team').map((s) => s.id))

  const queryClient = useQueryClient()
  const toast = useToast()
  const inviteStarted = useRef(false)
  useEffect(() => {
    const token = localStorage.getItem(PENDING_INVITE_KEY)
    if (!token || inviteStarted.current) return
    inviteStarted.current = true
    acceptInvite(token)
      .then(async () => {
        localStorage.removeItem(PENDING_INVITE_KEY)
        await queryClient.invalidateQueries({ queryKey: ['teamspaces'] })
        toast('Вы присоединились к teamspace')
      })
      .catch((e) => {
        // Битый токен забываем; сетевую ошибку — нет: инвайт применится
        // при следующем входе в приложение
        if (e instanceof Error && e.message.includes('invalid invite')) {
          localStorage.removeItem(PENDING_INVITE_KEY)
          toast('Ссылка-приглашение недействительна')
        }
      })
  }, [queryClient, toast])

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
