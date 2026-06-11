import { useState } from 'react'
import { useAuth } from '../auth/useAuth'
import type { Teamspace } from '../../lib/types'
import { useToast } from '../../components/toastContext'
import {
  useDeleteTeamspace,
  useInviteToken,
  useMembers,
  useRemoveMember,
  useRenameTeamspace,
  useResetInviteToken,
} from './useTeamspaces'

interface Props {
  space: Teamspace
  onClose: () => void
}

export default function TeamspaceSettingsModal({ space, onClose }: Props) {
  const { session } = useAuth()
  const userId = session?.user.id
  const isOwner = userId === space.owner_id

  const { data: members } = useMembers(space.id)
  const { data: inviteToken, isError: inviteTokenError } = useInviteToken(space.id, isOwner)
  const resetInvite = useResetInviteToken()
  const toast = useToast()
  const remove = useRemoveMember()
  const rename = useRenameTeamspace()
  const deleteSpace = useDeleteTeamspace()
  const [name, setName] = useState(space.name)
  const [error, setError] = useState('')

  const inviteUrl = inviteToken
    ? `${window.location.origin}${import.meta.env.BASE_URL}invite/${inviteToken}`
    : ''

  function handleDeleteSpace() {
    if (!window.confirm('Удалить teamspace со всеми страницами и задачами?')) return
    setError('')
    deleteSpace.mutate(space.id, {
      onSuccess: onClose,
      onError: (e) => setError(e instanceof Error ? e.message : 'Не удалось удалить teamspace'),
    })
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Настройки teamspace</h2>

        <label style={{ display: 'block', fontSize: 13, color: 'var(--color-text-muted)' }}>
          Название
        </label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isOwner}
          />
          {isOwner && (
            <button
              type="button"
              onClick={() => {
                setError('')
                rename.mutate(
                  { id: space.id, name: name.trim() },
                  {
                    onError: (e) =>
                      setError(e instanceof Error ? e.message : 'Не удалось переименовать'),
                  },
                )
              }}
              disabled={!name.trim() || name.trim() === space.name || rename.isPending}
            >
              Сохранить
            </button>
          )}
        </div>

        <label style={{ display: 'block', fontSize: 13, color: 'var(--color-text-muted)' }}>
          Участники
        </label>
        <ul style={{ listStyle: 'none', padding: 0, margin: '4px 0 16px' }}>
          {(members ?? []).map((m) => (
            <li
              key={m.email}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '2px 0' }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {m.email}
                {m.role === 'owner' && ' · владелец'}
              </span>
              {m.role !== 'owner' && (isOwner || m.user_id === userId) && (
                <button
                  type="button"
                  title={
                    m.user_id === userId
                      ? 'Выйти из teamspace'
                      : 'Удалить участника'
                  }
                  onClick={() => {
                    const leaving = m.user_id === userId
                    if (leaving && !window.confirm('Выйти из teamspace?')) return
                    setError('')
                    remove.mutate(
                      { spaceId: space.id, email: m.email },
                      {
                        onSuccess: leaving ? onClose : undefined,
                        onError: (e) =>
                          setError(
                            e instanceof Error ? e.message : 'Не удалось удалить участника',
                          ),
                      },
                    )
                  }}
                >
                  {m.user_id === userId ? 'Покинуть' : '×'}
                </button>
              )}
            </li>
          ))}
        </ul>

        {error && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</p>}

        {isOwner && (
          <>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--color-text-muted)' }}>
              Ссылка-приглашение
            </label>
            {inviteTokenError && (
              <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>
                Не удалось загрузить ссылку-приглашение.
              </p>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <input readOnly value={inviteUrl} onFocus={(e) => e.target.select()} />
              <button
                type="button"
                disabled={!inviteUrl}
                onClick={() => {
                  void navigator.clipboard.writeText(inviteUrl)
                  toast('Ссылка скопирована')
                }}
              >
                Копировать
              </button>
              <button
                type="button"
                title="Старая ссылка перестанет действовать"
                disabled={resetInvite.isPending}
                onClick={() => {
                  if (!window.confirm('Сбросить ссылку? Старая перестанет действовать.')) return
                  resetInvite.mutate(space.id, {
                    onError: (e) => setError(e instanceof Error ? e.message : 'Не удалось сбросить'),
                  })
                }}
              >
                Сбросить
              </button>
            </div>
            <button
              type="button"
              style={{ color: 'var(--color-danger)', marginTop: 16 }}
              onClick={handleDeleteSpace}
              disabled={deleteSpace.isPending}
            >
              Удалить teamspace
            </button>
          </>
        )}
      </div>
    </div>
  )
}
