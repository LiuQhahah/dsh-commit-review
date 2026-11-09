/**
 * Client half of `@local/dsh-commit-review`.
 *
 * Registers one dsh-better-sidebar tab that answers "what did this session's
 * agents commit, and what exactly changed?" — commits grouped by repository,
 * newest first, each expandable to its unified diff.
 *
 * The data comes from the Host routes in `index.js`
 * (`api/commit-review/{repos,summary,diff}`), so the page never touches git
 * itself and stays read-only.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-commit-review',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace owned by this plugin. */
    const NS = 'commitReview'
    /** Same-origin API prefix (relative, like the other sidebar plugins). */
    const API = 'api/commit-review'

    const en = {
      tabTitle: 'Commit review',
      tabDescription: 'Commits produced in this workspace, grouped by repository, with per-file diffs.',
      loading: 'Reading commits…',
      refresh: 'Refresh',
      today: 'Today',
      last7: 'Last 7 days',
      last30: 'Last 30 days',
      since: 'From',
      until: 'To',
      repo: 'Repository',
      allRepos: 'All repositories',
      empty: 'No commits in this window.',
      emptyHint: 'Widen the range, or check that the work was committed.',
      error: 'Could not read commits',
      retry: 'Retry',
      commits: 'commits',
      files: 'files',
      noRepo: 'No git repository found in this workspace.',
      commitFiles: 'Changed files',
      showDiff: 'Show diff',
      hideDiff: 'Hide diff',
      diffLoading: 'Loading diff…',
      diffEmpty: 'This commit has no textual diff.',
      truncated: 'The diff is large and was truncated.',
      binary: 'binary',
      body: 'Details',
    }

    const zh = {
      tabTitle: '提交审查',
      tabDescription: '按仓库分组查看本工作区产生的提交及其文件级 diff。',
      loading: '正在读取提交…',
      refresh: '刷新',
      today: '今天',
      last7: '近 7 天',
      last30: '近 30 天',
      since: '从',
      until: '到',
      repo: '仓库',
      allRepos: '全部仓库',
      empty: '该时间范围内没有提交。',
      emptyHint: '放宽时间范围，或确认改动已提交。',
      error: '读取提交失败',
      retry: '重试',
      commits: '个提交',
      files: '个文件',
      noRepo: '该工作区下没有找到 git 仓库。',
      commitFiles: '改动文件',
      showDiff: '展开 diff',
      hideDiff: '收起 diff',
      diffLoading: '正在加载 diff…',
      diffEmpty: '该提交没有文本 diff。',
      truncated: 'diff 过大，已截断。',
      binary: '二进制',
      body: '详情',
    }

    // ── theme tokens ────────────────────────────────────────────────────────
    const T = {
      text: 'var(--dsw-alias-label-primary)',
      sub: 'var(--dsw-alias-label-secondary)',
      dim: 'var(--dsw-alias-label-tertiary)',
      border: 'var(--dsw-alias-border-l1)',
      borderSoft: 'var(--dsw-alias-border-l2)',
      hover: 'var(--dsw-alias-interactive-bg-hover)',
      addBg: 'var(--dsw-alias-file-diff-added-bg)',
      delBg: 'var(--dsw-alias-file-diff-deleted-bg)',
      addMark: 'var(--dsw-alias-state-success-primary)',
      delMark: 'var(--dsw-alias-state-error-primary)',
      mono: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)',
      radius: 'var(--dsw-radius-sm)',
    }

    // ── time helpers ────────────────────────────────────────────────────────
    /** Midnight of the day `offset` days from today, in the browser's zone. */
    function dayStart(offset) {
      const now = new Date()
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, 0, 0, 0, 0)
    }

    /** `YYYY-MM-DDTHH:mm` for a datetime-local input, in local time. */
    function toInputValue(date) {
      const pad = (n) => String(n).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    /** ISO string for a datetime-local value (interpreted as local time). */
    function fromInputValue(value) {
      const parsed = new Date(value)
      return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString()
    }

    /** `HH:mm` for a commit timestamp. */
    function clock(iso) {
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return ''
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    /** `MM-DD` for a commit timestamp. */
    function monthDay(iso) {
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return ''
      return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    }

    // ── data access ─────────────────────────────────────────────────────────
    /** GET one JSON route, surfacing the host's error text. */
    async function getJson(path, params, signal) {
      const query = new URLSearchParams()
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== '') query.set(key, String(value))
      }
      const response = await fetch(`${API}/${path}?${query.toString()}`, {
        headers: { accept: 'application/json' },
        signal,
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
      return body
    }

    // ── small presentational pieces ─────────────────────────────────────────
    function Chip({ label, active, onClick }) {
      return h(
        'button',
        {
          type: 'button',
          onClick,
          style: {
            padding: '3px 9px',
            fontSize: '12px',
            lineHeight: '18px',
            borderRadius: T.radius,
            border: `1px solid ${active ? T.borderSoft : 'transparent'}`,
            background: active ? T.hover : 'transparent',
            color: active ? T.text : T.sub,
            cursor: 'pointer',
            fontFamily: 'inherit',
          },
        },
        label,
      )
    }

    function Stat({ added, deleted, t }) {
      return h(
        'span',
        { style: { fontSize: '12px', fontFamily: T.mono, whiteSpace: 'nowrap' } },
        h('span', { style: { color: T.addMark } }, `+${added}`),
        h('span', { style: { color: T.dim, margin: '0 4px' } }, '/'),
        h('span', { style: { color: T.delMark } }, `−${deleted}`),
      )
    }

    /** One unified-diff line, coloured by its prefix. */
    function DiffLine({ line, index }) {
      let background = 'transparent'
      let color = T.sub
      if (line.startsWith('+++') || line.startsWith('---')) {
        color = T.dim
      } else if (line.startsWith('+')) {
        background = T.addBg
        color = T.text
      } else if (line.startsWith('-')) {
        background = T.delBg
        color = T.text
      } else if (line.startsWith('@@')) {
        color = 'var(--dsw-alias-state-business-primary)'
      } else if (line.startsWith('diff --git') || line.startsWith('index ')) {
        color = T.dim
      }
      return h(
        'div',
        {
          key: index,
          style: {
            display: 'flex',
            gap: '10px',
            background,
            color,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          },
        },
        h(
          'span',
          {
            style: {
              flex: '0 0 44px',
              textAlign: 'right',
              color: T.dim,
              opacity: 0.55,
              userSelect: 'none',
            },
          },
          String(index + 1),
        ),
        h('span', { style: { flex: '1 1 auto' } }, line === '' ? ' ' : line),
      )
    }

    /** The lazily loaded diff of one commit. */
    function CommitDiff({ sessionId, cwd, repo, hash, t }) {
      const [state, setState] = React.useState({ status: 'loading', diff: '', truncated: false, error: '' })

      React.useEffect(() => {
        const controller = new AbortController()
        setState({ status: 'loading', diff: '', truncated: false, error: '' })
        getJson('diff', { sessionId, cwd, repo, hash }, controller.signal)
          .then((body) => {
            setState({ status: 'ready', diff: body.diff ?? '', truncated: body.truncated === true, error: '' })
          })
          .catch((error) => {
            if (controller.signal.aborted) return
            setState({ status: 'error', diff: '', truncated: false, error: String(error.message ?? error) })
          })
        return () => controller.abort()
      }, [sessionId, cwd, repo, hash])

      if (state.status === 'loading') {
        return h('div', { style: { padding: '8px 12px', fontSize: '12px', color: T.dim } }, t('diffLoading'))
      }
      if (state.status === 'error') {
        return h('div', { style: { padding: '8px 12px', fontSize: '12px', color: T.delMark } }, state.error)
      }
      if (state.diff.trim() === '') {
        return h('div', { style: { padding: '8px 12px', fontSize: '12px', color: T.dim } }, t('diffEmpty'))
      }
      const lines = state.diff.replace(/\n$/, '').split('\n')
      return h(
        'div',
        {
          style: {
            borderTop: `1px solid ${T.borderSoft}`,
            padding: '6px 0',
            fontFamily: T.mono,
            fontSize: '12px',
            lineHeight: '18px',
            overflowX: 'auto',
            maxHeight: '520px',
            overflowY: 'auto',
          },
        },
        state.truncated
          ? h('div', { style: { padding: '0 12px 6px', color: T.dim, fontFamily: 'inherit' } }, t('truncated'))
          : null,
        lines.map((line, index) => h(DiffLine, { key: index, line, index })),
      )
    }

    /** One commit row: header, changed files, and the expandable diff. */
    function CommitRow({ sessionId, cwd, repo, commit, t }) {
      const [open, setOpen] = React.useState(false)
      const [showFiles, setShowFiles] = React.useState(false)
      return h(
        'div',
        {
          style: {
            borderTop: `1px solid ${T.borderSoft}`,
            padding: '8px 12px',
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'baseline', gap: '8px' } },
          h(
            'code',
            {
              style: {
                fontSize: '11px',
                color: T.dim,
                fontFamily: T.mono,
                flex: '0 0 auto',
              },
            },
            commit.short,
          ),
          h(
            'span',
            {
              style: {
                flex: '1 1 auto',
                fontSize: '13px',
                color: T.text,
                lineHeight: '19px',
                wordBreak: 'break-word',
              },
            },
            commit.subject,
          ),
          h(Stat, { added: commit.insertions, deleted: commit.deletions, t }),
        ),
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              marginTop: '4px',
              fontSize: '11px',
              color: T.dim,
            },
          },
          h('span', null, `${monthDay(commit.time)} ${clock(commit.time)}`),
          h(
            'button',
            {
              type: 'button',
              onClick: () => setShowFiles((value) => !value),
              style: {
                border: 'none',
                background: 'transparent',
                color: T.dim,
                cursor: 'pointer',
                padding: 0,
                font: 'inherit',
              },
            },
            `${commit.files.length} ${t('files')}`,
          ),
          h(
            'button',
            {
              type: 'button',
              onClick: () => setOpen((value) => !value),
              style: {
                marginLeft: 'auto',
                border: `1px solid ${T.borderSoft}`,
                borderRadius: T.radius,
                background: 'transparent',
                color: T.sub,
                cursor: 'pointer',
                padding: '1px 8px',
                font: 'inherit',
              },
            },
            open ? t('hideDiff') : t('showDiff'),
          ),
        ),
        commit.body !== ''
          ? h(
              'div',
              {
                style: {
                  marginTop: '4px',
                  fontSize: '11px',
                  color: T.dim,
                  whiteSpace: 'pre-wrap',
                  lineHeight: '16px',
                },
              },
              commit.body,
            )
          : null,
        showFiles
          ? h(
              'div',
              {
                style: {
                  marginTop: '6px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                  fontFamily: T.mono,
                  fontSize: '11px',
                },
              },
              commit.files.map((file) =>
                h(
                  'div',
                  { key: file.path, style: { display: 'flex', gap: '8px', alignItems: 'baseline' } },
                  h(
                    'span',
                    {
                      style: {
                        flex: '1 1 auto',
                        color: T.sub,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      },
                      title: file.path,
                    },
                    file.path,
                  ),
                  file.binary
                    ? h('span', { style: { color: T.dim } }, t('binary'))
                    : h(Stat, { added: file.added, deleted: file.deleted, t }),
                ),
              ),
            )
          : null,
        open ? h(CommitDiff, { sessionId, cwd, repo, hash: commit.hash, t }) : null,
      )
    }

    /** One repository section. */
    function RepoSection({ sessionId, cwd, repo, t }) {
      const [collapsed, setCollapsed] = React.useState(false)
      return h(
        'section',
        { style: { marginBottom: '14px' } },
        h(
          'button',
          {
            type: 'button',
            onClick: () => setCollapsed((value) => !value),
            style: {
              width: '100%',
              display: 'flex',
              alignItems: 'baseline',
              gap: '8px',
              padding: '6px 12px',
              background: 'transparent',
              border: 'none',
              borderBottom: `1px solid ${T.border}`,
              cursor: 'pointer',
              textAlign: 'left',
              font: 'inherit',
            },
          },
          h('span', { style: { fontSize: '13px', fontWeight: 600, color: T.text } }, repo.name),
          repo.branch !== ''
            ? h('span', { style: { fontSize: '11px', color: T.dim, fontFamily: T.mono } }, repo.branch)
            : null,
          h(
            'span',
            { style: { marginLeft: 'auto', fontSize: '11px', color: T.dim, display: 'flex', gap: '8px' } },
            h('span', null, `${repo.commits.length} ${t('commits')}`),
            h('span', null, `${repo.files} ${t('files')}`),
            h(Stat, { added: repo.insertions, deleted: repo.deletions, t }),
          ),
        ),
        collapsed
          ? null
          : repo.commits.map((commit) =>
              h(CommitRow, { key: commit.hash, sessionId, cwd, repo: repo.path, commit, t }),
            ),
      )
    }

    /** The tab body. */
    function CommitReviewTab({ sessionId, cwd }) {
      // A sidebar tab renders without the chat `t` seat, so the dictionary is
      // read through the plugin's own binding on every render — a locale switch
      // therefore repaints without remounting the tab.
      const t = (key, params) => {
        const dict = zhOrEn(key)
        if (params === undefined) return dict
        return dict.replace(/\{(\w+)\}/g, (whole, name) => (name in params ? String(params[name]) : whole))
      }

      const [preset, setPreset] = React.useState('today')
      const [since, setSince] = React.useState(() => toInputValue(dayStart(0)))
      const [until, setUntil] = React.useState(() => toInputValue(new Date()))
      const [repo, setRepo] = React.useState('')
      const [repos, setRepos] = React.useState([])
      const [state, setState] = React.useState({ status: 'loading', data: null, error: '' })
      const [nonce, setNonce] = React.useState(0)

      /** Apply a preset to the two inputs. */
      const applyPreset = (next) => {
        setPreset(next)
        const days = next === 'today' ? 0 : next === 'last7' ? -6 : -29
        setSince(toInputValue(dayStart(days)))
        setUntil(toInputValue(new Date()))
      }

      React.useEffect(() => {
        const controller = new AbortController()
        getJson('repos', { sessionId, cwd }, controller.signal)
          .then((body) => setRepos(Array.isArray(body.repos) ? body.repos : []))
          .catch(() => setRepos([]))
        return () => controller.abort()
      }, [sessionId, cwd])

      React.useEffect(() => {
        const controller = new AbortController()
        const sinceIso = fromInputValue(since)
        const untilIso = fromInputValue(until)
        if (sinceIso === '' || untilIso === '') return () => controller.abort()
        setState({ status: 'loading', data: null, error: '' })
        getJson('summary', { sessionId, cwd, since: sinceIso, until: untilIso, repo }, controller.signal)
          .then((data) => setState({ status: 'ready', data, error: '' }))
          .catch((error) => {
            if (controller.signal.aborted) return
            setState({ status: 'error', data: null, error: String(error.message ?? error) })
          })
        return () => controller.abort()
      }, [sessionId, cwd, since, until, repo, nonce])

      const header = h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            padding: '10px 12px',
            borderBottom: `1px solid ${T.border}`,
            position: 'sticky',
            top: 0,
            background: 'var(--dsw-alias-bg-layer-1)',
            zIndex: 1,
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } },
          h(Chip, { label: t('today'), active: preset === 'today', onClick: () => applyPreset('today') }),
          h(Chip, { label: t('last7'), active: preset === 'last7', onClick: () => applyPreset('last7') }),
          h(Chip, { label: t('last30'), active: preset === 'last30', onClick: () => applyPreset('last30') }),
          h(
            'button',
            {
              type: 'button',
              onClick: () => setNonce((value) => value + 1),
              style: {
                marginLeft: 'auto',
                padding: '3px 9px',
                fontSize: '12px',
                borderRadius: T.radius,
                border: `1px solid ${T.borderSoft}`,
                background: 'transparent',
                color: T.sub,
                cursor: 'pointer',
                fontFamily: 'inherit',
              },
            },
            t('refresh'),
          ),
        ),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: T.dim } },
          h('span', null, t('since')),
          h('input', {
            type: 'datetime-local',
            value: since,
            onChange: (event) => {
              setPreset('')
              setSince(event.target.value)
            },
            style: inputStyle(),
          }),
          h('span', null, t('until')),
          h('input', {
            type: 'datetime-local',
            value: until,
            onChange: (event) => {
              setPreset('')
              setUntil(event.target.value)
            },
            style: inputStyle(),
          }),
        ),
        repos.length > 1
          ? h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: T.dim } },
              h('span', null, t('repo')),
              h(
                'select',
                {
                  value: repo,
                  onChange: (event) => setRepo(event.target.value),
                  style: { ...inputStyle(), maxWidth: '100%' },
                },
                h('option', { value: '' }, t('allRepos')),
                repos.map((row) => h('option', { key: row.path, value: row.path }, row.name)),
              ),
            )
          : null,
        state.status === 'ready' && state.data !== null
          ? h(
              'div',
              { style: { fontSize: '11px', color: T.dim } },
              `${state.data.totalCommits} ${t('commits')} · ${state.data.repos.length} repo`,
            )
          : null,
      )

      let body
      if (state.status === 'loading') {
        body = h('div', { style: { padding: '18px 12px', fontSize: '12px', color: T.dim } }, t('loading'))
      } else if (state.status === 'error') {
        body = h(
          'div',
          { style: { padding: '18px 12px', fontSize: '12px', color: T.delMark } },
          h('div', null, `${t('error')}: ${state.error}`),
          h(
            'button',
            {
              type: 'button',
              onClick: () => setNonce((value) => value + 1),
              style: {
                marginTop: '8px',
                padding: '3px 9px',
                fontSize: '12px',
                borderRadius: T.radius,
                border: `1px solid ${T.borderSoft}`,
                background: 'transparent',
                color: T.sub,
                cursor: 'pointer',
                fontFamily: 'inherit',
              },
            },
            t('retry'),
          ),
        )
      } else if (state.data === null || state.data.repos.length === 0) {
        body = h(
          'div',
          { style: { padding: '18px 12px', fontSize: '12px', color: T.dim } },
          h('div', null, repos.length === 0 ? t('noRepo') : t('empty')),
          h('div', { style: { marginTop: '4px', opacity: 0.8 } }, repos.length === 0 ? '' : t('emptyHint')),
        )
      } else {
        body = state.data.repos.map((row) => h(RepoSection, { key: row.path, sessionId, cwd, repo: row, t }))
      }

      return h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            minHeight: 0,
            overflow: 'auto',
            color: T.text,
          },
          title: cwd ?? '',
        },
        header,
        h('div', { style: { flex: '1 1 auto', paddingBottom: '12px' } }, body),
      )
    }

    /** Shared inline-input styling. */
    function inputStyle() {
      return {
        padding: '2px 6px',
        fontSize: '11px',
        borderRadius: T.radius,
        border: `1px solid ${T.borderSoft}`,
        background: 'transparent',
        color: T.text,
        fontFamily: 'inherit',
      }
    }

    /** The tab icon: a commit node with two branches. */
    function CommitIcon({ size }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 20 20',
          'aria-hidden': 'true',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        h('circle', { cx: 10, cy: 10, r: 3 }),
        h('path', { d: 'M10 2v5M10 13v5' }),
        h('path', { d: 'M4 5.5a2 2 0 1 0 0-.01' }),
        h('path', { d: 'M16 5.5a2 2 0 1 0 0-.01' }),
        h('path', { d: 'M10 7c0-1-1-1.5-2.5-1.5H6M10 13c0 1 1 1.5 2.5 1.5H14' }),
      )
    }

    /** Pick the dictionary for the active locale (zh when the UI is Chinese). */
    let localeBind = null
    function zhOrEn(key) {
      const dict = localeBind === null ? en : localeBind(key)
      return dict === undefined ? (en[key] ?? key) : dict
    }

    const inject = ['betterSidebar', 'locale']

    /**
     * Client plugin body: register the dictionaries and the sidebar tab.
     * @param ctx - client root context.
     */
    function apply(ctx) {
      ctx.effect(() => {
        const offZh = ctx.locale.register(NS, 'zh', zh)
        const offEn = ctx.locale.register(NS, 'en', en)
        const bound = ctx.locale.bind(NS)
        localeBind = (key) => bound(key)
        return () => {
          localeBind = null
          offZh()
          offEn()
        }
      }, 'commit-review: dictionaries')

      ctx.effect(
        () =>
          ctx.betterSidebar.registerTab({
            id: 'commit-review',
            title: () => zhOrEn('tabTitle'),
            description: () => zhOrEn('tabDescription'),
            icon: (size) => h(CommitIcon, { size }),
            order: 40,
            single: true,
            component: ({ scope }) =>
              h(CommitReviewTab, { sessionId: scope.sessionId, cwd: scope.cwd }),
          }),
        'commit-review: register tab',
      )
    }

    return { inject, apply }
  },
})
