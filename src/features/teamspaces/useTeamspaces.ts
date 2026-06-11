import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createTeamspace,
  deleteTeamspace,
  fetchInviteToken,
  fetchMembers,
  fetchTeamspaces,
  removeMember,
  renameTeamspace,
  resetInviteToken,
} from './api'

export function useTeamspaces() {
  return useQuery({ queryKey: ['teamspaces'], queryFn: fetchTeamspaces })
}

// Личный workspace пользователя; undefined, пока список не загружен
export function usePersonalSpace() {
  const { data: spaces, ...rest } = useTeamspaces()
  return { personal: spaces?.find((s) => s.kind === 'personal'), spaces, ...rest }
}

export function useMembers(spaceId: string) {
  return useQuery({
    queryKey: ['teamspace-members', spaceId],
    queryFn: () => fetchMembers(spaceId),
  })
}

function useInvalidateSpaces() {
  const queryClient = useQueryClient()
  return (spaceId?: string) => {
    void queryClient.invalidateQueries({ queryKey: ['teamspaces'] })
    if (spaceId) {
      void queryClient.invalidateQueries({ queryKey: ['teamspace-members', spaceId] })
    }
  }
}

export function useCreateTeamspace() {
  const invalidate = useInvalidateSpaces()
  return useMutation({
    mutationFn: (name: string) => createTeamspace(name),
    onSuccess: () => invalidate(),
  })
}

export function useRemoveMember() {
  const invalidate = useInvalidateSpaces()
  return useMutation({
    mutationFn: ({ spaceId, email }: { spaceId: string; email: string }) =>
      removeMember(spaceId, email),
    onSuccess: (_d, { spaceId }) => invalidate(spaceId),
  })
}

export function useRenameTeamspace() {
  const invalidate = useInvalidateSpaces()
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameTeamspace(id, name),
    onSuccess: () => invalidate(),
  })
}

export function useDeleteTeamspace() {
  const invalidate = useInvalidateSpaces()
  return useMutation({
    mutationFn: (id: string) => deleteTeamspace(id),
    onSuccess: () => invalidate(),
  })
}

export function useInviteToken(spaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['invite-token', spaceId],
    queryFn: () => fetchInviteToken(spaceId),
    enabled,
  })
}

export function useResetInviteToken() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (spaceId: string) => resetInviteToken(spaceId),
    onSuccess: (token, spaceId) =>
      queryClient.setQueryData(['invite-token', spaceId], token),
  })
}
