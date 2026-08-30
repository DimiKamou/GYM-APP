import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/auth/useAuth'
import { outboxFor } from '@/data/repo/supabase'
import { useRepoKind } from '@/data/repo/useRepo'
import type { DeadLetter, DrainReport, OutboxOp, OutboxStatus } from '@/data/outbox'
import { currentLocale } from '@/i18n'
import type { Locale } from '@/domain/format'
import { Button } from '@/ui/Button'
import { Icon, type IconName } from '@/ui/Icon'

/**
 * What the app has and has not saved, said out loud.
 *
 * The design prototype showed an "Auto-saved" toast fired by a button that wrote nothing. That
 * is the one lie this app cannot tell: a coach who believes a set landed stops re-checking it,
 * and the sheet a covering colleague reads tomorrow is missing the line that mattered. So this
 * component reports only what the outbox and the repository actually know, and it distinguishes
 * three things the prototype collapsed into one word:
 *
 *  - **On this phone.** The local repository has no server at all. "Αποθηκεύτηκε σε αυτό το
 *    κινητό" is the whole truth, and nothing here may hint at a sync that does not exist.
 *  - **Queued.** The write left the keypad and is in the outbox. That is not an error and not
 *    a loss — but it is not saved either, and saying so is what stops a trainer from clearing
 *    their browser data on the way home.
 *  - **Refused.** The server rejected an op. It is dead-lettered rather than dropped or retried
 *    forever, and this is the surface where a human sees it and can send it again.
 *
 * The data wiring is defaulted, not required: pass `kind`, `source` and `online` explicitly and
 * the component renders any state without an app around it, which is how each of them is tested.
 */

export type RepoKind = 'local' | 'supabase'

/**
 * The slice of `Outbox` this component needs. Structural, so the real outbox satisfies it with
 * no adapter and a test can hand over a plain object.
 */
export interface SyncSource {
  status(): OutboxStatus
  subscribe(listener: (status: OutboxStatus) => void): () => void
  refresh(): Promise<OutboxStatus>
  dead(): Promise<DeadLetter[]>
  retryDead(opId: string): Promise<OutboxOp | null>
  discardDead(opId: string): Promise<void>
  drain(options?: { force?: boolean }): Promise<DrainReport>
}

export type SyncState = 'local' | 'failed' | 'offline' | 'sending' | 'pending' | 'saved'

export interface SyncInput {
  kind: RepoKind
  online: boolean
  pending: number
  dead: number
  draining: boolean
}

/**
 * When the coach typed it, in the phone's own zone.
 *
 * Not a UTC slice of the instant: half past midnight in Athens is the previous day in UTC, and
 * a refused write dated the day before the session it belongs to is one a coach cannot match
 * against anything they remember doing. The time is there for the same reason — "12 Αυγ 19:40"
 * identifies a set; "12 Αυγ" identifies a whole evening.
 */
function whenTyped(iso: string, locale: Locale): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  return new Intl.DateTimeFormat(locale === 'el' ? 'el-GR' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at)
}

const IDLE: OutboxStatus = { pending: 0, dead: 0, draining: false, lastError: null, retryAt: null }

/**
 * The whole state machine, as one pure function.
 *
 * The order of the branches is the point. `local` first, because with no server "offline" and
 * "queued" are both meaningless and printing either would be an invented server. Then the dead
 * letters, ahead of everything else: a refused op is the only state that needs a human, and
 * burying it under "3 changes waiting" is how a queue stops working without anyone noticing.
 */
export function syncStateOf(input: SyncInput): SyncState {
  if (input.kind === 'local') return 'local'
  if (input.dead > 0) return 'failed'
  if (!input.online) return 'offline'
  if (input.draining && input.pending > 0) return 'sending'
  if (input.pending > 0) return 'pending'
  return 'saved'
}

const TONE: Record<SyncState, { color: string; icon: IconName }> = {
  local: { color: 'var(--th-muted)', icon: 'offline' },
  failed: { color: 'var(--th-danger)', icon: 'alert' },
  offline: { color: 'var(--th-warning)', icon: 'offline' },
  sending: { color: 'var(--th-accent)', icon: 'timer' },
  pending: { color: 'var(--th-warning)', icon: 'clock' },
  saved: { color: 'var(--th-success)', icon: 'check' },
}

/** Which project the connected app is actually talking to, and where it lives. */
export interface Backend {
  kind: RepoKind
  /** Host of the configured project URL — `abcd.supabase.co`. Null in demo mode. */
  host: string | null
  /**
   * Null unless it is declared. A `*.supabase.co` URL does not carry the region, and inventing
   * one here would be a data-residency claim that nobody checked.
   */
  region: string | null
}

