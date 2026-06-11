import { useCallback, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '../../components/toastContext'
import SpaceTree from './SpaceTree'
import { useCreatePage, useMovePage } from './usePageMutations'
import { useCreateTeamspace, usePersonalSpace } from '../teamspaces/useTeamspaces'
import TeamspaceSettingsModal from '../teamspaces/TeamspaceSettingsModal'
import { buildTree, MAX_PAGE_DEPTH, type PageNode } from './usePagesTree'
import {
  collectIds,
  computeDrop,
  findNode,
  nodeDepth,
  subtreeHeight,
  type TreeDragState,
} from './treeDnd'
import type { PageMeta, Teamspace } from '../../lib/types'

function expandedKey(spaceId: string): string {
  return `sidebar-expanded:${spaceId}`
}

function loadExpanded(spaceId: string): Set<string> {
  try {
    const raw = localStorage.getItem(expandedKey(spaceId))
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function saveExpanded(spaceId: string, next: Set<string>): Set<string> {
  localStorage.setItem(expandedKey(spaceId), JSON.stringify([...next]))
  return next
}

// Превью перетаскиваемой страницы: сама нода и раскрытые потомки,
// с отступами как в дереве (глубина — относительно перетаскиваемой)
function OverlayTree({
  node,
  depth,
  expanded,
}: {
  node: PageNode
  depth: number
  expanded: Set<string>
}) {
  return (
    <>
      <div className="tree-item" style={{ paddingLeft: 4 + depth * 14 }}>
        <span className="tree-toggle">
          {node.children.length > 0 ? (expanded.has(node.id) ? '▾' : '▸') : '·'}
        </span>
        <span className="tree-title">{node.title || 'Без названия'}</span>
      </div>
      {expanded.has(node.id) &&
        node.children.map((child) => (
          <OverlayTree key={child.id} node={child} depth={depth + 1} expanded={expanded} />
        ))}
    </>
  )
}

function SectionHeader({
  title,
  onAdd,
  onSettings,
}: {
  title: string
  onAdd: () => void
  onSettings?: () => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        color: 'var(--color-text-muted)',
        fontSize: 13,
        marginTop: 8,
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {title}
      </span>
      <span style={{ display: 'inline-flex', flexShrink: 0 }}>
        {onSettings && (
          <button type="button" title="Настройки" onClick={onSettings}>
            ⚙
          </button>
        )}
        <button type="button" title="Новая страница" onClick={onAdd}>
          +
        </button>
      </span>
    </div>
  )
}

interface SectionProps {
  spaceId: string
  expanded: Set<string>
  onToggle: (id: string) => void
  drag: TreeDragState | null
}

// Секция командного пространства с шестерёнкой и деревом
function TeamSpaceSection({
  space,
  onSettings,
  expanded,
  onToggle,
  drag,
}: { space: Teamspace; onSettings: () => void } & Omit<SectionProps, 'spaceId'>) {
  const createPage = useCreatePage(space.id)
  return (
    <>
      <SectionHeader
        title={space.name}
        onAdd={() => createPage.mutate(null)}
        onSettings={onSettings}
      />
      <SpaceTree spaceId={space.id} expanded={expanded} onToggle={onToggle} drag={drag} />
    </>
  )
}

// Секция личного пространства — без шестерёнки, заголовок фиксированный «Личное»
function PersonalSection({ spaceId, expanded, onToggle, drag }: SectionProps) {
  const createPage = useCreatePage(spaceId)
  return (
    <>
      <SectionHeader title="Личное" onAdd={() => createPage.mutate(null)} />
      <SpaceTree spaceId={spaceId} expanded={expanded} onToggle={onToggle} drag={drag} />
    </>
  )
}

export default function Sidebar() {
  const { personal, spaces } = usePersonalSpace()
  const queryClient = useQueryClient()
  const createSpace = useCreateTeamspace()
  const movePage = useMovePage()
  const toast = useToast()
  // Выбранный тимспейс для модалки настроек
  const [settingsSpaceId, setSettingsSpaceId] = useState<string | null>(null)
  // Раскрытые узлы по пространствам; заполняется лениво из localStorage
  const [expandedBySpace, setExpandedBySpace] = useState<Map<string, Set<string>>>(
    () => new Map(),
  )
  const [drag, setDrag] = useState<TreeDragState | null>(null)
  // Дистанция активации отличает клик (переход на страницу) от перетаскивания
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  // Только командные пространства — у личного нет настроек
  const teamSpaces = (spaces ?? []).filter((s) => s.kind === 'team')
  const settingsSpace = teamSpaces.find((s) => s.id === settingsSpaceId) ?? null

  // Раскрытые узлы пространства; лениво подтягиваем из localStorage
  const getExpanded = useCallback(
    (spaceId: string) => expandedBySpace.get(spaceId) ?? loadExpanded(spaceId),
    [expandedBySpace],
  )

  const toggle = useCallback((spaceId: string, id: string) => {
    setExpandedBySpace((prev) => {
      const current = prev.get(spaceId) ?? loadExpanded(spaceId)
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return new Map(prev).set(spaceId, saveExpanded(spaceId, next))
    })
  }, [])

  const expand = useCallback((spaceId: string, id: string) => {
    setExpandedBySpace((prev) => {
      const current = prev.get(spaceId) ?? loadExpanded(spaceId)
      if (current.has(id)) return prev
      const next = new Set(current).add(id)
      return new Map(prev).set(spaceId, saveExpanded(spaceId, next))
    })
  }, [])

  // Деревья всех смонтированных секций — из горячего query-кэша (без подписки).
  // Порядок вставки (личное, затем команды) важен: findNodeAcross берёт первое
  // совпадение, если страница на миг есть в двух кэшах после кросс-переноса.
  const collectTrees = useCallback((): Map<string, PageNode[]> => {
    const trees = new Map<string, PageNode[]>()
    const ids = [personal?.id, ...teamSpaces.map((s) => s.id)].filter(
      (id): id is string => !!id,
    )
    for (const id of ids) {
      const metas = queryClient.getQueryData<PageMeta[]>(['pages', id])
      if (metas) trees.set(id, buildTree(metas))
    }
    return trees
  }, [personal?.id, teamSpaces, queryClient])

  function handleDragStart(event: DragStartEvent) {
    const trees = collectTrees()
    const activeId = String(event.active.id)
    for (const [spaceId, tree] of trees) {
      const node = findNode(tree, activeId)
      if (node) {
        setDrag({
          activeId: node.id,
          sourceSpaceId: spaceId,
          invalidIds: collectIds(node),
          height: subtreeHeight(node),
        })
        return
      }
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const current = drag
    setDrag(null)
    if (!current || !event.over) return
    const trees = collectTrees()
    const expandedMap = new Map<string, Set<string>>()
    for (const spaceId of trees.keys()) expandedMap.set(spaceId, getExpanded(spaceId))
    const input = computeDrop(trees, current, expandedMap, String(event.over.id))
    if (!input) return

    // Лимит вложенности проверяем на дропе по ЦЕЛЕВОМУ дереву:
    // самая глубокая страница переносимого поддерева должна поместиться
    const targetTree = trees.get(input.targetSpaceId) ?? []
    const landingDepth = input.parentId
      ? (nodeDepth(targetTree, input.parentId) ?? 0) + 1
      : 1
    if (landingDepth + current.height - 1 > MAX_PAGE_DEPTH) {
      toast(`Лимит вложенности — ${MAX_PAGE_DEPTH} уровней`)
      return
    }

    movePage.mutate(input, {
      onError: () => toast('Не удалось перенести страницу'),
    })
    // раскрываем нового родителя, чтобы перенесённая страница была видна
    if (input.parentId) expand(input.targetSpaceId, input.parentId)
  }

  function handleCreateSpace() {
    const name = window.prompt('Название teamspace:')
    if (name?.trim()) createSpace.mutate(name.trim())
  }

  // Превью drag-overlay: ищем ноду и её expanded в исходном пространстве
  const overlay = (() => {
    if (!drag) return null
    const trees = collectTrees()
    const node = findNode(trees.get(drag.sourceSpaceId) ?? [], drag.activeId)
    if (!node) return null
    return { node, expanded: getExpanded(drag.sourceSpaceId) }
  })()

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDrag(null)}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
        }}
      >
        {/* Личное пространство рендерится только после загрузки */}
        {personal ? (
          <PersonalSection
            spaceId={personal.id}
            expanded={getExpanded(personal.id)}
            onToggle={(id) => toggle(personal.id, id)}
            drag={drag}
          />
        ) : (
          <span style={{ color: 'var(--color-text-muted)', fontSize: 13, marginTop: 8 }}>
            Загрузка…
          </span>
        )}
        {teamSpaces.map((space) => (
          <TeamSpaceSection
            key={space.id}
            space={space}
            onSettings={() => setSettingsSpaceId(space.id)}
            expanded={getExpanded(space.id)}
            onToggle={(id) => toggle(space.id, id)}
            drag={drag}
          />
        ))}
        <button type="button" className="ghost-button" onClick={handleCreateSpace}>
          + Новый teamspace
        </button>
        {settingsSpace && (
          <TeamspaceSettingsModal
            space={settingsSpace}
            onClose={() => setSettingsSpaceId(null)}
          />
        )}
      </div>
      <DragOverlay style={{ height: 'auto' }}>
        {overlay && (
          <div className="tree-drag-overlay">
            <OverlayTree node={overlay.node} depth={0} expanded={overlay.expanded} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
