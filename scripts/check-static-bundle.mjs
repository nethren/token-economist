import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../dist/', import.meta.url))
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.map', '.svg', '.txt'])
const denied = [
  /api\.anthropic\.com/i,
  /api\.openai\.com/i,
  /generativelanguage\.googleapis\.com/i,
  /ANTHROPIC_API_KEY/,
  /OPENAI_API_KEY/,
  /GEMINI_API_KEY/,
  /dangerouslyAllowBrowser/,
  /sk-ant-[A-Za-z0-9_-]{8,}/,
  /sk-proj-[A-Za-z0-9_-]{8,}/,
]

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await filesUnder(path))
    else if (entry.isFile() && textExtensions.has(extname(entry.name))) files.push(path)
  }
  return files
}

const matches = []
for (const path of await filesUnder(root)) {
  const contents = await readFile(path, 'utf8')
  if (denied.some((pattern) => pattern.test(contents))) {
    matches.push(relative(root, path))
  }
}

// The production CSP allows fonts only from 'self' (vercel.json), so a font
// inlined as a data: URI would be blocked in the browser.
const inlinedFonts = []
for (const path of await filesUnder(root)) {
  if (extname(path) !== '.css') continue
  if (/data:font\//.test(await readFile(path, 'utf8'))) inlinedFonts.push(relative(root, path))
}
if (inlinedFonts.length > 0) {
  console.error(`Fonts inlined as data: URIs would be blocked by the CSP: ${inlinedFonts.join(', ')}`)
  process.exit(1)
}

if (matches.length > 0) {
  console.error(`Static bundle contains a paid-provider client surface: ${matches.join(', ')}`)
  process.exit(1)
}

console.log('Static bundle check passed: no paid-provider client surface found.')
