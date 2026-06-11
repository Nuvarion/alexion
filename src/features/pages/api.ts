import type { Block } from '@blocknote/core'
import { supabase } from '../../lib/supabase'
import type { Page, PageMeta } from '../../lib/types'

const META_COLUMNS = 'id, parent_id, title, position, teamspace_id'

// После миграции 0005 teamspace_id обязателен — всегда фильтруем по .eq
export async function fetchPageMetas(spaceId: string): Promise<PageMeta[]> {
  const { data, error } = await supabase
    .from('pages')
    .select(META_COLUMNS)
    .eq('teamspace_id', spaceId)
    .order('position')
  if (error) throw error
  return data
}

export async function fetchPage(id: string): Promise<Page> {
  const { data, error } = await supabase
    .from('pages')
    .select(`${META_COLUMNS}, content`)
    .eq('id', id)
    .single()
  if (error) throw error
  return data as Page
}

export async function createPage(
  parentId: string | null,
  position: number,
  spaceId: string,
): Promise<PageMeta> {
  const { data, error } = await supabase
    .from('pages')
    .insert({ parent_id: parentId, position, title: '', teamspace_id: spaceId })
    .select(META_COLUMNS)
    .single()
  if (error) throw error
  return data
}

export interface PageInsert {
  // id задаётся клиентом, когда нужно знать его до вставки (импорт: ссылки
  // между страницами переписываются до создания строк)
  id?: string
  parent_id: string | null
  title: string
  content: Block[]
  position: number
  // После миграции 0005 teamspace_id обязателен
  teamspace_id: string
}

// Пакетная вставка (используется импортом из Notion). PostgREST возвращает
// строки в порядке вставки — на этом строится привязка детей к родителям.
export async function insertPages(rows: PageInsert[]): Promise<PageMeta[]> {
  const { data, error } = await supabase
    .from('pages')
    .insert(rows)
    .select(META_COLUMNS)
  if (error) throw error
  return data
}

export async function updatePageTitle(id: string, title: string): Promise<void> {
  const { error } = await supabase.from('pages').update({ title }).eq('id', id)
  if (error) throw error
}

export async function updatePageContent(
  id: string,
  content: Block[],
): Promise<void> {
  const { error } = await supabase
    .from('pages')
    .update({ content })
    .eq('id', id)
  if (error) throw error
}

export async function movePage(
  id: string,
  parentId: string | null,
  position: number,
): Promise<void> {
  const { error } = await supabase
    .from('pages')
    .update({ parent_id: parentId, position })
    .eq('id', id)
  if (error) throw error
}

export async function deletePage(id: string): Promise<void> {
  const { error } = await supabase.from('pages').delete().eq('id', id)
  if (error) throw error
}

// Перенос страницы (со всем поддеревом) в другое пространство — RPC
// move_page_to_space сверяет членство, родителя, цикл и глубину на сервере.
export async function movePageToSpace(
  id: string,
  targetSpaceId: string,
  parentId: string | null,
  position: number,
): Promise<void> {
  const { error } = await supabase.rpc('move_page_to_space', {
    page_id: id,
    target_space_id: targetSpaceId,
    new_parent_id: parentId,
    new_position: position,
  })
  if (error) throw error
}
