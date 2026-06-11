import JSZip from 'jszip'

// Чистый разбор экспорта Notion (Markdown & CSV): File -> дерево страниц + CSV.
// Без сети — персистенция в importPages.ts / importTasksCsv.ts.

export interface NotionPageNode {
  title: string
  markdown: string
  // Путь страницы в архиве (сегменты без hex-суффиксов) — для резолва
  // внутренних ссылок Notion при импорте
  path: string[]
  children: NotionPageNode[]
}

export interface NotionCsvFile {
  path: string
  name: string
  text: string
}

export interface NotionParseResult {
  pages: NotionPageNode[]
  csvFiles: NotionCsvFile[]
  skippedFiles: number
}

// Notion добавляет к именам 32-символьный hex-суффикс: "Page Name 0123...ef"
const HASH_SUFFIX = /\s+[0-9a-f]{32}$/i

export function stripNotionHash(segment: string): string {
  return segment.replace(HASH_SUFFIX, '').trim()
}

interface RawNode {
  title: string
  markdown: string
  children: Map<string, RawNode>
}

// Ключ — имя без hex-суффикса: в новом формате экспорта папка идёт без
// суффикса ("Личное/"), а md-файл с ним ("Личное 2146...a3.md"), и это
// одна и та же страница.
function ensureNode(
  root: Map<string, RawNode>,
  segments: string[],
): RawNode {
  let level = root
  let node: RawNode | undefined
  for (const segment of segments) {
    const key = stripNotionHash(segment)
    node = level.get(key)
    if (!node) {
      node = { title: key, markdown: '', children: new Map() }
      level.set(key, node)
    }
    level = node.children
  }
  return node!
}

function toPageNodes(
  level: Map<string, RawNode>,
  parentPath: string[] = [],
): NotionPageNode[] {
  return [...level.entries()].map(([key, raw]) => {
    const path = [...parentPath, key]
    return {
      title: raw.title,
      markdown: raw.markdown,
      path,
      children: toPageNodes(raw.children, path),
    }
  })
}

// Экспорт бывает обёрнут в одну корневую папку ("Export-<uuid>/...") —
// срезаем общие обёртки, пока на уровне нет файлов.
function unwrapRoot(paths: { path: string; segments: string[] }[]): void {
  for (;;) {
    const tops = new Set(paths.map((p) => p.segments[0]))
    const hasTopLevelFiles = paths.some((p) => p.segments.length === 1)
    if (tops.size !== 1 || hasTopLevelFiles) return
    for (const p of paths) p.segments.shift()
  }
}

// Экспорт Notion может быть многотомным: внешний zip содержит
// ExportBlock-...-Part-N.zip, а контент лежит внутри частей.
async function collectFileEntries(
  zip: JSZip,
  out: JSZip.JSZipObject[],
  depth: number,
): Promise<void> {
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue
    if (entry.name.toLowerCase().endsWith('.zip') && depth < 2) {
      const nested = await JSZip.loadAsync(await entry.async('arraybuffer'))
      await collectFileEntries(nested, out, depth + 1)
    } else {
      out.push(entry)
    }
  }
}

export async function parseNotionZip(file: File): Promise<NotionParseResult> {
  const zip = await JSZip.loadAsync(file)

  const entries: JSZip.JSZipObject[] = []
  await collectFileEntries(zip, entries, 0)
  const paths = entries.map((entry) => ({
    entry,
    path: entry.name,
    segments: entry.name.split('/').filter(Boolean),
  }))
  unwrapRoot(paths)

  const root = new Map<string, RawNode>()
  const csvFiles: NotionCsvFile[] = []
  let skippedFiles = 0

  for (const { entry, path, segments } of paths) {
    if (segments.length === 0) continue
    const fileName = segments[segments.length - 1]

    if (fileName.toLowerCase().endsWith('.md')) {
      const pageSegments = [
        ...segments.slice(0, -1),
        fileName.replace(/\.md$/i, ''),
      ]
      const node = ensureNode(root, pageSegments)
      const markdown = await entry.async('string')
      // Две одноимённые страницы на одном уровне склеиваем, а не теряем
      node.markdown = node.markdown ? `${node.markdown}\n\n---\n\n${markdown}` : markdown
    } else if (fileName.toLowerCase().endsWith('.csv')) {
      csvFiles.push({
        path,
        name: stripNotionHash(fileName.replace(/\.csv$/i, '')),
        text: await entry.async('string'),
      })
    } else {
      // вложения (картинки и т.п.) в MVP не импортируются
      skippedFiles++
    }
  }

  return { pages: toPageNodes(root), csvFiles, skippedFiles }
}

export function countPages(nodes: NotionPageNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countPages(n.children), 0)
}
