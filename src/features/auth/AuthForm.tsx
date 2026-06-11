import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

interface AuthFormProps {
  title: string
  submitLabel: string
  altLink: { to: string; label: string }
  onSubmit: (email: string, password: string) => Promise<{ error: { message: string } | null }>
}

export default function AuthForm({ title, submitLabel, altLink, onSubmit }: AuthFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error } = await onSubmit(email, password)
    setSubmitting(false)
    if (error) {
      setError(error.message)
    } else {
      navigate('/')
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{ width: 320, display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <h1 style={{ fontSize: 22, margin: 0 }}>{title}</h1>
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
        <input
          type="password"
          required
          minLength={6}
          placeholder="Пароль"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        {error && <div style={{ color: 'var(--color-danger)', fontSize: 14 }}>{error}</div>}
        <button type="submit" disabled={submitting}>
          {submitting ? '…' : submitLabel}
        </button>
        <Link to={altLink.to} style={{ fontSize: 14 }}>
          {altLink.label}
        </Link>
      </form>
    </div>
  )
}