type Env = Record<string, string | undefined>

export function readBackend(kind: RepoKind, env?: Env): Backend {
  // `import.meta.env` is typed with an index signature returning `any`; the cast keeps that
  // `any` from leaking into the return type.
  const source: Env = env ?? (import.meta.env as unknown as Env)
  if (kind === 'local') return { kind, host: null, region: null }
  const raw = (source.VITE_SUPABASE_URL ?? '').trim()
  const region = (source.VITE_SUPABASE_REGION ?? '').trim()
  let host: string | null = null
  try {
    host = raw === '' ? null : new URL(raw).host
  } catch {
    // A malformed URL is not worth a crash on the Settings screen; "not configured" is the
    // honest reading of a value the client could never connect to anyway.
    host = null
  }
  return { kind, host, region: region === '' ? null : region }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

/**
 * The outbox for the gym this session is in, or null when there is nothing to queue into.
 * Never constructed for the local repository: that repo writes straight to IndexedDB and an
 * outbox alongside it would report a queue nothing ever fills.
 */
function useDefaultSource(kind: RepoKind): SyncSource | null {
  const { gym } = useAuth()
  const gymId = gym?.id ?? null
  return useMemo(
    () => (kind === 'supabase' && gymId ? outboxFor(gymId) : null),
    [kind, gymId],
  )
}

function useOutboxStatus(source: SyncSource | null): OutboxStatus {
  const [status, setStatus] = useState<OutboxStatus>(() => source?.status() ?? IDLE)

  useEffect(() => {
    if (!source) {
      setStatus(IDLE)
      return
    }
    setStatus(source.status())
    const off = source.subscribe(setStatus)
    // The counts live on disk between reloads, and a freshly constructed outbox reports zero
    // until it has read them — which would show "saved" over a queue that survived the tab.
    void source.refresh().catch(() => undefined)
    return off
  }, [source])

  return status
}

/**
 * `navigator.onLine` plus its two events. It is only ever a hint — a phone on gym wifi with no
 * route to the internet reports itself online — which is why nothing here calls a write saved
 * on the strength of it.
 */
function useOnline(override?: boolean): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  return override ?? online
}

// ---------------------------------------------------------------------------

export interface SyncStatusProps {
  /** The Settings screen's version: the queue, every dead letter and its reason. */
  detail?: boolean
  /** Defaults to the live repository. */
  kind?: RepoKind
  /** Defaults to the gym's outbox. Explicitly null renders the no-queue states. */
  source?: SyncSource | null
  /** Defaults to `navigator.onLine`. */
  online?: boolean
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
  fontSize: 'var(--th-text-sm)',
  color: 'var(--th-muted)',
  minHeight: 24,
}

const bannerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
  padding: '10px 12px',
  borderRadius: 'var(--th-r-sm)',
  background: 'var(--th-danger-soft)',
  color: 'var(--th-danger-ink)',
  fontSize: 'var(--th-text-sm)',
  lineHeight: 1.4,
}

const stackStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 }

const bodyText: CSSProperties = {
  margin: 0,
  fontSize: 'var(--th-text-sm)',
  color: 'var(--th-muted)',
  lineHeight: 1.45,
}

const opStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  paddingTop: 10,
  borderTop: '1px solid var(--th-line-soft)',
}

const opActions: CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' }

