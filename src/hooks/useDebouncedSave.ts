import { useCallback, useEffect, useRef } from 'react'

// Отложенное сохранение с гарантированным флашем на unmount и beforeunload —
// единственное место с этой логикой (используется автосейвом контента и заголовка).
export function useDebouncedSave<T>(
  save: (value: T) => void | Promise<void>,
  delay = 800,
) {
  const pending = useRef<{ value: T } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
  })

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (pending.current !== null) {
      const { value } = pending.current
      pending.current = null
      void saveRef.current(value)
    }
  }, [])

  const schedule = useCallback(
    (value: T) => {
      pending.current = { value }
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(flush, delay)
    },
    [delay, flush],
  )

  useEffect(() => {
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      flush()
    }
  }, [flush])

  return { schedule, flush }
}
