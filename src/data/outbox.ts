import { del, get, set } from 'idb-keyval'
import type { SupabaseClient } from '@supabase/supabase-js'

import { newId } from '@/data/ids'
import type { Timestamp, Uuid } from '@/domain/types'

/**
 * The write outbox.
 *
 * Not a replication engine — a queue of mutation intents with three properties the naive
 * version lacks:
 *
 *  1. **Idempotent.** `opId` is minted on the client and never changes, and the server
 *     records it in `applied_ops`. A retry after a lost response is a `duplicate`, not a
 *     second session.
 *  2. **Coalesced.** One set of 82.5×8 is one insert plus about a dozen keypad updates. All
 *     thirteen describe the same row, so only the last one is worth shipping.
 *  3. **Bounded.** An op is applied, or it is dead-lettered where a human can see it. It is
 *     never dropped, and it is never retried forever — a permanently rejected op left in the
 *     queue blocks every op behind it, which is how a sync queue silently stops working.
 */

// The tables `apply_op()` will accept. memberships, invites and gyms are deliberately absent:
// a privilege change is an online, interactive act, never something replayed from a phone
// that has been in a pocket for three days.
export const OUTBOX_ENTITIES = [
  'athletes',
  'exercises',
  'exercise_aliases',
  'sessions',
  'blocks',
  'sets',
  'notes',
  'appointments',
] as const

export type OutboxEntity = (typeof OUTBOX_ENTITIES)[number]

/**
 * Only two verbs. `apply_op()` also understands bare `insert` and `update`, but neither is
 * retry-safe on its own: a replayed insert dies on the primary key and a replayed update on a
 * row that has since been soft-deleted. `upsert` is update-first-then-insert server-side, so
 * the same op means the same thing however many times it arrives.
 */
export type OutboxAction = 'upsert' | 'delete'

export type OpKind = `${OutboxEntity}.${OutboxAction}`

export interface OutboxOp {
  /** Client-minted, stable across every retry. The server's idempotency key. */
  opId: Uuid
  kind: OpKind
  /** The row this op writes. Coalescing is keyed on `(kind, entityId)`. */
  entityId: Uuid
  payload: Record<string, unknown>
  /** Queue order. Parents must reach the server before their children or the FK fails. */
  seq: number
  tries: number
  /** When the coach actually typed it — diverges from server time by the length of the outage. */
  clientAt: Timestamp
}

export interface DeadLetter extends OutboxOp {
  reason: string
  code: string | null
  deadAt: Timestamp
}

export interface EnqueueIntent {
  entity: OutboxEntity
  /** Defaults to `upsert`. */
  action?: OutboxAction
  id: Uuid
  payload?: Record<string, unknown>
  clientAt?: Timestamp
}

/** The envelope `apply_ops(p_gym, p_ops)` reads. Snake_case because Postgres does. */
export interface WireOp {
  op_id: Uuid
  seq: number
  entity: OutboxEntity
  action: OutboxAction
  id: Uuid
  payload: Record<string, unknown>
  client_at: Timestamp
  /** Delete only: the instant `deleted_at` should carry. */
  at?: Timestamp
}

export type OpStatus = 'ok' | 'duplicate' | 'rejected'

export interface OpResult {
  op_id: Uuid
  status: OpStatus
  reason?: string
  code?: string
}

export type OutboxTransport = (gymId: Uuid, ops: WireOp[]) => Promise<OpResult[]>

/**
 * Thrown when the batch never got a verdict. `permanent` separates "the tunnel ate it" — retry
 * — from "this identity may not write here" — which no amount of retrying will fix, and which
 * must therefore surface rather than spin.
 */
export class OutboxTransportError extends Error {
  readonly permanent: boolean
  readonly code: string | null

  constructor(message: string, options: { permanent?: boolean; code?: string | null } = {}) {
    super(message)
    this.name = 'OutboxTransportError'
    this.permanent = options.permanent ?? false
    this.code = options.code ?? null
  }
}

export type DrainOutcome =
  | 'idle'
  | 'busy'
  | 'offline'
  | 'backoff'
  | 'drained'
  | 'partial'
  | 'failed'

