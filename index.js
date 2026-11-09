/**
 * Host half of `@local/dsh-commit-review`.
 *
 * It exposes three read-only JSON routes that the Client module renders as a
 * "Commit review" sidebar tab:
 *
 *   GET /api/commit-review/repos?sessionId=…
 *       → every git repository the session workspace holds.
 *   GET /api/commit-review/summary?sessionId=…&since=…&until=…&repo=…&limit=…
 *       → repositories under the workspace, each with its commits in the
 *         window (hash, time, subject, body, per-file added/deleted).
 *   GET /api/commit-review/diff?sessionId=…&repo=…&hash=…
 *       → the unified patch of one commit.
 *
 * Everything is read-only: `git log`, `git show`, `git rev-parse`. Nothing here
 * stages, commits, or writes. The workspace is resolved the same way the file
 * tools resolve it — the session's committed working directory, falling back to
 * its immutable header — because a session may `cd` into one repository of a
 * multi-repository workspace.
 */
import { execFile } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

/** Route prefix; the Client module uses the same literal. */
const API_PREFIX = '/api/commit-review'

/** Cap on repositories scanned under one workspace directory. */
const MAX_REPOS = 60
/** Cap on directories inspected per level while scanning for repositories. */
const MAX_SCAN_ENTRIES = 400
/** Cap on commits answered per repository unless the caller asks for more. */
const DEFAULT_COMMIT_LIMIT = 80
const MAX_COMMIT_LIMIT = 400
/** `git log` gets a timeout so a pathological repository cannot park the route. */
const GIT_TIMEOUT_MS = 30_000
/** Diffs above this many characters are truncated for the browser. */
const MAX_DIFF_CHARS = 2_000_000
/** Record/field separators: control bytes no commit message carries literally. */
const RS = '\u001e'
const FS = '\u001f'

/** Run one git command in `cwd` and resolve with its stdout. */
function git(cwd, args, timeout = GIT_TIMEOUT_MS) {
  return new Promise((resolvePromise, reject) => {
    execFile(
      'git',
      args,
      { cwd, timeout, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || error.message || '').trim()
          reject(new Error(detail === '' ? String(error.message) : detail))
          return
        }
        resolvePromise(stdout)
      },
    )
  })
}

/** Whether `path` is a git repository (a `.git` directory or worktree file). */
async function isRepo(path) {
  try {
    const info = await stat(join(path, '.git'))
    return info.isDirectory() || info.isFile()
  } catch {
    return false
  }
}

/** Immediate non-hidden subdirectories of `dir`, bounded. */
async function subdirs(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .slice(0, MAX_SCAN_ENTRIES)
      .map((entry) => join(dir, entry.name))
  } catch {
    return []
  }
}

/**
 * Resolve the directory a session's commits are read from.
 *
 * `scoped` must be the INJECTED context: a service is only readable from the fiber
 * that declared it, so the outer plugin context throws "cannot get property
 * sessions without inject".
 *
 * A session that is not live in memory (the server restarted since it was
 * opened, or the tab belongs to a scope this process never loaded) still knows
 * its workspace from the sidebar scope, which the Client passes as `cwd`.
 *
 * @param scoped - injected host plugin context.
 * @param sessionId - the session whose workspace is used.
 * @param explicit - workspace directory supplied by the caller, if any.
 * @returns the absolute workspace directory.
 */
function sessionCwd(scoped, sessionId, explicit) {
  const session = scoped.sessions.get(sessionId)
  if (session === undefined) {
    if (explicit !== undefined && explicit !== '' && isAbsolute(explicit)) return resolve(explicit)
    throw new Error(`unknown session "${sessionId}"`)
  }
  // `workingDirectory` is optional and read lazily: it only tracks `cd`s, and a
  // session that never moved keeps its immutable header directory.
  let committed
  try {
    committed = scoped.get('workingDirectory')?.get(session)
  } catch {
    committed = undefined
  }
  const cwd = committed ?? session.header.cwd ?? explicit
  if (cwd === undefined || cwd === '') throw new Error('session has no working directory')
  return resolve(cwd)
}

