import { NIL as NIL_UUID, v7 as uuidv7, validate as uuidValidate } from 'uuid'

import type { Uuid } from '@/domain/types'

/**
 * Every id in TrainHub is minted here, on the client, as a UUIDv7.
 *
 * Client-minted because an offline insert cannot wait for a round-trip to learn its own
 * primary key: the coach types the second set before the first one has a server id.
 * Version 7 because its leading 48 bits are a millisecond timestamp, so ids sort in
 * creation order as plain strings — which is what makes `(position, id)` a stable
 * tie-break between two devices that both minted position 3.
 */
export function newId(): Uuid {
  return uuidv7()
}

/**
 * Well-formed *and* usable as a row id. The nil UUID passes RFC validation but is what an
 * uninitialised variable looks like once it has been through `String()`; letting it into a
 * payload writes a row nobody can ever address again.
 */
export function isUuid(value: unknown): value is Uuid {
  return typeof value === 'string' && value !== NIL_UUID && uuidValidate(value)
}
