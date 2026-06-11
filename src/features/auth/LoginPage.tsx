import { signIn } from './api'
import AuthForm from './AuthForm'

export default function LoginPage() {
  return (
    <AuthForm
      title="Вход"
      submitLabel="Войти"
      altLink={{ to: '/signup', label: 'Нет аккаунта? Зарегистрироваться' }}
      onSubmit={signIn}
    />
  )
}
