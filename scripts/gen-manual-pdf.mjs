/**
 * Regenerate `docs/user-manual/manual-{id,nl}.pdf` from the current
 * Markdown. The `.md` files are the source of truth; run this whenever a
 * UI change lands (per the standing "update the bilingual user manual"
 * rule) so the committed PDFs do not drift.
 *
 *   node scripts/gen-manual-pdf.mjs [repo-root]   # default: cwd
 *
 * Needs `@playwright/test` (already a devDependency) and reaches for
 * `marked` via `npx --yes` for the Markdown → HTML step. Brand: primary
 * #0d50a0, gold accent #c8a415, PPME logo on the cover, a "PPME DEN
 * HAAG" running header (matches commit 60e60f7's intent). Screenshots
 * are inlined and down-scaled to ~380px JPEG so the PDF stays ~1 MB;
 * a screen with no screenshot yet (its `<img>` file missing) is skipped
 * and reported.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const ROOT = resolve(process.argv[2] ?? '.')
const MANUAL_DIR = resolve(ROOT, 'docs/user-manual')
const LOGO = 'data:image/png;base64,' + readFileSync(resolve(ROOT, 'public/logo.png')).toString('base64')

const PRIMARY = '#0d50a0'
const ACCENT = '#c8a415'

// Downscale a screenshot to ~460px wide JPEG (retina mobile shots are
// 1170px+; the manual displays them at ~360px) so the PDF stays a couple
// of MB rather than ~9. Runs in a throwaway chromium page.
async function shrink(browser, pngBuffer) {
  const p = await browser.newPage()
  const src = 'data:image/png;base64,' + pngBuffer.toString('base64')
  const out = await p.evaluate(
    (src) =>
      new Promise((res) => {
        const img = new Image()
        img.onload = () => {
          const w = Math.min(380, img.naturalWidth)
          const c = document.createElement('canvas')
          c.width = w
          c.height = Math.round((img.naturalHeight / img.naturalWidth) * w)
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
          res(c.toDataURL('image/jpeg', 0.72))
        }
        img.src = src
      }),
    src,
  )
  await p.close()
  return out
}

async function mdToHtml(browser, mdPath) {
  const raw = execFileSync('npx', ['--yes', 'marked', '--gfm', '-i', mdPath], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  let missing = 0
  const parts = []
  let last = 0
  const re = /<img [^>]*src="\.\/(screenshots\/[^"]+)"[^>]*>/g
  let m
  while ((m = re.exec(raw))) {
    parts.push(raw.slice(last, m.index))
    last = m.index + m[0].length
    const f = resolve(MANUAL_DIR, m[1])
    if (!existsSync(f)) {
      missing++
      continue // drop the <img> for a not-yet-captured screen
    }
    const uri = await shrink(browser, readFileSync(f))
    parts.push(m[0].replace(/src="\.\/screenshots\/[^"]+"/, `src="${uri}"`))
  }
  parts.push(raw.slice(last))
  if (missing) console.log(`  (${missing} screenshot(s) not yet captured — img dropped)`)
  return parts.join('')
}

function page(locale, bodyHtml) {
  const title = locale === 'nl' ? 'Gebruikershandleiding TPA PPME Den Haag' : 'Panduan Pengguna Aplikasi TPA PPME Den Haag'
  const langLine = locale === 'nl' ? 'Nederlands' : 'Bahasa Indonesia'
  const dateStr = new Date().toLocaleDateString(locale === 'nl' ? 'nl-NL' : 'id-ID', {
    year: 'numeric',
    month: 'long',
  })
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font: 10.5pt/1.55 "Helvetica Neue", Arial, "Noto Sans", sans-serif; color: #1a1a1a; margin: 0; }
  h1, h2, h3, h4 { color: ${PRIMARY}; font-weight: 700; line-height: 1.25; }
  h1 { font-size: 20pt; margin: 1.6em 0 .6em; }
  h2 { font-size: 15pt; margin: 1.5em 0 .5em; padding-bottom: .2em; border-bottom: 2px solid ${ACCENT}; }
  h3 { font-size: 12pt; margin: 1.3em 0 .4em; }
  h4 { font-size: 10.5pt; margin: 1.1em 0 .3em; }
  p { margin: .5em 0; }
  a { color: ${PRIMARY}; text-decoration: none; }
  code { background: #f2f4f7; border-radius: 3px; padding: .1em .35em; font-size: 9pt;
         font-family: "SFMono-Regular", Consolas, monospace; }
  ul, ol { margin: .5em 0; padding-left: 1.4em; }
  li { margin: .25em 0; }
  blockquote { margin: .8em 0; padding: .4em .9em; border-left: 3px solid ${ACCENT};
               background: #fbf7e8; color: #4a4a4a; }
  hr { border: 0; border-top: 1px solid #dcdcdc; margin: 1.6em 0; }
  table { border-collapse: collapse; width: 100%; margin: .8em 0; font-size: 9.5pt;
          page-break-inside: auto; }
  thead { background: ${PRIMARY}; color: #fff; }
  th, td { border: 1px solid #d0d5dd; padding: .4em .55em; text-align: left; vertical-align: top; }
  tbody tr:nth-child(even) { background: #f6f8fb; }
  tr, img { page-break-inside: avoid; }
  img { width: 74mm; max-width: 100%; height: auto; display: block; margin: .6em auto; border: 1px solid #e4e4e4; border-radius: 6px; }
  h2, h3 { page-break-after: avoid; }
  .cover { text-align: center; padding-top: 32vh; page-break-after: always; }
  .cover img { width: 220px; margin: 0 auto 2.4em; border: 0; }
  .cover .t { font-size: 21pt; font-weight: 700; color: ${PRIMARY}; margin-bottom: .5em; }
  .cover .l { font-size: 12pt; color: ${ACCENT}; font-weight: 600; }
  .cover .d { font-size: 10pt; color: #777; margin-top: 3em; }
  /* the first body h1 duplicates the cover title */
  .body > h1:first-child { display: none; }
  .body > p:first-of-type { color: #555; font-style: italic; }
</style></head><body>
  <div class="cover">
    <img src="${LOGO}" alt="PPME">
    <div class="t">${title}</div>
    <div class="l">${langLine}</div>
    <div class="d">${dateStr}</div>
  </div>
  <div class="body">${bodyHtml}</div>
</body></html>`
}

const headerFor = (title) => `<div style="width:100%;padding:0 15mm;font-size:7pt;
  display:flex;justify-content:space-between;align-items:center;">
  <span style="color:${PRIMARY};font-weight:700;letter-spacing:.04em;">PPME DEN HAAG</span>
  <span style="color:#9aa4b2;">${title}</span></div>`
const FOOTER = `<div style="width:100%;padding:0 15mm;font-size:7pt;color:#9aa4b2;text-align:center;">
  <span class="pageNumber"></span> / <span class="totalPages"></span></div>`

const browser = await chromium.launch()
for (const locale of ['id', 'nl']) {
  const mdPath = resolve(MANUAL_DIR, `manual-${locale}.md`)
  const outPath = resolve(MANUAL_DIR, `manual-${locale}.pdf`)
  const title = locale === 'nl' ? 'Gebruikershandleiding TPA PPME Den Haag' : 'Panduan Pengguna Aplikasi TPA PPME Den Haag'
  const html = page(locale, await mdToHtml(browser, mdPath))
  const p = await browser.newPage()
  await p.setContent(html, { waitUntil: 'networkidle' })
  await p.pdf({
    path: outPath,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: headerFor(title),
    footerTemplate: FOOTER,
    margin: { top: '20mm', bottom: '16mm', left: '15mm', right: '15mm' },
  })
  await p.close()
  console.log(`wrote ${outPath}`)
}
await browser.close()