export interface DrainReport {
  outcome: DrainOutcome
  sent: number
  applied: number
  duplicate: number
  rejected: number
  /** Still queued when the drain returned. */
  pending: number
  dead: number
  error: string | null
}

export interface OutboxStatus {
  pending: number
  dead: number
  draining: boolean
  lastError: string | null
  /** Epoch ms of the next automatic attempt, or null when there is nothing waiting. */
  retryAt: number | null
}

/** The two-method slice of idb-keyval the outbox needs. Injected so tests need no IndexedDB. */
export interface OutboxStorage {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  del(key: string): Promise<void>
}

export interface OutboxOptions {
  gymId: Uuid
  transport: OutboxTransport
  storage?: OutboxStorage
  /** `apply_ops` rejects anything over 200: bigger batches hold locks longer than gym wifi lasts. */
  batchSize?: number
  maxTries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  now?: () => number
  random?: () => number
  isOnline?: () => boolean
  /** Injected so a test never waits on a real timer. Returns a cancel function. */
  schedule?: (fn: () => void, ms: number) => () => void
}

interface OutboxRecord {
  v: 1
  nextSeq: number
  ops: OutboxOp[]
}

const RECORD_VERSION = 1
const DEFAULT_BATCH_SIZE = 200
const DEFAULT_MAX_TRIES = 8
const DEFAULT_BASE_DELAY_MS = 1_000
const DEFAULT_MAX_DELAY_MS = 5 * 60_000
/** 25 × 200 ops. A bound, not a limit: it stops a buggy server answer from spinning forever. */
const MAX_BATCHES_PER_DRAIN = 25

export function outboxKey(gymId: Uuid): string {
  return `trainhub:outbox:v1:${gymId}`
}

export function deadLetterKey(gymId: Uuid): string {
  return `trainhub:outbox:dead:v1:${gymId}`
}

/**
 * idb-keyval with every call wrapped, falling back to memory. In private mode the accessor
 * itself throws; an outbox that throws on enqueue loses the set the coach just typed, which is
 * strictly worse than an outbox that only survives until the tab closes.
 */
export function createIdbStorage(): OutboxStorage {
  const memory = new Map<string, unknown>()
  return {
    async get<T>(key: string): Promise<T | undefined> {
      try {
        const value = await get<T>(key)
        if (value !== undefined) return value
      } catch {
        // Fall through to whatever this tab has held in memory.
      }
      return memory.get(key) as T | undefined
    },
    async set(key: string, value: unknown): Promise<void> {
      memory.set(key, value)
      try {
        await set(key, value)
      } catch {
        // Held in memory above; the coach's work is not lost inside this tab.
      }
    },
    async del(key: string): Promise<void> {
      memory.delete(key)
      try {
        await del(key)
      } catch {
        // As above.
      }
    },
  }
}

function emptyRecord(): OutboxRecord {
  return { v: RECORD_VERSION, nextSeq: 1, ops: [] }
}

function splitKind(kind: OpKind): { entity: OutboxEntity; action: OutboxAction } {
  const dot = kind.indexOf('.')
  return {
    entity: kind.slice(0, dot) as OutboxEntity,
    action: kind.slice(dot + 1) as OutboxAction,
  }
}

export function toWireOp(op: OutboxOp): WireOp {
  const { entity, action } = splitKind(op.kind)
  const wire: WireOp = {
    op_id: op.opId,
    seq: op.seq,
    entity,
    action,
    id: op.entityId,
    payload: op.payload,
    client_at: op.clientAt,
  }
  // A delete carried out at 07:12 and flushed at 19:00 is a 07:12 deletion.
  if (action === 'delete') wire.at = op.clientAt
  return wire
}

export class Outbox {
  private readonly gymId: Uuid
  private readonly transport: OutboxTransport
  private readonly storage: OutboxStorage
  private readonly batchSize: number
  private readonly maxTries: number
  private readonly baseDelayMs: number
  private readonly maxDelayMs: number
  private readonly now: () => number
  private readonly random: () => number
  private readonly isOnline: () => boolean
  private readonly schedule: (fn: () => void, ms: number) => () => void

