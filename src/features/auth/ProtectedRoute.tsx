import { Navigate, Outlet } from 'react-router-dom'
import Spinner from '../../components/Spinner'
import { useAuth } from './useAuth'

export default function ProtectedRoute() {
  const { session, loading } = useAuth()
  if (loading) return <Spinner />
  if (!session) return <Navigate to="/login" replace />
  return <Outlet />
}
