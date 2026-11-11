/**
 * Programmes and share links against PostgREST (013/014).
 *
 * Direct writes, never the outbox, for the same reason as the team writes: these tables are
 * not `apply_op()` entities, and assigning a programme or handing out a link is an online,
 * interactive act. Owner-only rules are RESTRICTIVE policies in 013; a trainer's write comes
 * back as zero rows or an error, and is reported as `failed`.
 *
 * Every method assumes 013 exists — callers ask `capabilities()` first and draw nothing until
 * it does. A link's period columns are named only once 014 has run.
 */

import type { PostgrestError } from '@supabase/supabase-js'

import { supabase } from '@/data/supabase'
import { num, schemaCaps, str, strOrNull, toBlock, toExercise, toSession, toSet } from '@/data/repo/supabase'
import type {
  NewProgramItemInput,
  ProgramDayTree,
  ProgramStore,
  ProgramTree,
  SharePeriod,
  SharedProgress,
  ShareStore,
  WriteState,
} from '@/data/repo/types'
import type { AthleteProgram, AthleteShare, Equipment, MuscleRole, ProgramItem, Uuid } from '@/domain/types'

type Row = Record<string, unknown>

const ITEM_COLS = 'id, gym_id, day_id, position, exercise_id, equipment, muscle_group_id, sets, reps, load_kg, seconds, note, created_at, deleted_at, created_by'

function rowsOf(answer: { data: unknown; error: PostgrestError | null }): Row[] {
  if (answer.error) throw new Error(answer.error.message)
  return (answer.data ?? []) as Row[]
}

function state(answer: { error: PostgrestError | null }): WriteState {
  return answer.error ? 'failed' : 'saved'
}

