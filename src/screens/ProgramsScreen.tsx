import { useMemo, useState, type CSSProperties } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/auth/useAuth'
import { useAthletes, useCapabilities, useExercises, usePrograms, useProgramWrite } from '@/data/hooks'
import type { ProgramDayTree, ProgramTree } from '@/data/repo/types'
import { parseDecimal } from '@/domain/parseDecimal'
import { targetText } from '@/domain/recap'
import type { Equipment, ProgramItem, Uuid } from '@/domain/types'
import { currentLocale } from '@/i18n'
import { Button, Card, Chip, EmptyState, Field, Icon, Input, Screen, Segmented, Sheet, Spinner, ToastProvider, useToast } from '@/ui'
import { ExercisePicker, exerciseName } from '@/screens/log/ExercisePicker'
import { dayLabel } from '@/screens/log/StartFrom'

/**
 * Προγράμματα (013): the owner writes a programme FOR one athlete (#31) — numbered days, each a
 * list of exercises with sets, reps or seconds, and kilos — and the athlete's next workout
 * offers the next day of their order. Grouped under each athlete's name.
 *
 * Owner-only writes (RESTRICTIVE policies in 013); a trainer reads every programme here.
 * Removing is undo, not confirm, like everywhere else in the app.
 */

const muted: CSSProperties = { margin: 0, fontSize: 'var(--th-text-sm)', color: 'var(--th-muted)', lineHeight: 1.45 }

const heading: CSSProperties = {
  margin: 0,
  fontSize: 'var(--th-text-xs)',
  letterSpacing: 'var(--th-label-tracking)',
  textTransform: 'uppercase',
  color: 'var(--th-muted)',
}

export function ProgramsScreen() {
  return (
    <ToastProvider>
      <ProgramsBody />
    </ToastProvider>
  )
}

type ItemDraft = { day: ProgramDayTree; item?: ProgramItem; exerciseId: Uuid }

