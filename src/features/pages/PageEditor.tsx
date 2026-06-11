import { codeBlockOptions } from '@blocknote/code-block'
import type { Block } from '@blocknote/core'
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'

interface PageEditorProps {
  initialContent: Block[]
  onChange: (blocks: Block[]) => void
}

// Только рендер; сохранение — в useAutosave (PageView).
// Монтировать с key={pageId}: useCreateBlockNote не реактивен к initialContent.
export default function PageEditor({ initialContent, onChange }: PageEditorProps) {
  const editor = useCreateBlockNote({
    initialContent: initialContent.length > 0 ? initialContent : undefined,
    codeBlock: codeBlockOptions,
  })

  return (
    <BlockNoteView
      editor={editor}
      theme="light"
      onChange={() => onChange(editor.document)}
    />
  )
}
