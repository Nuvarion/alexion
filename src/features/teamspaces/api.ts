import { supabase } from '../../lib/supabase'
import type { Teamspace, TeamspaceMember } from '../../lib/types'

// kind добавлен в миграции 0005
const SPACE_COLUMNS = 'id, name, owner_id, kind'
const MEMBER_COLUMNS = 'teamspace_id, email, user_id, role'

export async function fetchTeamspaces(): Promise<Teamspace[]> {
  const { data, error } = await supabase
    .from('teamspaces')
    .select(SPACE_COLUMNS)
    .order('created_at')
  if (error) throw error
  return data
}

export async function fetchMembers(spaceId: string): Promise<TeamspaceMember[]> {
  const { data, error } = await supabase
    .from('teamspace_members')
    .select(MEMBER_COLUMNS)
    .eq('teamspace_id', spaceId)
    .order('created_at')
  if (error) throw error
  // role в БД — text с check-constraint; Supabase выводит просто string
  return data as TeamspaceMember[]
}

export async function createTeamspace(name: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_teamspace', { space_name: name })
  if (error) throw error
  return data as string
}

// и «удалить участника» (владелец), и «покинуть» (сам участник)
export async function removeMember(spaceId: string, email: string): Promise<void> {
  const { error } = await supabase
    .from('teamspace_members')
    .delete()
    .match({ teamspace_id: spaceId, email })
  if (error) throw error
}

export async function renameTeamspace(id: string, name: string): Promise<void> {
  const { error } = await supabase.from('teamspaces').update({ name }).eq('id', id)
  if (error) throw error
}

export async function deleteTeamspace(id: string): Promise<void> {
  const { error } = await supabase.from('teamspaces').delete().eq('id', id)
  if (error) throw error
}

export async function fetchInviteToken(spaceId: string): Promise<string> {
  const { data, error } = await supabase
    .from('teamspace_invites')
    .select('token')
    .eq('teamspace_id', spaceId)
    .single()
  if (error) throw error
  return data.token
}

// Сброс отзывает старую ссылку: новый токен генерируется на клиенте
export async function resetInviteToken(spaceId: string): Promise<string> {
  const token = crypto.randomUUID()
  const { error } = await supabase
    .from('teamspace_invites')
    .update({ token })
    .eq('teamspace_id', spaceId)
  if (error) throw error
  return token
}

export async function acceptInvite(token: string): Promise<string> {
  const { data, error } = await supabase.rpc('accept_invite', { invite_token: token })
  if (error) throw error
  return data as string
}