/**
 * List the git repositories reachable from one workspace directory: the
 * directory itself when it is a repository, otherwise its immediate children,
 * and — when none of those is a repository — their children too, because a
 * workspace commonly keeps each service one level down inside a container.
 * @param cwd - the session workspace.
 * @returns repository directories, deduplicated and sorted.
 */
async function listRepos(cwd) {
  if (await isRepo(cwd)) return [cwd]
  const first = await subdirs(cwd)
  const found = []
  await Promise.all(
    first.map(async (path) => {
      if (found.length < MAX_REPOS && (await isRepo(path))) found.push(path)
    }),
  )
  if (found.length === 0) {
    const second = (await Promise.all(first.map(subdirs))).flat()
    await Promise.all(
      second.map(async (path) => {
        if (found.length < MAX_REPOS && (await isRepo(path))) found.push(path)
      }),
    )
  }
  return [...new Set(found)].sort()
}

/** One numstat row: `<added>\t<deleted>\t<path>`, with `-` for binary files. */
function parseNumstat(lines) {
  const files = []
  let insertions = 0
  let deletions = 0
  for (const line of lines) {
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line)
    if (match === null) continue
    const binary = match[1] === '-' && match[2] === '-'
    const added = binary ? 0 : Number(match[1])
    const deleted = binary ? 0 : Number(match[2])
    insertions += added
    deletions += deleted
    files.push({ path: match[3], added, deleted, binary })
  }
  return { files, insertions, deletions }
}

/**
 * Read commits for one repository inside a window.
 * @param repo - absolute repository directory.
 * @param since - `--since` value (ISO or git-accepted date).
 * @param until - `--until` value.
 * @param limit - maximum commits.
 * @returns commit records, newest first.
 */
async function readCommits(repo, since, until, limit) {
  // The record separator opens the format, not closes it: `--numstat` appends
  // its rows AFTER the format output, so a trailing separator would push every
  // commit's file rows into the next record.
  const format = `${RS}%H${FS}%aI${FS}%s${FS}%b`
  let raw
  try {
    raw = await git(repo, [
      'log',
      '--no-merges',
      `--max-count=${limit}`,
      '--numstat',
      `--format=${format}`,
      '--date=iso-strict',
      '--since',
      since,
      '--until',
      until,
    ])
  } catch (error) {
    // A repository without commits answers with an error; that is empty, not a
    // failure worth surfacing as a red route.
    if (/does not have any commits|unknown revision|bad default revision/i.test(String(error.message))) {
      return []
    }
    throw error
  }
  const commits = []
  for (const chunk of raw.split(RS)) {
    const text = chunk.replace(/^\n+/, '')
    if (text.trim() === '') continue
    const newline = text.indexOf('\n')
    const header = newline === -1 ? text : text.slice(0, newline)
    const tail = newline === -1 ? '' : text.slice(newline + 1)
    const fields = header.split(FS)
    const hash = (fields[0] ?? '').trim()
    if (hash === '') continue
    const { files, insertions, deletions } = parseNumstat(tail.split('\n'))
    commits.push({
      hash,
      short: hash.slice(0, 7),
      time: fields[1] ?? '',
      subject: fields[2] ?? '',
      body: (fields[3] ?? '').trim(),
      files,
      insertions,
      deletions,
    })
  }
  return commits
}

/** The branch name of a repository, or '' when it is detached/unreadable. */
async function branchOf(repo) {
  try {
    return (await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  } catch {
    return ''
  }
}

/** Repository rows for one session workspace. */
async function repoRows(cwd, paths) {
  return Promise.all(
    paths.map(async (path) => ({
      path,
      name: path === cwd ? path.split('/').pop() ?? path : path.slice(cwd.length + 1) || path,
      branch: await branchOf(path),
    })),
  )
}

/** Refuse a repository that is not one of the workspace's own. */
async function repoUnder(cwd, requested) {
  const repos = await listRepos(cwd)
  if (requested === undefined || requested === '') return repos
  const target = resolve(requested)
  if (repos.includes(target)) return [target]
  throw new Error(`"${requested}" is not a git repository in this workspace`)
}

/** Write a JSON response. */
function sendJson(res, status, body) {
  const raw = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(raw.length),
    'cache-control': 'no-store',
  })
  res.end(raw)
}

