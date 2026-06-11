import { BlockNoteEditor, type Block } from '@blocknote/core'
import { insertPages, type PageInsert } from '../pages/api'
import { MAX_PAGE_DEPTH } from '../pages/usePagesTree'
import type { NotionPageNode } from './parseNotionZip'
import { rewriteNotionLinks } from './rewriteNotionLinks'

export interface PagesImportReport {
  created: number
  flattened: number
  containerId: string
}

const CHUNK_SIZE = 50

interface QueueItem {
  node: NotionPageNode
  parentId: string
  // глубина, на которой страница будет создана (с учётом flatten)
  depth: number
  // id предка на глубине MAX-1: к нему прикрепляются слишком глубокие потомки
  anchorId: string
}

// Импорт дерева страниц уровень за уровнем, чанками. Всё дерево вешается на
// контейнер «Imported …» (занимает уровень 1), поэтому доступная глубина —
// MAX_PAGE_DEPTH - 1; более глубокие узлы прикрепляются к последнему
// допустимому предку (flatten), контент не теряется.
export async function importPages(
  nodes: NotionPageNode[],
  totalPages: number,
  onProgress: (done: number) => void,
  spaceId: string,
): Promise<PagesImportReport> {
  const editor = BlockNoteEditor.create()
  let created = 0
  let flattened = 0

  // id раздаются до вставки: ссылки между страницами переписываются в
  // /page/<id> ещё в markdown, до конвертации в блоки
  const idOf = new Map<NotionPageNode, string>()
  const idByPath = new Map<string, string>()
  const assignIds = (list: NotionPageNode[]) => {
    for (const node of list) {
      const id = crypto.randomUUID()
      idOf.set(node, id)
      idByPath.set(node.path.join('/'), id)
      assignIds(node.children)
    }
  }
  assignIds(nodes)

  const [container] = await insertPages([
    {
      parent_id: null,
      title: `Imported ${new Date().toLocaleDateString('ru-RU')}`,
      content: [],
      position: Date.now(),
      teamspace_id: spaceId,
    },
  ])

  let queue: QueueItem[] = nodes.map((node) => ({
    node,
    parentId: container.id,
    depth: 2,
    anchorId: container.id,
  }))

  while (queue.length > 0) {
    const nextQueue: QueueItem[] = []

    for (let i = 0; i < queue.length; i += CHUNK_SIZE) {
      const chunk = queue.slice(i, i + CHUNK_SIZE)
      const rows: PageInsert[] = []
      for (const [j, item] of chunk.entries()) {
        let content: Block[] = []
        if (item.node.markdown.trim()) {
          const markdown = rewriteNotionLinks(
            item.node.markdown,
            item.node.path.slice(0, -1),
            idByPath,
          )
          content = (await editor.tryParseMarkdownToBlocks(markdown)) as Block[]
        }
        rows.push({
          id: idOf.get(item.node),
          parent_id: item.parentId,
          title: item.node.title,
          content,
          position: j,
          teamspace_id: spaceId,
        })
      }

      const inserted = await insertPages(rows)
      created += inserted.length
      onProgress(Math.min(created, totalPages))

      for (const item of chunk) {
        const id = idOf.get(item.node)!
        // anchor — предок на предпоследней глубине: его дети ещё помещаются
        const anchorId = item.depth >= MAX_PAGE_DEPTH ? item.anchorId : id
        for (const child of item.node.children) {
          const fits = item.depth + 1 <= MAX_PAGE_DEPTH
          if (!fits) flattened++
          nextQueue.push({
            node: child,
            parentId: fits ? id : item.anchorId,
            depth: fits ? item.depth + 1 : MAX_PAGE_DEPTH,
            anchorId,
          })
        }
      }
    }

    queue = nextQueue
  }

  return { created, flattened, containerId: container.id }
}
