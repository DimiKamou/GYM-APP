import { beforeEach, describe, expect, it, vi } from 'vitest'

import { newId } from '@/data/ids'
import {
  Outbox,
  OutboxTransportError,
  createOutbox,
  deadLetterKey,
  outboxKey,
  type OpResult,
  type OutboxStorage,
  type WireOp,
} from '@/data/outbox'
import type { Uuid } from '@/domain/types'

const GYM = newId()

function memoryStorage(): OutboxStorage & { raw: Map<string, unknown> } {
  const raw = new Map<string, unknown>()
  return {
    raw,
    async get<T>(key: string): Promise<T | undefined> {
      // Round-tripped through JSON the way IndexedDB structured-clones it, so a test can never
      // pass by mutating an object the outbox still holds a reference to.
      const value = raw.get(key)
      return value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as T)
    },
    async set(key: string, value: unknown): Promise<void> {
      raw.set(key, JSON.parse(JSON.stringify(value)) as unknown)
    },
    async del(key: string): Promise<void> {
      raw.delete(key)
    },
  }
}

/** Records every batch it is handed and answers with whatever the test scripted. */
function recordingTransport(answer: (ops: WireOp[]) => OpResult[] | Promise<OpResult[]>) {
  const batches: WireOp[][] = []
  const transport = async (_gymId: Uuid, ops: WireOp[]): Promise<OpResult[]> => {
    batches.push(ops.map((op) => ({ ...op })))
    return answer(ops)
  }
  return { transport, batches }
}

const allOk = (ops: WireOp[]): OpResult[] => ops.map((op) => ({ op_id: op.op_id, status: 'ok' }))

function makeOutbox(
  transport: (gymId: Uuid, ops: WireOp[]) => Promise<OpResult[]>,
  overrides: Partial<Parameters<typeof createOutbox>[0]> = {},
): { outbox: Outbox; storage: ReturnType<typeof memoryStorage> } {
  const storage = memoryStorage()
  const outbox = createOutbox({
    gymId: GYM,
    transport,
    storage,
    isOnline: () => true,
    now: () => 1_700_000_000_000,
    random: () => 0.5,
    // No real timers: a scheduled retry that fires on its own would make every test racy.
    schedule: () => () => undefined,
    ...overrides,
  })
  return { outbox, storage }
}

let sessionId: Uuid
let blockId: Uuid
let setId: Uuid

beforeEach(() => {
  sessionId = newId()
  blockId = newId()
  setId = newId()
})

