import { positionAfterLast, positionBetween } from '../../lib/position'
import type { PageNode } from './usePagesTree'
import type { MovePageInput } from './usePageMutations'

// Чистая логика drag & drop дерева: зоны дропа и вычисление нового
// (parent_id, position). Рендер и dnd-kit — в Sidebar/PageTreeItem.

export type DropZone = 'before' | 'inside' | 'after'

// Дроп на пустое место под деревом — в конец корневого уровня пространства.
// Id зоны включает spaceId, так как зон root-end теперь много (по секциям).
export function rootEndId(spaceId: string): string {
  return `root-end:${spaceId}`
}

// Если overId — зона root-end, вернёт её spaceId, иначе null
export function parseRootEndId(overId: string): string | null {
  return overId.startsWith('root-end:') ? overId.slice('root-end:'.length) : null
}

export function zoneDropId(pageId: string, zone: DropZone): string {
  return `${pageId}:${zone}`
}

function splitDropId(overId: string): [string, DropZone] {
  const i = overId.lastIndexOf(':')
  return [overId.slice(0, i), overId.slice(i + 1) as DropZone]
}

// Состояние текущего перетаскивания, общее для всех строк дерева
export interface TreeDragState {
  activeId: string
  // пространство, из которого тащим — где искать source-дерево
  sourceSpaceId: string
  // сама нода и её потомки: внутрь них дроп запрещён
  invalidIds: Set<string>
  // высота переносимого поддерева — для проверки лимита глубины
  height: number
}

export function subtreeHeight(node: PageNode): number {
  return 1 + Math.max(0, ...node.children.map(subtreeHeight))
}

export function collectIds(
  node: PageNode,
  into = new Set<string>(),
): Set<string> {
  into.add(node.id)
  for (const child of node.children) collectIds(child, into)
  return into
}

// Глубина ноды (корень = 1); null, если нет в дереве
export function nodeDepth(
  tree: PageNode[],
  id: string,
  depth = 1,
): number | null {
  for (const node of tree) {
    if (node.id === id) return depth
    const found = nodeDepth(node.children, id, depth + 1)
    if (found !== null) return found
  }
  return null
}

// Визуальный отступ строки дерева: после 11 уровней не растёт,
// иначе глубокие страницы упираются в край сайдбара
export function treeIndent(depth: number): number {
  return 4 + (Math.min(depth, 11) - 1) * 14
}

export function findNode(
  tree: PageNode[],
  id: string,
): PageNode | undefined {
  for (const node of tree) {
    if (node.id === id) return node
    const found = findNode(node.children, id)
    if (found) return found
  }
  return undefined
}

// Поиск ноды по всем деревьям — вернёт ноду и spaceId её пространства
function findNodeAcross(
  trees: Map<string, PageNode[]>,
  id: string,
): { node: PageNode; spaceId: string } | undefined {
  for (const [spaceId, tree] of trees) {
    const node = findNode(tree, id)
    if (node) return { node, spaceId }
  }
  return undefined
}

// null — некорректный дроп. expanded нужен, чтобы «ниже развёрнутой страницы
// с детьми» означало «первым ребёнком», как в Notion: визуально линия там.
// Дроп может быть кросс-пространственным: target ищется по всем деревьям,
// его пространство — targetSpaceId. siblings/positions берутся из ЦЕЛЕВОГО
// дерева, фильтр active имеет смысл только при дропе в то же пространство.
export function computeDrop(
  trees: Map<string, PageNode[]>,
  drag: TreeDragState,
  expandedBySpace: Map<string, Set<string>>,
  overId: string,
): MovePageInput | null {
  const { activeId, sourceSpaceId } = drag
  const sourceTree = trees.get(sourceSpaceId) ?? []
  const active = findNode(sourceTree, activeId)
  if (!active) return null
  const base = {
    id: activeId,
    oldParentId: active.parent_id,
    title: active.title,
    sourceSpaceId,
  }

  const rootSpaceId = parseRootEndId(overId)
  if (rootSpaceId !== null) {
    const targetTree = trees.get(rootSpaceId) ?? []
    // фильтр active нужен только в исходном пространстве
    const roots =
      rootSpaceId === sourceSpaceId
        ? targetTree.filter((n) => n.id !== activeId)
        : targetTree
    return {
      ...base,
      targetSpaceId: rootSpaceId,
      parentId: null,
      position: positionAfterLast(roots),
    }
  }

  const [pageId, zone] = splitDropId(overId)
  const found = findNodeAcross(trees, pageId)
  if (!found || pageId === activeId) return null
  const { node: target, spaceId: targetSpaceId } = found
  const targetTree = trees.get(targetSpaceId) ?? []
  const sameSpace = targetSpaceId === sourceSpaceId
  // фильтр перетаскиваемой ноды нужен только при дропе в её же пространство
  const notActive = (c: PageNode) => !sameSpace || c.id !== activeId
  const targetExpanded = expandedBySpace.get(targetSpaceId) ?? new Set<string>()

  if (
    zone === 'after' &&
    targetExpanded.has(target.id) &&
    target.children.length > 0
  ) {
    const first = target.children.find(notActive)
    return {
      ...base,
      targetSpaceId,
      parentId: target.id,
      position: positionBetween(undefined, first?.position),
    }
  }

  if (zone === 'inside') {
    const children = target.children.filter(notActive)
    return {
      ...base,
      targetSpaceId,
      parentId: target.id,
      position: positionAfterLast(children),
    }
  }

  const siblings = (
    target.parent_id
      ? findNode(targetTree, target.parent_id)?.children ?? []
      : targetTree
  ).filter(notActive)
  const idx = siblings.findIndex((c) => c.id === target.id)
  const position =
    zone === 'before'
      ? positionBetween(siblings[idx - 1]?.position, target.position)
      : positionBetween(target.position, siblings[idx + 1]?.position)
  return { ...base, targetSpaceId, parentId: target.parent_id, position }
}