function ProgramsBody() {
  const { t } = useTranslation()
  const locale = currentLocale()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const focus = params.get('athlete')
  const toast = useToast()
  const { membership } = useAuth()
  const isOwner = membership?.role === 'owner'
  const caps = useCapabilities()
  const programs = usePrograms()
  const athletes = useAthletes()
  const exercises = useExercises()
  const write = useProgramWrite()

  const [creating, setCreating] = useState(false)
  const [picking, setPicking] = useState<ProgramDayTree | null>(null)
  const [draft, setDraft] = useState<ItemDraft | null>(null)

  const exerciseById = useMemo(() => new Map((exercises.data ?? []).map((e) => [e.id, e])), [exercises.data])
  const athleteName = useMemo(() => new Map((athletes.data ?? []).map((a) => [a.id, a.fullName])), [athletes.data])

  const groups = useMemo(() => {
    const byAthlete = new Map<string, ProgramTree[]>()
    for (const p of programs.data ?? []) {
      if (focus && p.athleteId !== focus) continue
      const key = p.athleteId ?? ''
      byAthlete.set(key, [...(byAthlete.get(key) ?? []), p])
    }
    return [...byAthlete.entries()].sort((a, b) => (athleteName.get(a[0]) ?? '').localeCompare(athleteName.get(b[0]) ?? '', 'el'))
  }, [programs.data, focus, athleteName])

  async function remove(table: 'programs' | 'program_days' | 'program_items', id: Uuid, message: string) {
    const state = await write.mutateAsync({ kind: 'remove', table, id })
    if (state === 'failed') return toast.show({ message: t('programs.writeFailed') })
    toast.show({ message, action: { label: t('common.undo'), onAction: () => void write.mutateAsync({ kind: 'restore', table, id }) } })
  }

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <h1 className="display" style={{ margin: 0, fontSize: 'var(--th-text-2xl)' }}>
        {t('programs.title')}
      </h1>
      {isOwner && caps.programs ? (
        <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
          {t('programs.new')}
        </Button>
      ) : null}
    </div>
  )

  if (!caps.programs) {
    return (
      <Screen label={t('programs.title')} header={header}>
        <EmptyState icon="note" title={t('programs.notInstalled')} description={t('programs.notInstalledHint')} />
      </Screen>
    )
  }

  if (programs.isPending) {
    return (
      <Screen label={t('programs.title')} header={header}>
        <Spinner label={t('common.loading')} />
      </Screen>
    )
  }

  return (
    <Screen label={t('programs.title')} header={header}>
      {focus ? (
        <Button variant="ghost" icon="back" onClick={() => navigate('/programs')}>
          {t('programs.allAthletes')}
        </Button>
      ) : null}
      {!isOwner ? <p style={muted}>{t('programs.ownerOnly')}</p> : null}
      {groups.length === 0 ? <EmptyState icon="note" title={t('programs.empty')} description={t('programs.emptyHint')} /> : null}

      {groups.map(([athleteId, list]) => (
        <section key={athleteId} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={heading}>{athleteName.get(athleteId) ?? t('programs.template')}</h2>
          {list.map((program) => (
            <Card key={program.id}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong style={{ flex: '1 1 auto', fontSize: 'var(--th-text-md)' }}>{program.name}</strong>
                  {isOwner ? (
                    <Button
                      variant="dangerQuiet"
                      size="sm"
                      icon="trash"
                      aria-label={`${t('common.delete')} — ${program.name}`}
                      onClick={() => void remove('programs', program.id, t('programs.removed'))}
                    />
                  ) : null}
                </div>
                {program.days.map((day) => (
                  <div key={day.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <strong style={{ flex: '1 1 auto', fontSize: 'var(--th-text-sm)' }}>
                        {dayLabel(t('programs.day'), day.position, day.name)}
                      </strong>
                      {isOwner ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon="trash"
                          aria-label={`${t('common.delete')} — ${dayLabel(t('programs.day'), day.position, day.name)}`}
                          onClick={() => void remove('program_days', day.id, t('programs.dayRemoved'))}
                        />
                      ) : null}
                    </div>
                    {day.items.length === 0 ? <p style={muted}>{t('programs.noItems')}</p> : null}
                    {day.items.map((item) => {
                      const exercise = exerciseById.get(item.exerciseId)
                      const text = [
                        exerciseName(exercise, locale),
                        item.equipment ? t(`equipmentTypes.${item.equipment}`) : null,
                        targetText(item, locale),
                      ]
                        .filter(Boolean)
                        .join(' · ')
                      return isOwner ? (
                        <button
                          key={item.id}
                          type="button"
                          className="th-tap num"
                          onClick={() => setDraft({ day, item, exerciseId: item.exerciseId })}
                          style={{ ...muted, color: 'var(--th-ink)', textAlign: 'left', minHeight: 44, display: 'flex', alignItems: 'center', gap: 6 }}
                        >
                          <Icon name="edit" size={16} />
                          {text}
                        </button>
                      ) : (
                        <p key={item.id} className="num" style={{ ...muted, color: 'var(--th-ink)' }}>
                          {text}
                        </p>
                      )
                    })}
                    {isOwner ? (
                      <Button variant="quiet" size="sm" icon="plus" onClick={() => setPicking(day)}>
                        {t('programs.addExercise')}
                      </Button>
                    ) : null}
                  </div>
                ))}
                {isOwner ? (
                  <Button variant="secondary" icon="plus" onClick={() => void write.mutateAsync({ kind: 'addDay', program })}>
                    {t('programs.addDay')}
                  </Button>
                ) : null}
              </div>
            </Card>
          ))}
        </section>
      ))}

      <ExercisePicker
        open={picking !== null}
        onClose={() => setPicking(null)}
        athleteId={focus ?? ''}
        locale={locale}
        onSelect={(exerciseId) => {
          if (picking) setDraft({ day: picking, exerciseId })
          setPicking(null)
        }}
      />

      <ItemSheet
        draft={draft}
        exerciseLabel={draft ? exerciseName(exerciseById.get(draft.exerciseId), locale) : ''}
        tools={draft ? (exerciseById.get(draft.exerciseId)?.equipmentOptions ?? []) : []}
        busy={write.isPending}
        onClose={() => setDraft(null)}
        onSave={async (input) => {
          if (!draft) return
          const state = draft.item
            ? await write.mutateAsync({ kind: 'updateItem', itemId: draft.item.id, patch: input })
            : await write.mutateAsync({ kind: 'addItem', day: draft.day, input: { exerciseId: draft.exerciseId, ...input } })
          if (state === 'failed') toast.show({ message: t('programs.writeFailed') })
          else setDraft(null)
        }}
        onRemove={
          draft?.item
            ? () => {
                const id = draft.item?.id
                setDraft(null)
                if (id) void remove('program_items', id, t('programs.itemRemoved'))
              }
            : undefined
        }
      />

      <CreateSheet
        open={creating}
        onClose={() => setCreating(false)}
        athletes={(athletes.data ?? []).map((a) => ({ id: a.id, name: a.fullName }))}
        programs={programs.data ?? []}
        athleteName={athleteName}
        initialAthlete={focus}
        busy={write.isPending}
        onCreate={async (athleteId, name, copyOf) => {
          const state = await write.mutateAsync({ kind: 'create', athleteId, name, copyOf })
          if (state === 'failed') toast.show({ message: t('programs.writeFailed') })
          else setCreating(false)
        }}
      />
    </Screen>
  )
}