describe('coalescing', () => {
  it('folds an insert and its keypad edits into one op', async () => {
    const { transport, batches } = recordingTransport(allOk)
    const { outbox } = makeOutbox(transport)

    const first = await outbox.enqueue({
      entity: 'sets',
      id: setId,
      payload: { block_id: blockId, position: 0, kind: 'weight_reps', load_kg: null, reps: null },
      clientAt: '2026-08-29T07:00:00.000Z',
    })
    for (const load of [8, 82, 82.5]) {
      await outbox.enqueue({ entity: 'sets', id: setId, payload: { load_kg: load } })
    }
    await outbox.enqueue({
      entity: 'sets',
      id: setId,
      payload: { reps: 8, done_at: '2026-08-29T07:01:00.000Z' },
      clientAt: '2026-08-29T07:01:00.000Z',
    })

    const pending = await outbox.pending()
    expect(pending).toHaveLength(1)
    // The opId and the queue position of the FIRST write survive: the position is what keeps
    // the row's insert ahead of anything that references it.
    expect(pending[0].opId).toBe(first.opId)
    expect(pending[0].seq).toBe(first.seq)
    // Merged, not replaced — otherwise the shipped op would be `{load_kg, reps}` with no
    // block_id and the insert half would fail a NOT NULL.
    expect(pending[0].payload).toEqual({
      block_id: blockId,
      position: 0,
      kind: 'weight_reps',
      load_kg: 82.5,
      reps: 8,
      done_at: '2026-08-29T07:01:00.000Z',
    })
    // The op is stamped with the last keystroke, not the first.
    expect(pending[0].clientAt).toBe('2026-08-29T07:01:00.000Z')

    await outbox.drain()
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(1)
  })

  it('keeps rows apart: two sets in one block are two ops', async () => {
    const { outbox } = makeOutbox(recordingTransport(allOk).transport)
    const other = newId()
    await outbox.enqueue({ entity: 'sets', id: setId, payload: { reps: 8 } })
    await outbox.enqueue({ entity: 'sets', id: other, payload: { reps: 12 } })
    await outbox.enqueue({ entity: 'sets', id: setId, payload: { reps: 9 } })

    const pending = await outbox.pending()
    expect(pending.map((op) => op.entityId)).toEqual([setId, other])
    expect(pending[0].payload).toEqual({ reps: 9 })
  })

  // An un-delete merged backwards into the upsert that preceded the delete would leave the row
  // deleted — the coach's undo would appear to work and then vanish on the next read.
  it('never merges across a delete of the same row', async () => {
    const { outbox } = makeOutbox(recordingTransport(allOk).transport)
    await outbox.enqueue({ entity: 'sets', id: setId, payload: { reps: 8 } })
    await outbox.enqueue({ entity: 'sets', action: 'delete', id: setId })
    await outbox.enqueue({ entity: 'sets', id: setId, payload: { deleted_at: null } })

    const pending = await outbox.pending()
    expect(pending.map((op) => op.kind)).toEqual(['sets.upsert', 'sets.delete', 'sets.upsert'])
    expect(pending.map((op) => op.seq)).toEqual([1, 2, 3])
  })

  // Folding into an op the server may already hold would let its `duplicate` verdict discard
  // the newer payload with it.
  it('never merges into an op that has already been sent', async () => {
    const batches: WireOp[][] = []
    let release: (results: OpResult[]) => void = () => undefined
    const { outbox } = makeOutbox(async (_gymId, ops) => {
      batches.push(ops)
      // The first batch hangs, which is what "in flight" means: sent, no verdict yet.
      if (batches.length === 1) {
        return new Promise<OpResult[]>((resolve) => {
          release = resolve
        })
      }
      return ops.map((op) => ({ op_id: op.op_id, status: 'ok' }))
    })

    const inFlight = await outbox.enqueue({ entity: 'sets', id: setId, payload: { reps: 8 } })
    const draining = outbox.drain()
    await vi.waitFor(async () => {
      expect((await outbox.pending())[0].tries).toBe(1)
    })

    await outbox.enqueue({ entity: 'sets', id: setId, payload: { reps: 9 } })
    const pending = await outbox.pending()
    expect(pending).toHaveLength(2)
    expect(pending[0].payload).toEqual({ reps: 8 })
    expect(pending[1].payload).toEqual({ reps: 9 })

    release([{ op_id: inFlight.opId, status: 'ok' }])
    await draining
    expect(await outbox.pending()).toHaveLength(0)
    expect(batches).toHaveLength(2)
    expect(batches[1][0].op_id).not.toBe(inFlight.opId)
    expect(batches[1][0].payload).toEqual({ reps: 9 })
  })
})

describe('ordering', () => {
  it('drains in seq order regardless of the order rows are written back', async () => {
    const { transport, batches } = recordingTransport(allOk)
    const { outbox } = makeOutbox(transport)

    await outbox.enqueue({ entity: 'sessions', id: sessionId, payload: { title: 'Δύναμη' } })
    await outbox.enqueue({ entity: 'blocks', id: blockId, payload: { session_id: sessionId } })
    await outbox.enqueue({ entity: 'sets', id: setId, payload: { block_id: blockId } })
    // Editing the session again must not drag its insert behind the block that points at it.
    await outbox.enqueue({ entity: 'sessions', id: sessionId, payload: { notes: 'πόνος ώμου' } })

    await outbox.drain()
    expect(batches[0].map((op) => op.entity)).toEqual(['sessions', 'blocks', 'sets'])
    expect(batches[0].map((op) => op.seq)).toEqual([1, 2, 3])
  })

  it('never sends more than the server will accept in one batch', async () => {
    const { transport, batches } = recordingTransport(allOk)
    const { outbox } = makeOutbox(transport, { batchSize: 3 })
    for (let i = 0; i < 7; i += 1) {
      await outbox.enqueue({ entity: 'sets', id: newId(), payload: { position: i } })
    }

    const report = await outbox.drain()
    expect(batches.map((batch) => batch.length)).toEqual([3, 3, 1])
    expect(report.outcome).toBe('drained')
    expect(report.applied).toBe(7)
    expect(await outbox.pending()).toHaveLength(0)
  })

  it('carries the client instant of a delete so a flush at 19:00 is still a 07:12 deletion', async () => {
    const { transport, batches } = recordingTransport(allOk)
    const { outbox } = makeOutbox(transport)
    await outbox.enqueue({
      entity: 'sets',
      action: 'delete',
      id: setId,
      clientAt: '2026-08-29T07:12:00.000Z',
    })
    await outbox.drain()
    expect(batches[0][0]).toMatchObject({
      entity: 'sets',
      action: 'delete',
      id: setId,
      at: '2026-08-29T07:12:00.000Z',
    })
  })
})

