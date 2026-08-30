/**
 * The repository, through context.
 *
 * The module-level `repo` in `./index` is the one the app runs on; the context exists so a
 * test can mount a screen against a `createLocalRepo({ seed })` with fixed data and no
 * IndexedDB, without a module mock. A provider is also the seam a second gym would need one
 * day, when a covering coach can switch between two workspaces in one session.
 *
 * `createElement` rather than JSX because this file is `.ts`: the provider is three lines and
 * does not earn a `.tsx` and its own build entry.
 */

import { createContext, createElement, useContext, type ReactNode } from 'react'

import { repo as defaultRepo } from '@/data/repo/index'
import type { Repo } from '@/data/repo/types'

const RepoContext = createContext<Repo>(defaultRepo)

export function RepoProvider({
  repo = defaultRepo,
  children,
}: {
  repo?: Repo
  children: ReactNode
}): JSX.Element {
  return createElement(RepoContext.Provider, { value: repo }, children)
}

/**
 * Defaults to the app's real repository rather than throwing when no provider is mounted:
 * every screen needs data, and a missing provider must not be the thing that white-screens a
 * coach mid-session. A test that wants fixtures mounts `<RepoProvider repo={…}>` explicitly.
 */
export function useRepo(): Repo {
  return useContext(RepoContext)
}

/** "Which backend am I on" — the Settings screen says this out loud. */
export function useRepoKind(): Repo['kind'] {
  return useRepo().kind
}
