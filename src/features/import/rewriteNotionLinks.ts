import { stripNotionHash } from './parseNotionZip'

// Внутренние ссылки Notion в markdown — относительные url-encoded пути к
// md-файлам: [Текст](Личное/Путешествия%20213663....md). Переписываем их в
// /page/<id> по карте «путь в архиве -> id будущей страницы»; что не
// резолвится (битые, внешние) — оставляем как есть.

const MD_LINK = /\]\(([^)]+)\)/g

export function rewriteNotionLinks(
  markdown: string,
  // путь папки страницы в архиве (node.path без последнего сегмента)
  baseDir: string[],
  idByPath: Map<string, string>,
): string {
  return markdown.replace(MD_LINK, (full, rawUrl: string) => {
    const id = resolveLink(rawUrl, baseDir, idByPath)
    return id ? `](/page/${id})` : full
  })
}

function resolveLink(
  rawUrl: string,
  baseDir: string[],
  idByPath: Map<string, string>,
): string | undefined {
  // внешние схемы (https:, mailto:), абсолютные пути и якоря не трогаем
  if (/^[a-z][a-z0-9+.-]*:/i.test(rawUrl)) return undefined
  if (rawUrl.startsWith('/') || rawUrl.startsWith('#')) return undefined

  let decoded: string
  try {
    decoded = decodeURIComponent(rawUrl)
  } catch {
    return undefined
  }
  if (!/\.md$/i.test(decoded)) return undefined

  const segments = [...baseDir]
  for (const part of decoded.replace(/\.md$/i, '').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      segments.pop()
      continue
    }
    segments.push(stripNotionHash(part))
  }
  return idByPath.get(segments.join('/'))
}