describe('duplicate suppression', () => {
  it('treats a duplicate verdict as applied', async () => {
    const { outbox } = makeOutbox(
      recordingTransport((ops) => ops.map((op) => ({ op_id: op.op_id, status: 'duplicate' })))
        .transport,
    )
    await outbox.enqueue({ entity: 'sets', id: setId, payload: { reps: 8 } })

    const report = await outbox.drain()
    expect(report.duplicate).toBe(1)
    expect(report.applied).toBe(0)
    expect(await outbox.pending()).toHaveLength(0)
    expect(await outbox.dead()).toHaveLength(0)
  })

  // The lost-response case: the server applied it, we never heard. The replay must carry the
  // same op_id or apply_ops has no way to recognise it and writes the set twice.
  it('replays a lost batch under the same op ids', async () => {
    const seen: WireOp[][] = []
    let firstAttempt = true
    const { outbox } = makeOutbox(async (_gym, ops) => {
      seen.push(ops)
      if (firstAttempt) {
        firstAttempt = false
        throw new OutboxTransportError('network error')
      }
      return ops.map((op) => ({ op_id: op.op_id, status: 'duplicate' }))
    })

    const op = await outbox.enqueue({ entity: 'sets', id: setId, payload: { reps: 8 } })
    const failed = await outbox.drain()
    expect(failed.outcome).toBe('failed')

    const retried = await outbox.drain({ force: true })
    expect(seen).toHaveLength(2)
    expect(seen[0][0].op_id).toBe(op.opId)
    expect(seen[1][0].op_id).toBe(op.opId)
    expect(retried.duplicate).toBe(1)
    expect(await outbox.pending()).toHaveLength(0)
  })
})

describe('dead-lettering', () => {
  it('moves a rejected op to the dead-letter store and keeps the rest of the batch', async () => {
    const badId = newId()
    const goodId = newId()
    const { outbox } = makeOutbox(
      recordingTransport((ops) =>
        ops.map((op) =>
          op.id === badId
            ? { op_id: op.op_id, status: 'rejected', reason: 'row not found or not permitted', code: '42501' }
            : { op_id: op.op_id, status: 'ok' },
        ),
      ).transport,
    )
    await outbox.enqueue({ entity: 'sets', id: goodId, payload: { reps: 8 } })
    await outbox.enqueue({ entity: 'sets', id: badId, payload: { reps: 9 } })

    const report = await outbox.drain()
    expect(report.applied).toBe(1)
    expect(report.rejected).toBe(1)
    expect(await outbox.pending()).toHaveLength(0)

    const dead = await outbox.dead()
    expect(dead).toHaveLength(1)
    expect(dead[0].entityId).toBe(badId)
    expect(dead[0].reason).toBe('row not found or not permitted')
    expect(dead[0].code).toBe('42501')
    // The banner reads this, so it has to be true without another round-trip.
    expect(outbox.status().dead).toBe(1)
  })

  it('gives up after the retry bound rather than retrying forever', async () => {
    let attempts = 0
    const { outbox } = makeOutbox(async () => {
      attempts += 1
      throw new OutboxTransportError('Failed to fetch')
    }, { maxTries: 3 })
    await outbox.enqueue({ entity: 'sets', id: setId, payload: { reps: 8 } })

    for (let i = 0; i < 6; i += 1) await outbox.drain({ force: true })

    expect(attempts).toBe(3)
    expect(await outbox.pending()).toHaveLength(0)
    const dead = await outbox.dead()
    expect(dead).toHaveLength(1)
    expect(dead[0].tries).toBe(3)
    expect(dead[0].code).toBe('transport')
  })

  it('dead-letters the whole batch when the failure can never resolve itself', async () => {
    const { outbox } = makeOutbox(async () => {
      throw new OutboxTransportError('not an active member of this gym', {
        permanent: true,
        code: '42501',
      })
    })
    await outbox.enqueue({ entity: 'sets', id: setId, payload: { reps: 8 } })
    await outbox.enqueue({ entity: 'sets', id: newId(), payload: { reps: 9 } })

    const report = await outbox.drain()
    expect(report.outcome).toBe('failed')
    expect(await outbox.pending()).toHaveLength(0)
    expect(await outbox.dead()).toHaveLength(2)
  })

  it('re-queues a dead letter under a fresh op id', async () => {
    const { outbox } = makeOutbox(
      recordingTransport((ops) =>
        ops.map((op) => ({ op_id: op.op_id, status: 'rejected', reason: 'nope' })),
      ).transport,
    )
    const original = await outbox.enqueue({ entity: 'sets', id: setId, payload: { reps: 8 } })
    await outbox.drain()

    const requeued = await outbox.retryDead(original.opId)
    expect(requeued).not.toBeNull()
    // A fresh op id: the original may already sit in applied_ops from an attempt whose
    // response was lost, and reusing it would come back `duplicate` and drop the write again.
    expect(requeued?.opId).not.toBe(original.opId)
    expect(requeued?.payload).toEqual({ reps: 8 })
    expect(await outbox.dead()).toHaveLength(0)
    expect(await outbox.pending()).toHaveLength(1)
  })
})