type ItemInput = { equipment: Equipment | null; sets: number; reps: number | null; seconds: number | null; loadKg: number | null; note: string | null }

function ItemSheet({
  draft,
  exerciseLabel,
  tools,
  busy,
  onClose,
  onSave,
  onRemove,
}: {
  draft: ItemDraft | null
  exerciseLabel: string
  tools: readonly Equipment[]
  busy: boolean
  onClose: () => void
  onSave: (input: ItemInput) => Promise<void>
  onRemove?: () => void
}) {
  const item = draft?.item
  const key = draft ? `${draft.day.id}-${item?.id ?? draft.exerciseId}` : 'none'
  return (
    <Sheet open={draft !== null} onClose={onClose} title={exerciseLabel}>
      {draft ? <ItemForm key={key} item={item} tools={tools} busy={busy} onSave={onSave} onRemove={onRemove} /> : null}
    </Sheet>
  )
}

function ItemForm({
  item,
  tools,
  busy,
  onSave,
  onRemove,
}: {
  item?: ProgramItem
  tools: readonly Equipment[]
  busy: boolean
  onSave: (input: ItemInput) => Promise<void>
  onRemove?: () => void
}) {
  const { t } = useTranslation()
  const [measure, setMeasure] = useState<'reps' | 'time'>(item?.seconds ? 'time' : 'reps')
  const [sets, setSets] = useState(String(item?.sets ?? 3))
  const [count, setCount] = useState(String(item?.seconds ?? item?.reps ?? ''))
  const [kilos, setKilos] = useState(item?.loadKg != null ? String(item.loadKg).replace('.', ',') : '')
  const [tool, setTool] = useState<Equipment | null>(item?.equipment ?? (tools.length === 1 ? tools[0] : null))
  const [note, setNote] = useState(item?.note ?? '')
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const setCount = Number.parseInt(sets, 10)
    const amount = count.trim() === '' ? null : Number.parseInt(count, 10)
    // A Greek coach types «62,5»; Number() would make it NaN (CLAUDE.md).
    const load = kilos.trim() === '' ? null : parseDecimal(kilos)
    if (!Number.isInteger(setCount) || setCount < 1 || setCount > 20) return setError(t('programs.badSets'))
    if (amount !== null && (!Number.isInteger(amount) || amount < 1)) return setError(t('programs.badAmount'))
    if (kilos.trim() !== '' && load === null) return setError(t('programs.badKilos'))
    setError(null)
    await onSave({
      equipment: tool,
      sets: setCount,
      reps: measure === 'reps' ? amount : null,
      seconds: measure === 'time' ? amount : null,
      loadKg: load,
      note: note.trim() || null,
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {tools.length >= 2 ? (
        <Field label={t('log.tool')}>
          {() => (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {tools.map((option) => (
                <Chip key={option} selected={tool === option} onClick={() => setTool(option)}>
                  {t(`equipmentTypes.${option}`)}
                </Chip>
              ))}
            </div>
          )}
        </Field>
      ) : null}
      <Segmented
        label={t('log.measure')}
        value={measure}
        options={[
          { value: 'reps', label: t('log.measureReps') },
          { value: 'time', label: t('log.measureTime') },
        ]}
        onChange={setMeasure}
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <Field label={t('programs.sets')}>
          <Input inputMode="numeric" value={sets} onChange={(event) => setSets(event.target.value)} />
        </Field>
        <Field label={measure === 'reps' ? t('log.reps') : t('log.seconds')}>
          <Input inputMode="numeric" value={count} onChange={(event) => setCount(event.target.value)} />
        </Field>
        <Field label={t('log.kg')}>
          <Input inputMode="decimal" value={kilos} onChange={(event) => setKilos(event.target.value)} />
        </Field>
      </div>
      <Field label={t('common.notes')}>
        <Input value={note} maxLength={240} onChange={(event) => setNote(event.target.value)} />
      </Field>
      {error ? <p role="status" style={{ ...muted, color: 'var(--th-danger)' }}>{error}</p> : null}
      <Button variant="primary" loading={busy} disabled={busy} onClick={() => void save()}>
        {t('common.save')}
      </Button>
      {onRemove ? (
        <Button variant="dangerQuiet" icon="trash" onClick={onRemove}>
          {t('programs.removeItem')}
        </Button>
      ) : null}
    </div>
  )
}

function CreateSheet({
  open,
  onClose,
  athletes,
  programs,
  athleteName,
  initialAthlete,
  busy,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  athletes: Array<{ id: Uuid; name: string }>
  programs: ProgramTree[]
  athleteName: ReadonlyMap<string, string>
  initialAthlete: string | null
  busy: boolean
  onCreate: (athleteId: Uuid, name: string, copyOf: ProgramTree | null) => Promise<void>
}) {
  const { t } = useTranslation()
  const [athleteId, setAthleteId] = useState<string>(initialAthlete ?? '')
  const [name, setName] = useState('')
  const [copyId, setCopyId] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function create() {
    if (!athleteId) return setError(t('programs.forWhom'))
    if (name.trim() === '') return setError(t('programs.nameRequired'))
    setError(null)
    await onCreate(athleteId, name, programs.find((p) => p.id === copyId) ?? null)
    setName('')
    setCopyId('')
  }

  const selectStyle: CSSProperties = {
    minHeight: 44,
    width: '100%',
    borderRadius: 'var(--th-r-sm)',
    border: '1px solid var(--th-line)',
    background: 'var(--th-surface)',
    color: 'var(--th-ink)',
    padding: '0 10px',
    fontSize: 'var(--th-text-md)',
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('programs.new')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label={t('programs.forWhom')} required>
          {({ id }) => (
            <select id={id} value={athleteId} onChange={(event) => setAthleteId(event.target.value)} style={selectStyle}>
              <option value="">—</option>
              {athletes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('programs.name')} required>
          <Input value={name} maxLength={120} placeholder={t('programs.namePlaceholder')} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label={t('programs.copyFrom')} hint={t('programs.copyFromHint')}>
          {({ id }) => (
            <select id={id} value={copyId} onChange={(event) => setCopyId(event.target.value)} style={selectStyle}>
              <option value="">{t('programs.startEmpty')}</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {`${p.name} — ${athleteName.get(p.athleteId ?? '') ?? t('programs.template')}`}
                </option>
              ))}
            </select>
          )}
        </Field>
        {error ? <p role="status" style={{ ...muted, color: 'var(--th-danger)' }}>{error}</p> : null}
        <Button variant="primary" loading={busy} disabled={busy} onClick={() => void create()}>
          {t('programs.create')}
        </Button>
      </div>
    </Sheet>
  )
}
