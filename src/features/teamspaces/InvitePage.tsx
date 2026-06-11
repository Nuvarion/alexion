import { useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import Spinner from '../../components/Spinner'
import { useToast } from '../../components/toastContext'
import { useAuth } from '../auth/useAuth'
import { acceptInvite } from './api'
import { PENDING_INVITE_KEY } from './pendingInvite'

// Точка входа по ссылке-приглашению. Незалогиненный уходит на регистрацию,
// токен ждёт в localStorage и применяется в AppLayout после входа.
export default function InvitePage() {
  const { token } = useParams<{ token: string }>()
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const started = useRef(false)

  useEffect(() => {
    if (loading || !token || started.current) return
    started.current = true

    if (!session) {
      localStorage.setItem(PENDING_INVITE_KEY, token)
      navigate('/signup', { replace: true })
      return
    }
    acceptInvite(token)
      .then(async () => {
        await queryClient.invalidateQueries({ queryKey: ['teamspaces'] })
        toast('Вы присоединились к teamspace')
      })
      .catch(() => toast('Ссылка-приглашение недействительна'))
      .finally(() => navigate('/', { replace: true }))
  }, [loading, session, token, navigate, queryClient, toast])

  return <Spinner />
}