/** Answer one route, turning a thrown error into a JSON error body. */
async function guard(res, run) {
  try {
    sendJson(res, 200, await run())
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * Host plugin body: register the three read routes.
 * @param ctx - host plugin context.
 */
export function apply(ctx) {
  ctx.inject(['webServer', 'sessions'], (scoped) => {
    const webServer = scoped.webServer
    if (webServer === undefined) {
      console.warn('[commit-review] webServer is unavailable; routes not registered')
      return
    }

    /** GET /repos — every repository under the session workspace. */
    webServer.register({
      kind: 'exact',
      path: `${API_PREFIX}/repos`,
      handler: (req, res) => {
        void guard(res, async () => {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const cwd = sessionCwd(scoped, url.searchParams.get('sessionId') ?? '', url.searchParams.get('cwd') ?? '')
          const repos = await listRepos(cwd)
          return { cwd, repos: await repoRows(cwd, repos) }
        })
      },
    })

    /** GET /summary — commits per repository inside the requested window. */
    webServer.register({
      kind: 'exact',
      path: `${API_PREFIX}/summary`,
      handler: (req, res) => {
        void guard(res, async () => {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const sessionId = url.searchParams.get('sessionId') ?? ''
          const since = url.searchParams.get('since') ?? ''
          const until = url.searchParams.get('until') ?? ''
          const repo = url.searchParams.get('repo') ?? ''
          const requested = Number(url.searchParams.get('limit') ?? '')
          const limit = Number.isFinite(requested) && requested > 0
            ? Math.min(MAX_COMMIT_LIMIT, Math.floor(requested))
            : DEFAULT_COMMIT_LIMIT
          if (since === '' || until === '') throw new Error('"since" and "until" are required')
          const cwd = sessionCwd(scoped, sessionId, url.searchParams.get('cwd') ?? '')
          const repos = await repoUnder(cwd, repo)
          const rows = await Promise.all(
            repos.map(async (path) => {
              const [commits, branch] = await Promise.all([
                readCommits(path, since, until, limit),
                branchOf(path),
              ])
              return {
                path,
                name: path === cwd ? path.split('/').pop() ?? path : path.slice(cwd.length + 1) || path,
                branch,
                commits,
                insertions: commits.reduce((sum, commit) => sum + commit.insertions, 0),
                deletions: commits.reduce((sum, commit) => sum + commit.deletions, 0),
                files: new Set(commits.flatMap((commit) => commit.files.map((file) => file.path))).size,
              }
            }),
          )
          return {
            cwd,
            since,
            until,
            repos: rows.filter((row) => row.commits.length > 0),
            totalCommits: rows.reduce((sum, row) => sum + row.commits.length, 0),
          }
        })
      },
    })

    /** GET /diff — the unified patch of one commit. */
    webServer.register({
      kind: 'exact',
      path: `${API_PREFIX}/diff`,
      handler: (req, res) => {
        void guard(res, async () => {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const sessionId = url.searchParams.get('sessionId') ?? ''
          const repo = url.searchParams.get('repo') ?? ''
          const hash = url.searchParams.get('hash') ?? ''
          if (repo === '') throw new Error('"repo" is required')
          if (!/^[0-9a-f]{7,40}$/i.test(hash)) throw new Error('"hash" must be a commit hash')
          const cwd = sessionCwd(scoped, sessionId, url.searchParams.get('cwd') ?? '')
          const [path] = await repoUnder(cwd, repo)
          const diff = await git(path, [
            'show',
            '--format=',
            '--patch',
            '--no-color',
            '--find-renames',
            hash,
          ])
          const truncated = diff.length > MAX_DIFF_CHARS
          return {
            repo: path,
            hash,
            diff: truncated ? diff.slice(0, MAX_DIFF_CHARS) : diff,
            truncated,
          }
        })
      },
    })

    console.info(`[commit-review] routes registered under ${API_PREFIX}`)
  })
}
