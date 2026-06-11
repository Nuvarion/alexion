import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import type { Page } from '../../lib/types'

// Подписка на изменения pages/tasks тимспейсов: чужие правки инвалидируют
// списки без перезагрузки. Личное пространство не подписываем — там один
// пользователь. Контент открытой страницы подтянется через ['page', id].
//
// Ограничение: при очень больших страницах realtime может урезать payload —
// тогда сравнение контента не сработает и автор может поймать ремаунт; для v1 приемлемо.
export function useSpaceRealtime(spaceIds: string[]) {
  const queryClient = useQueryClient()
  // Стабильный ключ: сортируем, чтобы порядок не влиял на пересоздание канала
  const key = spaceIds.slice().sort().join(',')

  useEffect(() => {
    if (!key) return

    const channel = supabase.channel('teamspace-changes')

    for (const spaceId of key.split(',')) {
      // Инвалидируем список страниц; для UPDATE сравниваем с кэшем, чтобы
      // не пересоздавать редактор у автора при эхо собственного автосейва.
      channel.on<Record<string, unknown>>(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pages', filter: `teamspace_id=eq.${spaceId}` },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          void queryClient.invalidateQueries({ queryKey: ['pages', spaceId] })

          if (payload.eventType === 'DELETE') {
            const old = payload.old as { id?: string } | null
            // Открытый PageView удалённой страницы покажет «не найдена»
            if (old?.id) void queryClient.invalidateQueries({ queryKey: ['page', old.id] })
            return
          }
          if (payload.eventType !== 'UPDATE') return // INSERT: контент ещё никто не открыл

          const row = payload.new as { id?: string; title?: string; content?: unknown } | null
          if (!row?.id) return
          const cached = queryClient.getQueryData<Page>(['page', row.id])
          // Эхо собственного сохранения: кэш уже содержит эти данные — не трогаем,
          // иначе рефетч сменит dataUpdatedAt и PageView ремаунтит редактор
          // у автора прямо во время набора. Чужая правка кэшу не равна — инвалидируем,
          // наблюдатель получит свежий контент (ремаунт по dataUpdatedAt).
          if (
            cached &&
            row.content !== undefined &&
            cached.title === row.title &&
            JSON.stringify(cached.content) === JSON.stringify(row.content)
          ) {
            return
          }
          void queryClient.invalidateQueries({ queryKey: ['page', row.id] })
        },
      )

      // Инвалидируем список задач тимспейса
      channel.on<Record<string, unknown>>(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `teamspace_id=eq.${spaceId}` },
        () => void queryClient.invalidateQueries({ queryKey: ['tasks', spaceId] }),
      )
    }

    channel.subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [key, queryClient])
}
