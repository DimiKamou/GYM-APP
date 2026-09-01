import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/auth/useAuth'
import {
  useExportGym,
  useGymProfile,
  useRepoKind,
  useResetDemoData,
  useTeam,
  useUpdateGym,
} from '@/data/hooks'
import { compareSessions } from '@/domain/analytics'
import { formatWeight } from '@/domain/format'
import { normalizeText } from '@/domain/text'
import { currentLocale, LOCALES, setLocale } from '@/i18n'
import { useTheme, type ThemePreference } from '@/theme/ThemeProvider'
import type { Locale } from '@/domain/format'
import type {
  Athlete,
  Block,
  Exercise,
  Gym,
  Membership,
  Session,
  Uuid,
  WorkoutSet,
} from '@/domain/types'
import { Button, Card, Field, Icon, Input, Screen, Segmented } from '@/ui'
import { readBackend, SyncStatus } from '@/ui/SyncStatus'

/**
 * Gym, appearance, language, export, account.
 *
 * The section that matters most is the honest one. When the repository is local there is no
 * server, nothing syncs, and everything the trainer has logged lives in one browser's IndexedDB
 * — so this screen says exactly that, in a sentence, next to an export button. An app that
 * implies a backup it does not have is how three months of sheets disappear with a cleared
 * cache, and "it said it was saved" is the last thing anyone wants to hear at that point.
 *
 * The CSV is deliberately not a comma-separated file. On a Greek Windows locale Excel's list
 * separator is `;`, and a comma-delimited file opens as a single column even with a BOM — so
 * this writes UTF-8 with a BOM, CRLF line endings and a semicolon delimiter, which is the
 * combination that opens in columns by double-click on the machines this gym actually owns.
 */

const THEME_OPTIONS: readonly ThemePreference[] = ['system', 'daylight', 'slate']

const titleStyle: CSSProperties = { fontSize: 'var(--th-text-2xl)', margin: 0 }

const sectionTitle: CSSProperties = {
  margin: 0,
  fontSize: 'var(--th-text-sm)',
  fontWeight: 600,
  color: 'var(--th-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}

const cardStack: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 }

const bodyText: CSSProperties = {
  margin: 0,
  fontSize: 'var(--th-text-sm)',
  color: 'var(--th-ink)',
  lineHeight: 1.45,
}

const mutedText: CSSProperties = { ...bodyText, color: 'var(--th-muted)' }

const detailRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  fontSize: 'var(--th-text-sm)',
}