describe('a failed drain', () => {
  it('leaves the queue intact, in order, with everything still there', async () => {
    const { outbox, storage } = makeOutbox(async () => {
      throw new OutboxTransportError('Failed to fetch')
    })
    await outbox.enqueue({ entity: 'sessions', id: sessionId, payload: { title: 'Δύναμη' } })
    await outbox.enqueue({ entity: 'blocks', id: blockId, payload: { session_id: sessionId } })
    await outbox.enqueue({ entity: 'sets', id: setId, payload: { block_id: blockId, reps: 8 } })

    const report = await outbox.drain()
    expect(report.outcome).toBe('failed')
    expect(report.error).toBe('Failed to fetch')

    const pending = await outbox.pending()
    expect(pending.map((op) => op.entityId)).toEqual([sessionId, blockId, setId])
    expect(pending.map((op) => op.seq)).toEqual([1, 2, 3])
    expect(pending.every((op) => op.tries === 1)).toBe(true)
    expect(await outbox.dead()).toHaveLength(0)
    // On disk, not merely in memory: the point of the queue is surviving a reload.
    expect(storage.raw.has(outboxKey(GYM))).toBe(true)

    // And a backoff window is armed, so the next trigger does not hammer a dead endpoint.
    expect(outbox.status().retryAt).toBeGreaterThan(0)
    expect((await outbox.drain()).outcome).toBe('backoff')
  })

  it('keeps an op the server said nothing about', async () => {
    // A verdict for the first op and silence about the second — a truncated response, which
    // must never be read as permission to forget the set the coach typed.
    const { outbox } = makeOutbox(
      recordingTransport((ops) =>
        ops
          .filter((op) => op.payload.reps === 8)
          .map((op) => ({ op_id: op.op_id, status: 'ok' })),
      ).transport,
    )
    const answered = await outbox.enqueue({ entity: 'sets', id: setId, payload: { reps: 8 } })
    const silent = await outbox.enqueue({ entity: 'sets', id: newId(), payload: { reps: 9 } })

    const report = await outbox.drain()
    expect(report.applied).toBe(1)
    const pending = await outbox.pending()
    expect(pending.map((op) => op.opId)).toEqual([silent.opId])
    expect(pending[0].opId).not.toBe(answered.opId)
    expect(await outbox.dead()).toHaveLength(0)
  })

  it('reports offline without touching the queue', async () => {
    const { outbox } = makeOutbox(
      async () => {
        throw new Error('the transport must not be called while offline')
      },
      { isOnline: () => false },
    )
    await outbox.enqueue({ entity: 'sets', id: setId, payload: { reps: 8 } })
    const report = await outbox.drain()
    expect(report.outcome).toBe('offline')
    expect((await outbox.pending())[0].tries).toBe(0)
  })
})

describe('persistence', () => {
  it('survives a reload, and a second outbox picks the queue up mid-flight', async () => {
    const storage = memoryStorage()
    const first = createOutbox({ gymId: GYM, transport: async () => [], storage })
    await first.enqueue({ entity: 'sets', id: setId, payload: { reps: 8 } })

    const { transport, batches } = recordingTransport(allOk)
    const second = createOutbox({
      gymId: GYM,
      transport,
      storage,
      isOnline: () => true,
      schedule: () => () => undefined,
    })
    expect(await second.pending()).toHaveLength(1)
    await second.drain()
    expect(batches[0][0].id).toBe(setId)
  })

  it('clear() wipes both stores — a removed membership can never flush its ops', async () => {
    const { outbox, storage } = makeOutbox(
      recordingTransport((ops) =>
        ops.map((op) => ({ op_id: op.op_id, status: 'rejected', reason: 'nope' })),
      ).transport,
    )
    await outbox.enqueue({ entity: 'sets', id: setId, payload: { reps: 8 } })
    await outbox.drain()
    expect(storage.raw.has(deadLetterKey(GYM))).toBe(true)

    await outbox.clear()
    expect(storage.raw.has(outboxKey(GYM))).toBe(false)
    expect(storage.raw.has(deadLetterKey(GYM))).toBe(false)
    expect(outbox.status()).toMatchObject({ pending: 0, dead: 0 })
  })

  it('notifies subscribers so the banner can show a pending count', async () => {
    const { outbox } = makeOutbox(recordingTransport(allOk).transport)
    const seen: number[] = []
    const off = outbox.subscribe((status) => seen.push(status.pending))
    await outbox.enqueue({ entity: 'sets', id: setId, payload: { reps: 8 } })
    await outbox.drain()
    off()
    expect(seen[0]).toBe(1)
    expect(seen.at(-1)).toBe(0)
  })
})
