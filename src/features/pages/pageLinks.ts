import type { Block } from '@blocknote/core'

// Операции над ссылками на страницы (/page/<id>) внутри контента BlockNote.
// Используются при переносе страницы в дереве: ссылка «переезжает» из
// контента старого родителя в контент нового.

function isPageLink(item: unknown, pageId: string): boolean {
  if (typeof item !== 'object' || item === null) return false
  const link = item as { type?: string; href?: string }
  return (
    link.type === 'link' &&
    typeof link.href === 'string' &&
    new RegExp(`/page/${pageId}$`, 'i').test(link.href.split('?')[0])
  )
}

export function hasPageLink(blocks: Block[], pageId: string): boolean {
  return blocks.some((block) => {
    if (Array.isArray(block.content) && block.content.some((i) => isPageLink(i, pageId))) {
      return true
    }
    return hasPageLink(block.children ?? [], pageId)
  })
}

// Убирает все inline-ссылки на страницу. Абзац, опустевший после удаления
// (и без детей), выбрасывается целиком — после импорта из Notion ссылка
// обычно занимает абзац одна.
export function removePageLink(
  blocks: Block[],
  pageId: string,
): { blocks: Block[]; removed: boolean } {
  let removed = false

  const result = blocks.flatMap((block) => {
    let content = block.content
    let emptied = false
    if (Array.isArray(content)) {
      const filtered = content.filter((i) => !isPageLink(i, pageId))
      if (filtered.length !== content.length) {
        removed = true
        emptied = filtered.length === 0
        content = filtered as typeof block.content
      }
    }
    const children = removePageLink(block.children ?? [], pageId)
    if (children.removed) removed = true

    if (emptied && block.type === 'paragraph' && children.blocks.length === 0) {
      return []
    }
    return [{ ...block, content, children: children.blocks } as Block]
  })

  return { blocks: result, removed }
}

export function appendPageLink(
  blocks: Block[],
  pageId: string,
  title: string,
): Block[] {
  const paragraph = {
    id: crypto.randomUUID(),
    type: 'paragraph',
    props: {
      textColor: 'default',
      backgroundColor: 'default',
      textAlignment: 'left',
    },
    content: [
      {
        type: 'link',
        href: `/page/${pageId}`,
        content: [{ type: 'text', text: title || 'Без названия', styles: {} }],
      },
    ],
    children: [],
  } as unknown as Block
  return [...blocks, paragraph]
}
