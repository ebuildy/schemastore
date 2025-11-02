// @ts-check

/**
 * Build an air-gapped package
 *
 * Reads `src/api/json/catalog.json`, downloads every schema referenced by the
 * `url` property, writes the downloaded files to `build/schemas/` and emits
 * `build/catalog.json` which mirrors the original catalog but with `url`
 * values replaced by local relative paths (`./schemas/<file>`).
 */

import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import fetch from 'node-fetch'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DEFAULT_SOURCE = path.join(__dirname, '../src/api/json/catalog.json')
const DEFAULT_OUT = path.join(__dirname, '..', 'build')
const DEFAULT_SCHEMAS_DIR = 'schemas'

/** @param {string} p */
async function exists(p) {
  try {
    await fs.stat(p)
    return true
  } catch (err) {
    // @ts-ignore
    if (err && err.code === 'ENOENT') return false
    throw err
  }
}

/** @param {string} dir */
async function ensureDirectory(dir) {
  if (!(await exists(dir))) {
    await fs.mkdir(dir, { recursive: true })
  }
}

/** @param {string} file */
async function readJsonFile(file) {
  const data = await fs.readFile(file, 'utf-8')
  return JSON.parse(data)
}

/** @param {string} file
 *  @param {any} data
 */
async function writeJsonFile(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

/**
 * Slugify a string for filenames: lowercase, replace non-alphanumerics with hyphens, collapse repeats, trim, and append .json
 * @param {string} name
 */
function slugifyName(name) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-+/g, '-') + '.json'
  )
}

/** @param {string} urlStr */
function filenameFromUrl(urlStr) {
  try {
    const u = new URL(urlStr)
    let filename = path.basename(u.pathname) || ''
    filename = filename.split('?')[0].split('#')[0]
    if (!filename.toLowerCase().endsWith('.json')) filename = filename + '.json'
    return slugifyName(filename)
  } catch (err) {
    return slugifyName(urlStr)
  }
}

/**
 * Sleep for a given number of milliseconds
 * @param {number} ms
 */
async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Download a file with exponential backoff retry
 * @param {string} url The URL to download from
 * @param {number} attempt Current attempt number (1-based)
 * @param {number} maxAttempts Maximum number of attempts
 * @param {number} baseDelay Base delay in milliseconds
 */
