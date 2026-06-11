import { signUp } from './api'
import AuthForm from './AuthForm'

export default function SignupPage() {
  return (
    <AuthForm
      title="Регистрация"
      submitLabel="Создать аккаунт"
      altLink={{ to: '/login', label: 'Уже есть аккаунт? Войти' }}
      onSubmit={signUp}
    />
  )
}