/** `(position, id)`, never position alone: two inserts can mint the same one. */
function byPosition<T extends { position: number; id: Uuid }>(a: T, b: T): number {
  return a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

function toItem(row: Row): ProgramItem {
  return {
    id: str(row.id),
    gymId: str(row.gym_id),
    dayId: str(row.day_id),
    position: num(row.position) ?? 0,
    exerciseId: str(row.exercise_id),
    equipment: (row.equipment as Equipment | null) ?? null,
    muscleGroupId: strOrNull(row.muscle_group_id),
    sets: num(row.sets) ?? 1,
    reps: num(row.reps),
    loadKg: num(row.load_kg),
    seconds: num(row.seconds),
    note: strOrNull(row.note),
    createdAt: str(row.created_at),
    deletedAt: strOrNull(row.deleted_at),
    createdBy: strOrNull(row.created_by),
  }
}

/** Postgres arrays arrive as JSON arrays, or as "{1,2,3}" from an older PostgREST. */
function sequenceOf(raw: unknown): number[] {
  const parts = Array.isArray(raw) ? raw : String(raw ?? '').replace(/[{}]/g, '').split(',')
  return parts.map((part) => num(part)).filter((n): n is number => n !== null)
}

function toAssignment(row: Row): AthleteProgram {
  return {
    id: str(row.id),
    gymId: str(row.gym_id),
    athleteId: str(row.athlete_id),
    programId: str(row.program_id),
    sequence: sequenceOf(row.sequence),
    createdAt: str(row.created_at),
    deletedAt: strOrNull(row.deleted_at),
    createdBy: strOrNull(row.created_by),
  }
}

function itemPayload(input: Partial<NewProgramItemInput>): Row {
  const out: Row = {}
  if (input.exerciseId !== undefined) out.exercise_id = input.exerciseId
  if (input.equipment !== undefined) out.equipment = input.equipment
  if (input.muscleGroupId !== undefined) out.muscle_group_id = input.muscleGroupId
  if (input.sets !== undefined) out.sets = input.sets
  if (input.reps !== undefined) out.reps = input.reps
  if (input.seconds !== undefined) out.seconds = input.seconds
  if (input.loadKg !== undefined) out.load_kg = input.loadKg
  if (input.note !== undefined) out.note = input.note
  return out
}

export function createSupabasePrograms(): ProgramStore {
  const store: ProgramStore = {
    async list(gymId) {
      const programs = rowsOf(
        await supabase
          .from('programs')
          .select('id, gym_id, name, athlete_id, notes, created_at, updated_at, deleted_at, created_by')
          .eq('gym_id', gymId)
          .is('deleted_at', null),
      )
      if (programs.length === 0) return []
      const days = rowsOf(
        await supabase
          .from('program_days')
          .select('id, gym_id, program_id, position, name, created_at, deleted_at, created_by')
          .eq('gym_id', gymId)
          .in('program_id', programs.map((p) => str(p.id)))
          .is('deleted_at', null),
      )
      const items = days.length
        ? rowsOf(
            await supabase
              .from('program_items')
              .select(ITEM_COLS)
              .eq('gym_id', gymId)
              .in('day_id', days.map((d) => str(d.id)))
              .is('deleted_at', null),
          ).map(toItem)
        : []
      return programs.map((p): ProgramTree => ({
        id: str(p.id),
        gymId: str(p.gym_id),
        name: str(p.name),
        athleteId: strOrNull(p.athlete_id),
        notes: strOrNull(p.notes),
        createdAt: str(p.created_at),
        updatedAt: str(p.updated_at),
        deletedAt: strOrNull(p.deleted_at),
        createdBy: strOrNull(p.created_by),
        days: days
          .filter((d) => str(d.program_id) === str(p.id))
          .map((d): ProgramDayTree => ({
            id: str(d.id),
            gymId: str(d.gym_id),
            programId: str(d.program_id),
            position: num(d.position) ?? 1,
            name: strOrNull(d.name),
            createdAt: str(d.created_at),
            deletedAt: strOrNull(d.deleted_at),
            createdBy: strOrNull(d.created_by),
            items: items.filter((i) => i.dayId === str(d.id)).sort(byPosition),
          }))
          .sort(byPosition),
      }))
    },

    async assignment(gymId, athleteId) {
      const found = rowsOf(
        await supabase
          .from('athlete_programs')
          .select('id, gym_id, athlete_id, program_id, sequence, created_at, deleted_at, created_by')
          .eq('gym_id', gymId)
          .eq('athlete_id', athleteId)
          .is('deleted_at', null)
          .limit(1),
      )
      return found[0] ? toAssignment(found[0]) : null
    },

    async lastStep(gymId, athleteId, assignmentId) {
      const found = rowsOf(
        await supabase
          .from('sessions')
          .select('id, program_step')
          .eq('gym_id', gymId)
          .eq('athlete_id', athleteId)
          .eq('athlete_program_id', assignmentId)
          .is('deleted_at', null)
          .order('local_date', { ascending: false })
          .order('started_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(1),
      )
      return found[0] ? num(found[0].program_step) : null
    },

    async createForAthlete(gymId, athleteId, name, copyOf) {
      const made = await supabase
        .from('programs')
        .insert({ gym_id: gymId, athlete_id: athleteId, name: name.trim().slice(0, 120) })
        .select('id')
      const programId = rowsOf(made)[0] ? str(rowsOf(made)[0].id) : ''
      if (!programId) throw new Error('only the owner writes programmes')

      const days = copyOf?.days.length ? copyOf.days : [{ position: 1, name: null, items: [] as ProgramItem[] }]
      for (const day of days) {
        const inserted = rowsOf(
          await supabase
            .from('program_days')
            .insert({ gym_id: gymId, program_id: programId, position: day.position, name: day.name })
            .select('id'),
        )
        const dayId = inserted[0] ? str(inserted[0].id) : ''
        if (!dayId || day.items.length === 0) continue
        rowsOf(
          await supabase.from('program_items').insert(
            day.items.map((item) => ({
              gym_id: gymId,
              day_id: dayId,
              position: item.position,
              ...itemPayload(item),
            })),
          ),
        )
      }
      // Put in use at once, in the plain order of its days, unless the athlete already
      // follows one: then it waits to be chosen on their sheet.
      if (!(await store.assignment(gymId, athleteId))) {
        await store.assign(gymId, athleteId, programId, days.map((d) => d.position))
      }
      return programId
    },

    async rename(gymId, programId, name) {
      return state(await supabase.from('programs').update({ name: name.trim() }).eq('gym_id', gymId).eq('id', programId))
    },

    async addDay(gymId, program, name) {
      const position = Math.max(0, ...program.days.map((d) => d.position)) + 1
      const answer = await supabase
        .from('program_days')
        .insert({ gym_id: gymId, program_id: program.id, position, name: name?.trim() || null })
      if (answer.error) return 'failed'
      // A plain order grows with the programme (1-2 → 1-2-3); a hand-written one is left alone.
      if (program.athleteId) {
        const current = await store.assignment(gymId, program.athleteId)
        const plain = Array.from({ length: position - 1 }, (_, i) => i + 1)
        if (current && current.programId === program.id && current.sequence.join() === plain.join()) {
          await supabase
            .from('athlete_programs')
            .update({ sequence: [...plain, position] })
            .eq('gym_id', gymId)
            .eq('id', current.id)
        }
      }
      return 'saved'
    },

    async addItem(gymId, day, input) {
      const position = Math.max(-1, ...day.items.map((i) => i.position)) + 1
      return state(
        await supabase.from('program_items').insert({ gym_id: gymId, day_id: day.id, position, ...itemPayload(input) }),
      )
    },

    async updateItem(gymId, itemId, patch) {
      return state(await supabase.from('program_items').update(itemPayload(patch)).eq('gym_id', gymId).eq('id', itemId))
    },

    async remove(gymId, table, id) {
      return state(await supabase.from(table).update({ deleted_at: new Date().toISOString() }).eq('gym_id', gymId).eq('id', id))
    },

    async restore(gymId, table, id) {
      return state(await supabase.from(table).update({ deleted_at: null }).eq('gym_id', gymId).eq('id', id))
    },

    async assign(gymId, athleteId, programId, sequence) {
      const current = await store.assignment(gymId, athleteId)
      // The partial unique index allows one live assignment: the old one ends first.
      if (current) {
        const ended = await supabase
          .from('athlete_programs')
          .update({ deleted_at: new Date().toISOString() })
          .eq('gym_id', gymId)
          .eq('id', current.id)
        if (ended.error) return 'failed'
      }
      return state(
        await supabase.from('athlete_programs').insert({ gym_id: gymId, athlete_id: athleteId, program_id: programId, sequence }),
      )
    },

    async unassign(gymId, assignmentId) {
      return state(
        await supabase
          .from('athlete_programs')
          .update({ deleted_at: new Date().toISOString() })
          .eq('gym_id', gymId)
          .eq('id', assignmentId),
      )
    },

    async itemsByIds(gymId, ids) {
      if (ids.length === 0) return []
      return rowsOf(await supabase.from('program_items').select(ITEM_COLS).eq('gym_id', gymId).in('id', ids as string[])).map(toItem)
    },
  }
  return store
}

function toShare(row: Row): AthleteShare {
  return {
    token: str(row.token),
    gymId: str(row.gym_id),
    athleteId: str(row.athlete_id),
    createdAt: str(row.created_at),
    revokedAt: strOrNull(row.revoked_at),
    createdBy: strOrNull(row.created_by),
    periodDays: num(row.period_days),
    fromDate: strOrNull(row.from_date),
    toDate: strOrNull(row.to_date),
  }
}

function periodPayload(period: SharePeriod): Row {
  return { period_days: period.periodDays, from_date: period.fromDate, to_date: period.toDate }
}

export function createSupabaseShares(): ShareStore {
  return {
    async active(gymId, athleteId) {
      const caps = await schemaCaps()
      const found = rowsOf(
        await supabase
          .from('athlete_shares')
          .select(`token, gym_id, athlete_id, created_at, revoked_at, created_by${caps.sharePeriods ? ', period_days, from_date, to_date' : ''}`)
          .eq('gym_id', gymId)
          .eq('athlete_id', athleteId)
          .is('revoked_at', null)
          .order('created_at', { ascending: false })
          .limit(1),
      )
      return found[0] ? toShare(found[0]) : null
    },

    async create(gymId, athleteId, period) {
      const caps = await schemaCaps()
      const answer = await supabase
        .from('athlete_shares')
        .insert({ gym_id: gymId, athlete_id: athleteId, ...(period && caps.sharePeriods ? periodPayload(period) : {}) })
        .select('token')
      if (answer.error) return { state: 'failed' }
      const token = rowsOf(answer)[0]?.token
      return token ? { state: 'saved', token: str(token) } : { state: 'failed' }
    },

    async setPeriod(gymId, token, period) {
      return state(await supabase.from('athlete_shares').update(periodPayload(period)).eq('gym_id', gymId).eq('token', token))
    },

    async revoke(gymId, token) {
      return state(
        await supabase.from('athlete_shares').update({ revoked_at: new Date().toISOString() }).eq('gym_id', gymId).eq('token', token),
      )
    },

    async fetch(token) {
      const { data, error } = await supabase.rpc('shared_progress', { p_token: token })
      if (error) throw new Error(error.message)
      const raw = (Array.isArray(data) ? data[0] : data) as Row | null
      return raw ? toSharedProgress(raw) : null
    },
  }
}

export function toSharedProgress(raw: Row): SharedProgress {
  const list = (key: string): Row[] => (Array.isArray(raw[key]) ? (raw[key] as Row[]) : [])
  const hasPeriod = raw.from !== undefined || raw.period_days !== undefined
  return {
    athleteName: str(raw.athlete),
    gymName: str(raw.gym),
    period: hasPeriod
      ? { periodDays: num(raw.period_days), fromDate: strOrNull(raw.from), toDate: strOrNull(raw.to) }
      : null,
    // The function returns partial rows; the mappers default every column it leaves out.
    sessions: list('sessions').map((r) => toSession({ gym_id: '', athlete_id: '', ...r })),
    blocks: list('blocks').map((r) => toBlock({ gym_id: '', ...r })),
    sets: list('sets').map((r) => toSet({ gym_id: '', ...r })),
    exercises: list('exercises').map(toExercise),
    exerciseMuscles: list('links').map((r) => ({
      exerciseId: str(r.exercise_id),
      muscleGroupId: str(r.muscle_group_id),
      role: (r.role === 'secondary' ? 'secondary' : 'primary') as MuscleRole,
    })),
    muscleGroups: list('groups').map((r) => ({ id: str(r.id), nameEl: str(r.name_el), nameEn: strOrNull(r.name_en) })),
    members: list('members').map((r) => ({ id: str(r.id), displayName: str(r.display_name) })),
  }
}