  private readonly listeners = new Set<(status: OutboxStatus) => void>()
  /** Every store read-modify-write goes through this chain, so two enqueues cannot interleave. */
  private chain: Promise<unknown> = Promise.resolve()
  private draining = false
  private consecutiveFailures = 0
  private retryAt: number | null = null
  private cancelRetry: (() => void) | null = null
  private pendingCount = 0
  private deadCount = 0
  private lastError: string | null = null
  private detach: Array<() => void> = []

  constructor(options: OutboxOptions) {
    this.gymId = options.gymId
    this.transport = options.transport
    this.storage = options.storage ?? createIdbStorage()
    this.batchSize = Math.max(1, Math.min(options.batchSize ?? DEFAULT_BATCH_SIZE, DEFAULT_BATCH_SIZE))
    this.maxTries = Math.max(1, options.maxTries ?? DEFAULT_MAX_TRIES)
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
    this.maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
    this.now = options.now ?? (() => Date.now())
    this.random = options.random ?? (() => Math.random())
    this.isOnline = options.isOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine))
    this.schedule =
      options.schedule ??
      ((fn, ms) => {
        const handle = setTimeout(fn, ms)
        return () => clearTimeout(handle)
      })
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  async pending(): Promise<OutboxOp[]> {
    const record = await this.load()
    return [...record.ops].sort(bySeq)
  }

  async dead(): Promise<DeadLetter[]> {
    return this.loadDead()
  }

  status(): OutboxStatus {
    return {
      pending: this.pendingCount,
      dead: this.deadCount,
      draining: this.draining,
      lastError: this.lastError,
      retryAt: this.retryAt,
    }
  }

  subscribe(listener: (status: OutboxStatus) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Reads the counts off disk so a freshly constructed outbox reports the truth. */
  async refresh(): Promise<OutboxStatus> {
    const [record, dead] = await Promise.all([this.load(), this.loadDead()])
    this.pendingCount = record.ops.length
    this.deadCount = dead.length
    this.emit()
    return this.status()
  }

  // -------------------------------------------------------------------------
  // Writing
  // -------------------------------------------------------------------------

  async enqueue(intent: EnqueueIntent): Promise<OutboxOp> {
    return this.serialize(async () => {
      const record = await this.load()
      const action = intent.action ?? 'upsert'
      const kind: OpKind = `${intent.entity}.${action}`
      const clientAt = intent.clientAt ?? new Date(this.now()).toISOString()
      const payload = { ...(intent.payload ?? {}) }

      // Coalesce into the LAST op touching this row, and only if it is the same kind and has
      // never been sent. Looking only at the last one is what keeps a delete from being
      // overtaken: `delete` then `upsert{deleted_at:null}` must stay in that order, and
      // merging the un-delete backwards into an earlier upsert would leave the row deleted.
      // The `tries === 0` guard is the other half: once an op has gone out, the server may
      // already hold its opId, so folding new data into it would let a `duplicate` verdict
      // silently discard a write.
      const lastIndex = findLastIndex(record.ops, (op) => op.entityId === intent.id)
      const previous = lastIndex >= 0 ? record.ops[lastIndex] : undefined

      if (previous && previous.kind === kind && previous.tries === 0) {
        // Merge rather than replace: the insert carries the whole row and each keypad edit
        // carries one field. Replacing would ship a partial row for an insert that never
        // reached the server.
        const merged: OutboxOp = {
          ...previous,
          payload: { ...previous.payload, ...payload },
          clientAt,
        }
        record.ops[lastIndex] = merged
        await this.save(record)
        return merged
      }

      const op: OutboxOp = {
        opId: newId(),
        kind,
        entityId: intent.id,
        payload,
        seq: record.nextSeq,
        tries: 0,
        clientAt,
      }
      record.nextSeq += 1
      record.ops.push(op)
      await this.save(record)
      return op
    })
  }

  /**
   * Removes a dead letter once a human has seen it. Separate from `drain` on purpose: nothing
   * in the automatic path may delete an op a coach has not been told about.
   */
  async discardDead(opId: Uuid): Promise<void> {
    await this.serialize(async () => {
      const dead = await this.loadDead()
      await this.saveDead(dead.filter((op) => op.opId !== opId))
    })
  }

  /** Re-queues a dead letter — the "try again" behind the banner. */
  async retryDead(opId: Uuid): Promise<OutboxOp | null> {
    return this.serialize(async () => {
      const dead = await this.loadDead()
      const found = dead.find((op) => op.opId === opId)
      if (!found) return null
      await this.saveDead(dead.filter((op) => op.opId !== opId))

      const record = await this.load()
      // A fresh opId, because the old one may already sit in applied_ops from the attempt that
      // half-succeeded; reusing it would come back `duplicate` and drop the write again.
      const op: OutboxOp = {
        opId: newId(),
        kind: found.kind,
        entityId: found.entityId,
        payload: found.payload,
        seq: record.nextSeq,
        tries: 0,
        clientAt: found.clientAt,
      }
      record.nextSeq += 1
      record.ops.push(op)
      await this.save(record)
      return op
    })
  }

  /** Membership gone, or a different user signed in. Both stores go. */
  async clear(): Promise<void> {
    await this.serialize(async () => {
      await this.storage.del(outboxKey(this.gymId))
      await this.storage.del(deadLetterKey(this.gymId))
      this.pendingCount = 0
      this.deadCount = 0
      this.lastError = null
      this.retryAt = null
    })
    this.emit()
  }

  // -------------------------------------------------------------------------
  // Draining
  // -------------------------------------------------------------------------

  async drain(options: { force?: boolean } = {}): Promise<DrainReport> {
    const force = options.force ?? false
    if (this.draining) return this.report('busy')
    if (!force && !this.isOnline()) return this.report('offline')
    if (!force && this.retryAt !== null && this.now() < this.retryAt) return this.report('backoff')

    this.draining = true
    this.cancelScheduledRetry()
    this.emit()

    let sent = 0
    let applied = 0
    let duplicate = 0
    let rejected = 0
    let outcome: DrainOutcome = 'idle'
    let error: string | null = null

    try {
      for (let pass = 0; pass < MAX_BATCHES_PER_DRAIN; pass += 1) {
        const batch = await this.serialize(() => this.takeBatch())
        if (batch.length === 0) {
          outcome = pass === 0 ? 'idle' : 'drained'
          break
        }

        sent += batch.length
        let results: OpResult[]
        try {
          results = await this.transport(this.gymId, batch.map(toWireOp))
        } catch (cause) {
          const failure = asTransportError(cause)
          error = failure.message
          if (failure.permanent) {
            // No retry will change the answer, so the batch goes where a human can see it
            // rather than blocking every op behind it forever.
            await this.serialize(() => this.deadLetter(batch, failure.message, failure.code))
            rejected += batch.length
            outcome = 'failed'
            break
          }
          // The queue is untouched apart from the try counts bumped before the send, which is
          // what eventually turns an unreachable server into a visible failure instead of a
          // loop nobody is told about.
          this.consecutiveFailures += 1
          this.scheduleRetry()
          outcome = 'failed'
          break
        }

        const settled = await this.serialize(() => this.settle(batch, results))
        applied += settled.applied
        duplicate += settled.duplicate
        rejected += settled.rejected

        if (settled.settled === 0) {
          // The server answered about none of them. Retrying immediately would spin; the op
          // ids make a later replay a no-op, so back off and try again with the next trigger.
          error = 'server returned no verdict for this batch'
          this.consecutiveFailures += 1
          this.scheduleRetry()
          outcome = 'partial'
          break
        }

        this.consecutiveFailures = 0
        this.retryAt = null
        if (this.pendingCount === 0) {
          outcome = 'drained'
          break
        }
        outcome = 'partial'
      }
    } finally {
      this.draining = false
      this.lastError = error
      this.emit()
    }

    return { ...this.report(outcome), sent, applied, duplicate, rejected, error }
  }

  /**
   * Attaches the two triggers that matter on a phone: the radio coming back, and the app
   * coming back to the foreground. `visibilitychange` is not redundant — iOS suspends a
   * backgrounded PWA without ever firing `online`.
   */
  start(): void {
    if (this.detach.length > 0) return
    if (typeof window !== 'undefined') {
      const onOnline = () => {
        // A reconnect is new information: it invalidates whatever backoff we were waiting on.
        this.consecutiveFailures = 0
        this.retryAt = null
        void this.drain()
      }
      window.addEventListener('online', onOnline)
      this.detach.push(() => window.removeEventListener('online', onOnline))
    }
    if (typeof document !== 'undefined') {
      const onVisible = () => {
        if (document.visibilityState === 'visible') void this.drain()
      }
      document.addEventListener('visibilitychange', onVisible)
      this.detach.push(() => document.removeEventListener('visibilitychange', onVisible))
    }
    void this.refresh().then(() => this.drain())
  }

  stop(): void {
    this.cancelScheduledRetry()
    for (const off of this.detach) off()
    this.detach = []
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Runs inside the serialized chain. Bumps `tries` before the send, deliberately. */
  private async takeBatch(): Promise<OutboxOp[]> {
    const record = await this.load()
    record.ops.sort(bySeq)

    const expired = record.ops.filter((op) => op.tries >= this.maxTries)
    if (expired.length > 0) {
      const expiredIds = new Set(expired.map((op) => op.opId))
      record.ops = record.ops.filter((op) => !expiredIds.has(op.opId))
      await this.appendDead(
        expired,
        `δεν στάλθηκε μετά από ${this.maxTries} προσπάθειες`,
        'transport',
      )
    }

    const batch = record.ops.slice(0, this.batchSize)
    // Persisted before the request goes out, for two reasons: a crash mid-flight still counts
    // the attempt, and any enqueue arriving while we await the network sees `tries > 0` and
    // appends a new op instead of coalescing into one the server may already have.
    for (const op of batch) op.tries += 1
    await this.save(record)
    return batch.map((op) => ({ ...op }))
  }

  private async settle(
    batch: OutboxOp[],
    results: OpResult[],
  ): Promise<{ applied: number; duplicate: number; rejected: number; settled: number }> {
    const byId = new Map(results.map((result) => [result.op_id, result]))
    const done = new Set<Uuid>()
    const failed: DeadLetter[] = []
    const deadAt = new Date(this.now()).toISOString()
    let applied = 0
    let duplicate = 0

    for (const op of batch) {
      const result = byId.get(op.opId)
      // No verdict: the op stays queued. Its opId makes the replay a no-op server-side, so
      // the cost of guessing wrong here is one wasted round-trip, not a duplicate session.
      if (!result) continue
      if (result.status === 'ok' || result.status === 'duplicate') {
        done.add(op.opId)
        if (result.status === 'duplicate') duplicate += 1
        else applied += 1
        continue
      }
      failed.push({
        ...op,
        reason: result.reason ?? 'rejected',
        code: result.code ?? null,
        deadAt,
      })
    }

    const record = await this.load()
    const failedIds = new Set(failed.map((op) => op.opId))
    record.ops = record.ops.filter((op) => !done.has(op.opId) && !failedIds.has(op.opId))
    await this.save(record)
    if (failed.length > 0) await this.appendDead(failed)

    return { applied, duplicate, rejected: failed.length, settled: done.size + failed.length }
  }

  private async deadLetter(batch: OutboxOp[], reason: string, code: string | null): Promise<void> {
    const batchIds = new Set(batch.map((op) => op.opId))
    const record = await this.load()
    record.ops = record.ops.filter((op) => !batchIds.has(op.opId))
    await this.save(record)
    await this.appendDead(batch, reason, code)
  }

  private async appendDead(
    ops: Array<OutboxOp | DeadLetter>,
    reason?: string,
    code?: string | null,
  ): Promise<void> {
    const deadAt = new Date(this.now()).toISOString()
    const existing = await this.loadDead()
    const added: DeadLetter[] = ops.map((op) =>
      'reason' in op
        ? op
        : { ...op, reason: reason ?? 'rejected', code: code ?? null, deadAt },
    )
    await this.saveDead([...existing, ...added])
  }

  private async load(): Promise<OutboxRecord> {
    const stored = await this.storage.get<OutboxRecord>(outboxKey(this.gymId))
    if (!stored || stored.v !== RECORD_VERSION || !Array.isArray(stored.ops)) return emptyRecord()
    return { v: RECORD_VERSION, nextSeq: stored.nextSeq, ops: [...stored.ops] }
  }

  private async save(record: OutboxRecord): Promise<void> {
    await this.storage.set(outboxKey(this.gymId), record)
    this.pendingCount = record.ops.length
    this.emit()
  }

  private async loadDead(): Promise<DeadLetter[]> {
    const stored = await this.storage.get<DeadLetter[]>(deadLetterKey(this.gymId))
    return Array.isArray(stored) ? stored : []
  }

  private async saveDead(dead: DeadLetter[]): Promise<void> {
    if (dead.length === 0) await this.storage.del(deadLetterKey(this.gymId))
    else await this.storage.set(deadLetterKey(this.gymId), dead)
    this.deadCount = dead.length
    this.emit()
  }

  private scheduleRetry(): void {
    // Full jitter on the top half of the window: two coaches whose phones reconnect together
    // must not hammer the same endpoint in lockstep.
    const exponential = Math.min(
      this.maxDelayMs,
      this.baseDelayMs * 2 ** Math.max(0, this.consecutiveFailures - 1),
    )
    const delay = Math.round(exponential / 2 + this.random() * (exponential / 2))
    this.retryAt = this.now() + delay
    this.cancelScheduledRetry()
    this.cancelRetry = this.schedule(() => {
      this.cancelRetry = null
      void this.drain()
    }, delay)
  }

  private cancelScheduledRetry(): void {
    if (!this.cancelRetry) return
    this.cancelRetry()
    this.cancelRetry = null
  }

  private report(outcome: DrainOutcome): DrainReport {
    return {
      outcome,
      sent: 0,
      applied: 0,
      duplicate: 0,
      rejected: 0,
      pending: this.pendingCount,
      dead: this.deadCount,
      error: this.lastError,
    }
  }

  private emit(): void {
    const snapshot = this.status()
    for (const listener of this.listeners) listener(snapshot)
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task)
    // Swallowed on the chain only: `run` still rejects for the caller. Without this a single
    // failed store write would poison every later enqueue.
    this.chain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}

export function createOutbox(options: OutboxOptions): Outbox {
  return new Outbox(options)
}

/**
 * Wipes one gym's queue without constructing an Outbox — used at boot when the membership
 * that authored those ops turns out to be gone, in which case none of them can ever apply.
 */
export async function clearOutboxStorage(
  gymId: Uuid,
  storage: OutboxStorage = createIdbStorage(),
): Promise<void> {
  await storage.del(outboxKey(gymId))
  await storage.del(deadLetterKey(gymId))
}

/**
 * The real transport: one `apply_ops` RPC per batch.
 *
 * The error classification is the interesting part. A network failure has no SQLSTATE and must
 * be retried; a SQLSTATE means the statement reached Postgres and was refused, and replaying
 * it will be refused identically — except for an expired JWT, which is fixed by the refresh
 * that is already in flight.
 */
export function createSupabaseTransport(client: SupabaseClient): OutboxTransport {
  return async (gymId, ops) => {
    const { data, error } = await client.rpc('apply_ops', { p_gym: gymId, p_ops: ops })
    if (error) {
      const code = error.code ?? null
      // PGRST301: the JWT expired mid-flight, and the refresh is already in progress.
      // 57014: statement timeout — the same batch may well succeed on a quieter connection.
      const retryable = code === null || code === 'PGRST301' || code === '57014'
      throw new OutboxTransportError(error.message, { permanent: !retryable, code })
    }
    // `apply_ops` returns jsonb, which PostgREST types as `unknown`; the shape is fixed by the
    // migration, not by this cast.
    return (data ?? []) as OpResult[]
  }
}

function asTransportError(cause: unknown): OutboxTransportError {
  if (cause instanceof OutboxTransportError) return cause
  return new OutboxTransportError(cause instanceof Error ? cause.message : String(cause))
}

function bySeq(a: OutboxOp, b: OutboxOp): number {
  return a.seq - b.seq
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (predicate(items[i])) return i
  }
  return -1
}
