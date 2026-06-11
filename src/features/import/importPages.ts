import { BlockNoteEditor, type Block } from '@blocknote/core'
import { insertPages, type PageInsert } from '../pages/api'
import { MAX_PAGE_DEPTH } from '../pages/usePagesTree'
import type { NotionPageNode } from './parseNotionZip'

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
): Promise<PagesImportReport> {
  const editor = BlockNoteEditor.create()
  let created = 0
  let flattened = 0

  const [container] = await insertPages([
    {
      parent_id: null,
      title: `Imported ${new Date().toLocaleDateString('ru-RU')}`,
      content: [],
      position: Date.now(),
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
          content = (await editor.tryParseMarkdownToBlocks(
            item.node.markdown,
          )) as Block[]
        }
        rows.push({
          parent_id: item.parentId,
          title: item.node.title,
          content,
          position: j,
        })
      }

      const inserted = await insertPages(rows)
      created += inserted.length
      onProgress(Math.min(created, totalPages))

      for (const [j, item] of chunk.entries()) {
        const meta = inserted[j]
        // anchor — предок на предпоследней глубине: его дети ещё помещаются
        const anchorId = item.depth >= MAX_PAGE_DEPTH ? item.anchorId : meta.id
        for (const child of item.node.children) {
          const fits = item.depth + 1 <= MAX_PAGE_DEPTH
          if (!fits) flattened++
          nextQueue.push({
            node: child,
            parentId: fits ? meta.id : item.anchorId,
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