async function downloadWithRetry(
  url,
  attempt = 1,
  maxAttempts = 4,
  baseDelay = 1000,
) {
  try {
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`)
    }
    return await res.arrayBuffer()
  } catch (err) {
    if (attempt >= maxAttempts) {
      // @ts-ignore
      throw new Error(`Failed after ${maxAttempts} attempts: ${err.message}`)
    }
    const delay = baseDelay * Math.pow(2, attempt - 1) // exponential backoff
    console.warn(
      // @ts-ignore
      `Attempt ${attempt} failed for ${url}, retrying in ${delay}ms: ${err.message}`,
    )
    await sleep(delay)
    return downloadWithRetry(url, attempt + 1, maxAttempts, baseDelay)
  }
}

/** @param {string} url
 *  @param {string} dest
 */
async function downloadToFile(url, dest) {
  const buf = await downloadWithRetry(url)
  await fs.writeFile(dest, Buffer.from(buf))
}

/**
 * @param {{catalog?:string,out?:string,schemasDir?:string,concurrency?:number}} [options]
 */
async function buildAirGappedPackage(options = {}) {
  const catalogPath = options.catalog || DEFAULT_SOURCE
  const outDir = options.out || DEFAULT_OUT
  const schemasSub = options.schemasDir || DEFAULT_SCHEMAS_DIR

  if (!(await exists(catalogPath))) {
    throw new Error(`Catalog not found: ${catalogPath}`)
  }

  await ensureDirectory(outDir)
  const schemasDir = path.join(outDir, schemasSub)
  await ensureDirectory(schemasDir)

  const catalog = await readJsonFile(catalogPath)
  if (!catalog || !Array.isArray(catalog.schemas)) {
    throw new Error('Unexpected catalog format: missing "schemas" array')
  }

  const newSchemas = []
  let failures = 0

  // concurrency
  const concurrency = options.concurrency || 10

  // Precompute filenames and deduplicate deterministically to avoid races
  const filenames = new Array(catalog.schemas.length)
  const nameCounts = new Map()
  for (let i = 0; i < catalog.schemas.length; i++) {
    const entry = catalog.schemas[i]
    if (!entry || typeof entry !== 'object') {
      filenames[i] = null
      continue
    }
    const url = entry.url
    if (!url || typeof url !== 'string') {
      filenames[i] = null
      continue
    }

    let filename = null
    if (entry.name && typeof entry.name === 'string') {
      filename = slugifyName(entry.name)
    } else {
      filename = filenameFromUrl(url)
    }

    const base = filename
    if (nameCounts.has(base)) {
      const count = nameCounts.get(base) || 1
      filename = `${path.parse(base).name}-${count}${path.parse(base).ext}`
      nameCounts.set(base, count + 1)
    } else {
      nameCounts.set(base, 1)
    }
    filenames[i] = filename
  }

  // worker for a single index
  /** @param {number} i */
  async function processIndex(i) {
    const entry = catalog.schemas[i]
    if (!entry || typeof entry !== 'object')
      return { i, newEntry: entry, failed: false }
    const url = entry.url
    if (!url || typeof url !== 'string')
      return { i, newEntry: entry, failed: false }

    const filename = filenames[i]
    const destPath = path.join(schemasDir, filename)
    try {
      const localRepoSchema = path.join(
        __dirname,
        '../src/schemas/json',
        filename,
      )
      if (await exists(localRepoSchema)) {
        console.info(
          `Copying local schema for ${url}: ${localRepoSchema} -> ${destPath}`,
        )
        await fs.copyFile(localRepoSchema, destPath)
      } else {
        console.info(
          `Downloading ${i + 1}/${catalog.schemas.length}: ${url} -> ${destPath}`,
        )
        await downloadToFile(url, destPath)
      }
      const newEntry = { ...entry, url: `./${schemasSub}/${filename}` }
      return { i, newEntry, failed: false }
    } catch (err) {
      console.error(`Failed to download ${url}: ${err}`)
      return { i, newEntry: { ...entry }, failed: true }
    }
  }

  // simple async pool
  /**
   * @param {number} poolLimit
   * @param {any[]} array
   * @param {(item:any) => Promise<any>} iteratorFn
   */
  async function asyncPool(poolLimit, array, iteratorFn) {
    const ret = []
    /** @type {Promise<any>[]} */
    const executing = []
    for (const item of array) {
      const p = Promise.resolve().then(() => iteratorFn(item))
      ret.push(p)
      executing.push(p)
      p.finally(() => {
        const idx = executing.indexOf(p)
        if (idx !== -1) executing.splice(idx, 1)
      }).catch(() => {})
      if (executing.length >= poolLimit) {
        await Promise.race(executing)
      }
    }
    return Promise.all(ret)
  }

  const indices = Array.from({ length: catalog.schemas.length }, (_, i) => i)
  const results = await asyncPool(concurrency, indices, processIndex)

  // assemble results in order
  for (const r of results) {
    if (!r) continue
    if (r.failed) failures++
    newSchemas[r.i] = r.newEntry
  }

  const outCatalog = { ...catalog, schemas: newSchemas }
  const outCatalogPath = path.join(outDir, 'catalog.json')
  await writeJsonFile(outCatalogPath, outCatalog)

  if (failures > 0) {
    console.error(`Completed with ${failures} download failures.`)
  } else {
    console.info(
      `Build complete. Wrote ${outCatalogPath} and ${newSchemas.length} schemas to ${schemasDir}`,
    )
  }
}

// Run as script
if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1].endsWith('build_air_gapped_package.ts') ||
  process.argv[1].endsWith('build_air_gapped_package.js')
) {
  const args = process.argv.slice(2)
  /** @type {{catalog?:string,out?:string,schemasDir?:string}} */
  const opts = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--catalog' && args[i + 1]) {
      opts.catalog = args[++i]
    } else if (a === '--out' && args[i + 1]) {
      opts.out = args[++i]
    } else if (a === '--schemas-dir' && args[i + 1]) {
      opts.schemasDir = args[++i]
    }
  }

  buildAirGappedPackage(opts).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}

export { buildAirGappedPackage }