export function SyncStatus({ detail = false, kind, source, online }: SyncStatusProps) {
  const { t } = useTranslation()
  const locale = currentLocale()
  const repoKind = useRepoKind()
  const liveKind = kind ?? repoKind
  const defaultSource = useDefaultSource(liveKind)
  // `undefined` means "use the app's outbox"; an explicit `null` means "there is no queue".
  const queue = source === undefined ? defaultSource : source
  const status = useOutboxStatus(queue)
  const isOnline = useOnline(online)

  const [dead, setDead] = useState<DeadLetter[]>([])
  const [notice, setNotice] = useState<string | null>(null)

  const state = syncStateOf({
    kind: liveKind,
    online: isOnline,
    pending: status.pending,
    dead: status.dead,
    draining: status.draining,
  })

  // The list itself is only needed where a human can act on it; the count drives the banner.
  useEffect(() => {
    if (!queue || !detail || status.dead === 0) {
      setDead([])
      return
    }
    let live = true
    void queue
      .dead()
      .then((rows) => {
        if (live) setDead(rows)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [queue, detail, status.dead])

  const retryAll = useCallback(async () => {
    if (!queue) return
    const ops = await queue.dead()
    for (const op of ops) await queue.retryDead(op.opId)
    setNotice(t('sync.requeued', { count: ops.length }))
    // Forced: the coach asking is newer information than whatever backoff we were waiting on.
    await queue.drain({ force: true })
  }, [queue, t])

  const retryOne = useCallback(
    async (opId: string) => {
      if (!queue) return
      await queue.retryDead(opId)
      setNotice(t('sync.requeued', { count: 1 }))
      await queue.drain({ force: true })
    },
    [queue, t],
  )

  const discardOne = useCallback(
    async (opId: string) => {
      if (!queue) return
      await queue.discardDead(opId)
      setNotice(t('sync.discarded'))
    },
    [queue, t],
  )

  const headline =
    state === 'local'
      ? t('sync.local')
      : state === 'failed'
        ? t('sync.failed', { count: status.dead })
        : state === 'offline'
          ? t('sync.offline')
          : state === 'sending'
            ? t('sync.sending')
            : state === 'pending'
              ? t('sync.pending', { count: status.pending })
              : t('sync.saved')

  const body =
    state === 'local'
      ? t('sync.localBody')
      : state === 'failed'
        ? t('sync.failedBody')
        : state === 'offline'
          ? t('sync.offlineBody')
          : state === 'saved'
            ? t('sync.savedBody')
            : t('sync.pendingBody')

  const tone = TONE[state]

  if (!detail) {
    // Dead letters get a banner rather than a line: the whole point of dead-lettering an op
    // instead of dropping it is that somebody is told, and a grey pill is not being told.
    if (state === 'failed') {
      return (
        <div role="alert" style={bannerStyle}>
          <Icon name="alert" size={18} />
          <span style={{ flex: '1 1 auto', minWidth: 0 }}>
            <strong>{headline}</strong> {body}
          </span>
          <Button size="sm" variant="danger" icon="undo" onClick={() => void retryAll()}>
            {t('sync.retryAll')}
          </Button>
        </div>
      )
    }

    return (
      <div role="status" aria-label={t('sync.label')} style={rowStyle}>
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: tone.color,
            flex: '0 0 auto',
          }}
        />
        <span>{headline}</span>
        {state === 'offline' && status.pending > 0 ? (
          <span>· {t('sync.pending', { count: status.pending })}</span>
        ) : null}
      </div>
    )
  }

  return (
    <div style={stackStyle}>
      <div role="status" aria-label={t('sync.label')} style={{ ...rowStyle, color: 'var(--th-ink)' }}>
        <Icon name={tone.icon} size={18} />
        <strong>{headline}</strong>
      </div>
      <p style={bodyText}>{body}</p>

      {state !== 'local' && status.pending > 0 && state !== 'pending' ? (
        <p style={bodyText}>
          {t('sync.queueTitle')}: {t('sync.pending', { count: status.pending })}
        </p>
      ) : null}

      {status.lastError ? (
        <p style={bodyText}>
          {t('sync.lastError')}: {status.lastError}
        </p>
      ) : null}

      {notice ? (
        <p role="status" style={{ ...bodyText, color: 'var(--th-ink)' }}>
          {notice}
        </p>
      ) : null}

      {dead.length > 0 ? (
        <>
          <p style={{ ...bodyText, color: 'var(--th-danger)' }}>
            <strong>{t('sync.deadTitle')}</strong>
          </p>
          {dead.map((op) => (
            <div key={op.opId} style={opStyle}>
              {/* The op's kind and the moment it was typed, never a bare op id: a person can
                  match "sets.upsert · 12 Αυγ 19:40" against what they remember doing. */}
              <span style={{ fontSize: 'var(--th-text-sm)', color: 'var(--th-ink)' }}>
                {op.kind} · {whenTyped(op.clientAt, locale)}
              </span>
              <span style={bodyText}>
                {t('sync.reason')}: {op.reason}
                {op.code ? ` (${op.code})` : ''}
              </span>
              <div style={opActions}>
                <Button size="sm" variant="secondary" icon="undo" onClick={() => void retryOne(op.opId)}>
                  {t('sync.retry')}
                </Button>
                {/* Discarding is a decision a human makes after reading the reason. Nothing in
                    the automatic path may remove an op the coach was never told about. */}
                <Button
                  size="sm"
                  variant="dangerQuiet"
                  icon="trash"
                  onClick={() => void discardOne(op.opId)}
                >
                  {t('sync.discard')}
                </Button>
              </div>
            </div>
          ))}
        </>
      ) : null}
    </div>
  )
}
