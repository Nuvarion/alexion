import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { PageMeta } from '../../lib/types'
import { fetchPageMetas } from './api'

export const MAX_PAGE_DEPTH = 10

export interface PageNode extends PageMeta {
  children: PageNode[]
}

export function buildTree(metas: PageMeta[]): PageNode[] {
  const nodes = new Map<string, PageNode>()
  for (const meta of metas) nodes.set(meta.id, { ...meta, children: [] })
  const roots: PageNode[] = []
  for (const node of nodes.values()) {
    const parent = node.parent_id ? nodes.get(node.parent_id) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const byPosition = (a: PageNode, b: PageNode) => a.position - b.position
  for (const node of nodes.values()) node.children.sort(byPosition)
  roots.sort(byPosition)
  return roots
}

// Цепочка предков от корня до страницы включительно (для хлебных крошек).
export function getAncestry(metas: PageMeta[], id: string): PageMeta[] {
  const byId = new Map(metas.map((m) => [m.id, m]))
  const chain: PageMeta[] = []
  let current = byId.get(id)
  while (current && chain.length <= MAX_PAGE_DEPTH) {
    chain.unshift(current)
    current = current.parent_id ? byId.get(current.parent_id) : undefined
  }
  return chain
}

export function usePagesTree() {
  const query = useQuery({ queryKey: ['pages'], queryFn: fetchPageMetas })
  const tree = useMemo(() => buildTree(query.data ?? []), [query.data])
  return { ...query, tree, metas: query.data ?? [] }
}
