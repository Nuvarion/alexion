import { useCallback, useRef, useState } from 'react'
import { ToastContext } from './toastContext'

// Минимальные тосты: одно сообщение, автоскрытие. Без библиотек — проекту
// хватает уведомлений вида «лимит вложенности превышен».

const TOAST_MS = 3500

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback((next: string) => {
    setMessage(next)
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(null), TOAST_MS)
  }, [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </ToastContext.Provider>
  )
}
