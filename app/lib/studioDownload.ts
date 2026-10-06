'use client'

// app/lib/studioDownload.ts
/**
 * Saving a studio's output: one click-through-anchor, one zip.
 *
 * Sixteen call sites across the studios hand-rolled the same anchor, and four
 * of them hand-rolled the same JSZip assembly around it. The only thing that
 * differs between them is what goes in and what it is called.
 */
import JSZip from 'jszip'

/** One anchor click. `data:` and `blob:` URLs both work; nothing is kept. */
export function downloadUrl(href: string, filename: string): void {
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

/** Text as a file — a manifest, a report. JSON unless told otherwise. */
export function downloadText(text: string, filename: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  try {
    downloadUrl(url, filename)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export type ZipEntry = { name: string; dataUrl?: string; text?: string }

/**
 * A zip of data URLs and text. An entry that names neither, or whose data URL
 * carries no payload, is skipped: a half-filled studio still exports what it
 * has, which is what the four hand-written assemblies did.
 */
export async function downloadZip(filename: string, entries: ZipEntry[]): Promise<void> {
  const zip = new JSZip()
  for (const entry of entries) {
    if (typeof entry.text === 'string') {
      zip.file(entry.name, entry.text)
      continue
    }
    const base64 = entry.dataUrl?.split(',')[1]
    if (base64) zip.file(entry.name, base64, { base64: true })
  }
  const url = URL.createObjectURL(await zip.generateAsync({ type: 'blob' }))
  try {
    downloadUrl(url, filename)
  } finally {
    URL.revokeObjectURL(url)
  }
}