function Notice({ text, tone }: { text: string; tone: 'ok' | 'bad' }) {
  return (
    <p
      role="status"
      style={{
        margin: 0,
        fontSize: 'var(--th-text-sm)',
        lineHeight: 1.45,
        color: tone === 'bad' ? 'var(--th-danger)' : 'var(--th-success)',
      }}
    >
      {text}
    </p>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2 style={sectionTitle}>{title}</h2>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** What `Repo.exportGym` hands back, parsed. Every field is optional: it is JSON off the wire. */
interface ExportBundle {
  gym?: Gym | null
  memberships?: Membership[]
  athletes?: Athlete[]
  exercises?: Exercise[]
  sessions?: Session[]
  blocks?: Block[]
  sets?: WorkoutSet[]
}

const DELIMITER = ';'
const CRLF = '\r\n'
/** Excel will not detect UTF-8 without it, and every Greek name arrives as mojibake. */
const BOM = '\uFEFF'

function cell(value: string): string {
  return /["\r\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function number(value: number | null, locale: Locale): string {
  if (value === null || !Number.isFinite(value)) return ''
  // The decimal separator follows the UI language, matching the locale whose Excel is about to
  // read it — a "72.5" in a Greek Excel is text, not a number, and every SUM below it is zero.
  return formatWeight(value, locale)
}

/** `(position, id)`, never position alone: two offline inserts can mint the same position. */
function byPosition<T extends { position: number; id: Uuid }>(a: T, b: T): number {
  return a.position - b.position || a.id.localeCompare(b.id)
}

interface CsvContext {
  locale: Locale
  /** Already-translated column headings and category labels. */
  heading: string[]
  categoryLabel: (exercise: Exercise | undefined) => string
}

export function buildCsv(bundle: ExportBundle, context: CsvContext): string {
  const members = new Map((bundle.memberships ?? []).map((m) => [m.id, m]))
  const athletes = new Map((bundle.athletes ?? []).map((a) => [a.id, a]))
  const exercises = new Map((bundle.exercises ?? []).map((e) => [e.id, e]))
  const sets = (bundle.sets ?? []).filter((s) => s.deletedAt === null)
  const blocks = (bundle.blocks ?? []).filter((b) => b.deletedAt === null)
  const gymName = bundle.gym?.name ?? ''

  const lines: string[] = [context.heading.map(cell).join(DELIMITER)]

  for (const session of (bundle.sessions ?? [])
    .filter((s) => s.deletedAt === null)
    .sort(compareSessions)) {
    // Every number carries its author: `creditedTo` is whose session it was, `loggedBy` is who
    // typed it, and the export must not lose the distinction the schema keeps two fields for.
    const author = members.get(session.creditedTo ?? session.loggedBy)
    const athlete = athletes.get(session.athleteId)

    for (const block of blocks.filter((b) => b.sessionId === session.id).sort(byPosition)) {
      const exercise = exercises.get(block.exerciseId)
      const name =
        (context.locale === 'el' ? exercise?.nameEl : exercise?.nameEn) ??
        exercise?.nameEn ??
        exercise?.nameEl ??
        ''

      const blockSets = sets.filter((s) => s.blockId === block.id).sort(byPosition)
      blockSets.forEach((set, index) => {
        lines.push(
          [
            session.localDate,
            gymName,
            athlete?.fullName ?? '',
            author?.displayName ?? '',
            session.title ?? '',
            context.categoryLabel(exercise),
            name,
            String(index + 1),
            number(set.loadKg, context.locale),
            set.reps === null ? '' : String(set.reps),
            number(set.seconds, context.locale),
            number(set.meters, context.locale),
            number(set.rpe, context.locale),
            set.note ?? '',
          ]
            .map(cell)
            .join(DELIMITER),
        )
      })
    }
  }

  // A trailing CRLF: some Excel builds drop the final record without one.
  return `${BOM}${lines.join(CRLF)}${CRLF}`
}

function fileSlug(name: string): string {
  const slug = normalizeText(name).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')
  return slug === '' ? 'trainhub' : slug
}

/**
 * Hands the file to the browser. Returns false rather than throwing: in a locked-down browser
 * `createObjectURL` is not there at all, and the screen has to say so instead of doing nothing.
 */
function download(filename: string, content: string, mime: string): boolean {
  try {
    const url = URL.createObjectURL(new Blob([content], { type: mime }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    // Revoked late: Safari has not finished reading the blob when click() returns.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------

export function SettingsScreen() {
  const { t } = useTranslation()
  const locale = currentLocale()
  const { theme, setTheme } = useTheme()
  const { membership, user, isDemo, signOut } = useAuth()
  const repoKind = useRepoKind()

  const gym = useGymProfile()
  const team = useTeam()
  const updateGym = useUpdateGym()
  const exportGym = useExportGym()
  const resetDemo = useResetDemoData()

  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null)
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [resetTyped, setResetTyped] = useState('')
  const [resetError, setResetError] = useState<string | null>(null)

  // The field is seeded once per loaded gym; re-seeding on every render would fight the typist.
  useEffect(() => {
    if (gym.data) setName(gym.data.name)
  }, [gym.data])

  const backend = readBackend(repoKind)
  const resetWord = t('settings.resetConfirmWord')
  // Accent- and case-insensitive, like the ownership transfer: the word is a deliberate act,
  // not a spelling test, and a Greek keyboard set to lower case must not be a dead end.
  const resetWordMatches = normalizeText(resetTyped) === normalizeText(resetWord)

  const roster = team.data ?? []
  const me = roster.find((row) => row.id === membership?.id) ?? membership ?? null
  const isOwner = me?.role === 'owner'
  const dirty = gym.data !== null && gym.data !== undefined && name.trim() !== gym.data.name

  async function saveName() {
    const next = name.trim()
    if (next === '') {
      setNameError(t('settings.gymNameRequired'))
      return
    }
    setNameError(null)
    const state = await updateGym.mutateAsync({ name: next })
    setNotice(
      state === 'failed'
        ? { text: t('settings.gymSaveFailed'), tone: 'bad' }
        : { text: state === 'queued' ? t('common.queued') : t('settings.gymSaved'), tone: 'ok' },
    )
  }

  async function exportAs(format: 'csv' | 'json') {
    setNotice(null)
    let raw: string
    try {
      raw = await exportGym.mutateAsync()
    } catch {
      setNotice({ text: t('settings.exportFailed'), tone: 'bad' })
      return
    }

    const stamp = new Date().toISOString().slice(0, 10)
    const base = `trainhub-${fileSlug(gym.data?.name ?? '')}-${stamp}`

    if (format === 'json') {
      const file = `${base}.json`
      setNotice(
        download(file, raw, 'application/json;charset=utf-8')
          ? { text: t('settings.exportDone', { file }), tone: 'ok' }
          : { text: t('settings.exportFailed'), tone: 'bad' },
      )
      return
    }

    let bundle: ExportBundle
    try {
      bundle = JSON.parse(raw) as ExportBundle
    } catch {
      setNotice({ text: t('settings.exportFailed'), tone: 'bad' })
      return
    }

    if ((bundle.sessions ?? []).filter((s) => s.deletedAt === null).length === 0) {
      setNotice({ text: t('settings.exportEmpty'), tone: 'bad' })
      return
    }

    const csv = buildCsv(bundle, {
      locale,
      heading: [
        t('csv.date'),
        t('csv.gym'),
        t('csv.athlete'),
        t('csv.trainer'),
        t('csv.workout'),
        t('csv.category'),
        t('csv.exercise'),
        t('csv.set'),
        t('csv.kg'),
        t('csv.reps'),
        t('csv.seconds'),
        t('csv.meters'),
        t('csv.rpe'),
        t('csv.notes'),
      ],
      categoryLabel: (exercise) => (exercise ? t(`categories.${exercise.category}`) : ''),
    })

    const file = `${base}.csv`
    setNotice(
      download(file, csv, 'text/csv;charset=utf-8')
        ? { text: t('settings.exportDone', { file }), tone: 'ok' }
        : { text: t('settings.exportFailed'), tone: 'bad' },
    )
  }

  const header = (
    <h1 className="display" style={titleStyle}>
      {t('settings.title')}
    </h1>
  )

  return (
    <Screen label={t('settings.title')} header={header} footerSafeArea={false}>
      {notice ? <Notice text={notice.text} tone={notice.tone} /> : null}

      <Section title={t('settings.gymWorkspace')}>
        <Card>
          <div style={cardStack}>
            <Field
              label={t('settings.gymName')}
              error={nameError ?? undefined}
              hint={isOwner ? undefined : t('settings.ownerOnlyGym')}
            >
              <Input
                value={name}
                disabled={!isOwner}
                onChange={(event) => {
                  setName(event.target.value)
                  if (nameError) setNameError(null)
                }}
              />
            </Field>

            {isOwner ? (
              <Button
                variant="secondary"
                icon="check"
                disabled={!dirty || updateGym.isPending}
                loading={updateGym.isPending}
                onClick={() => void saveName()}
              >
                {t('common.save')}
              </Button>
            ) : null}

            <div style={detailRow}>
              <span style={{ color: 'var(--th-muted)' }}>{t('settings.timezone')}</span>
              <span>{gym.data?.timezone ?? '—'}</span>
            </div>

            {/* No <Field>: a <label for> pointing at a radiogroup names nothing. The
                group carries its own accessible name instead. */}
            <Segmented
              label={t('settings.displayUnit')}
              value={gym.data?.displayUnit ?? 'kg'}
              options={[
                { value: 'kg', label: t('settings.unitKg') },
                { value: 'lb', label: t('settings.unitLb') },
              ]}
              onChange={(next) => {
                if (!isOwner) return
                void updateGym.mutateAsync({ displayUnit: next }).then((state) =>
                  setNotice(
                    state === 'failed'
                      ? { text: t('settings.gymSaveFailed'), tone: 'bad' }
                      : { text: t('settings.gymSaved'), tone: 'ok' },
                  ),
                )
              }}
            />
          </div>
        </Card>
      </Section>

      <Section title={t('settings.appearance')}>
        <Card>
          <Segmented
            label={t('settings.theme')}
            value={theme}
            options={THEME_OPTIONS.map((value) => ({
              value,
              label:
                value === 'system'
                  ? t('settings.themeSystem')
                  : value === 'daylight'
                    ? t('settings.themeDaylight')
                    : t('settings.themeSlate'),
            }))}
            onChange={setTheme}
          />
        </Card>
      </Section>

      <Section title={t('settings.language')}>
        <Card>
          {/* ΕΛ, not GR: GR is a country code, and the language is what is being chosen. */}
          <Segmented
            label={t('settings.language')}
            value={locale}
            options={LOCALES.map((value) => ({
              value,
              label: value === 'el' ? t('language.elShort') : t('language.enShort'),
            }))}
            onChange={(next) => void setLocale(next)}
          />
        </Card>
      </Section>

      {/* What this install is, in the two facts a coach can act on: which backend holds their
          work, and whether anything is still waiting to reach it. */}
      <Section title={t('settings.syncSection')}>
        <Card>
          <div style={cardStack}>
            <div style={detailRow}>
              <span style={{ color: 'var(--th-muted)' }}>{t('settings.mode')}</span>
              <span>{repoKind === 'local' ? t('settings.modeDemo') : t('settings.modeConnected')}</span>
            </div>

            {repoKind === 'supabase' ? (
              <>
                <div style={detailRow}>
                  <span style={{ color: 'var(--th-muted)' }}>{t('settings.project')}</span>
                  <span>{backend.host ?? t('settings.projectUnknown')}</span>
                </div>
                <div style={detailRow}>
                  <span style={{ color: 'var(--th-muted)' }}>{t('settings.region')}</span>
                  {/* Never inferred from the URL. `eu-central-1` is a data-residency commitment,
                      and a guessed one is a claim nobody checked. */}
                  <span>{backend.region ?? t('settings.regionUnknown')}</span>
                </div>
              </>
            ) : null}
          </div>
        </Card>

        <Card>
          <SyncStatus detail />
        </Card>
      </Section>

      <Section title={t('settings.dataExport')}>
        <Card>
          <div style={cardStack}>
            <p style={bodyText}>
              <strong>{t('settings.storageTitle')}</strong>
            </p>
            {/* Never claim a sync that does not exist. With the local repository there is no
                server at all, and a coach who believes otherwise loses everything with a
                cleared cache. */}
            <p style={mutedText}>
              {repoKind === 'local' ? t('settings.storageLocalBody') : t('settings.storageServerBody')}
            </p>
            {repoKind === 'local' ? (
              <p style={{ ...bodyText, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <Icon name="alert" size={18} />
                <span>{t('settings.storageLocalHint')}</span>
              </p>
            ) : null}
          </div>
        </Card>

        <Card>
          <div style={cardStack}>
            <Button
              variant="secondary"
              icon="download"
              loading={exportGym.isPending}
              disabled={exportGym.isPending}
              onClick={() => void exportAs('csv')}
            >
              {t('settings.exportCsv')}
            </Button>
            <p style={mutedText}>{t('settings.exportCsvHint')}</p>

            <Button
              variant="quiet"
              icon="download"
              loading={exportGym.isPending}
              disabled={exportGym.isPending}
              onClick={() => void exportAs('json')}
            >
              {t('settings.exportJson')}
            </Button>
            <p style={mutedText}>{t('settings.exportJsonHint')}</p>
          </div>
        </Card>

        {repoKind === 'local' ? (
          <Card>
            <div style={cardStack}>
              <p style={mutedText}>{t('settings.resetDemoHint')}</p>
              {confirmingReset ? (
                <>
                  <p style={{ ...bodyText, color: 'var(--th-danger)' }}>
                    {t('settings.resetDemoConfirm')}
                  </p>
                  {/* Typed, not tapped. Every other destructive action here is soft and undoable;
                      this one deletes every session written on this device and no toast can bring
                      them back, which is exactly the case a tap-through confirm does not cover. */}
                  <Field
                    label={t('settings.resetTyped')}
                    hint={t('settings.resetTypeHint', { word: resetWord })}
                    error={resetError ?? undefined}
                  >
                    <Input
                      value={resetTyped}
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      onChange={(event) => {
                        setResetTyped(event.target.value)
                        if (resetError) setResetError(null)
                      }}
                    />
                  </Field>
                  <Button
                    variant="danger"
                    icon="undo"
                    loading={resetDemo.isPending}
                    disabled={resetDemo.isPending || !resetWordMatches}
                    onClick={async () => {
                      if (!resetWordMatches) {
                        setResetError(t('settings.resetMismatch'))
                        return
                      }
                      setConfirmingReset(false)
                      setResetTyped('')
                      try {
                        await resetDemo.mutateAsync()
                        setNotice({ text: t('settings.resetDone'), tone: 'ok' })
                      } catch {
                        setNotice({ text: t('settings.resetFailed'), tone: 'bad' })
                      }
                    }}
                  >
                    {t('settings.resetDemo')}
                  </Button>
                  <Button
                    variant="quiet"
                    onClick={() => {
                      setConfirmingReset(false)
                      setResetTyped('')
                      setResetError(null)
                    }}
                  >
                    {t('common.cancel')}
                  </Button>
                </>
              ) : (
                <Button
                  variant="dangerQuiet"
                  icon="undo"
                  onClick={() => {
                    setNotice(null)
                    setResetTyped('')
                    setResetError(null)
                    setConfirmingReset(true)
                  }}
                >
                  {t('settings.resetDemo')}
                </Button>
              )}
            </div>
          </Card>
        ) : null}
      </Section>

      <Section title={t('auth.account')}>
        <Card>
          <div style={cardStack}>
            <div style={detailRow}>
              <span style={{ color: 'var(--th-muted)' }}>{t('auth.signedInAs')}</span>
              <span>{user?.email ?? me?.email ?? '—'}</span>
            </div>
            <div style={detailRow}>
              <span style={{ color: 'var(--th-muted)' }}>{t('common.role')}</span>
              <span>{me ? t(`roles.${me.role}`) : '—'}</span>
            </div>
            <p style={mutedText}>{isDemo ? t('settings.accountDemo') : t('settings.signOutHint')}</p>
            <Button variant="dangerQuiet" icon="offline" onClick={() => void signOut()}>
              {t('auth.signOut')}
            </Button>
          </div>
        </Card>
      </Section>
    </Screen>
  )
}
