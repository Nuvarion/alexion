import { Route, Routes } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import { ToastProvider } from './components/toast'
import AuthProvider from './features/auth/AuthProvider'
import LoginPage from './features/auth/LoginPage'
import ProtectedRoute from './features/auth/ProtectedRoute'
import SignupPage from './features/auth/SignupPage'
import ImportPage from './features/import/ImportPage'
import KanbanPage from './features/kanban/KanbanPage'
import HomePage from './features/pages/HomePage'
import PageView from './features/pages/PageView'
import InvitePage from './features/teamspaces/InvitePage'

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/page/:id" element={<PageView />} />
            <Route path="/tasks" element={<KanbanPage />} />
            <Route path="/import" element={<ImportPage />} />
          </Route>
        </Route>
        </Routes>
      </ToastProvider>
    </AuthProvider>
  )
}
