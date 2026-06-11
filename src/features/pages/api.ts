import type { Block } from '@blocknote/core'
import { supabase } from '../../lib/supabase'
import type { Page, PageMeta } from '../../lib/types'

const META_COLUMNS = 'id, parent_id, title, position'

export async function fetchPageMetas(): Promise<PageMeta[]> {
  const { data, error } = await supabase
    .from('pages')
    .select(META_COLUMNS)
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
): Promise<PageMeta> {
  const { data, error } = await supabase
    .from('pages')
    .insert({ parent_id: parentId, position, title: '' })
    .select(META_COLUMNS)
    .single()
  if (error) throw error
  return data
}

export interface PageInsert {
  parent_id: string | null
  title: string
  content: Block[]
  position: number
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

export async function deletePage(id: string): Promise<void> {
  const { error } = await supabase.from('pages').delete().eq('id', id)
  if (error) throw error
}
