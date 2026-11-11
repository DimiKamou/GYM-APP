import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import { Tabs, useTabParam } from '@/ui/Tabs'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const IDS = ['one', 'two', 'three'] as const

function Harness() {
  const [tab, setTab] = useTabParam(IDS, 'one')
  return (
    <Tabs
      label="sections"
      value={tab}
      onChange={setTab}
      tabs={IDS.map((id) => ({ id, label: id.toUpperCase(), badge: id === 'two' ? 4 : 0 }))}
    >
      {(open) => <p>panel-{open}</p>}
    </Tabs>
  )
}

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  const r = root
  if (r) act(() => r.unmount())
  host?.remove()
  root = null
})

function mount(path = '/x') {
  const router = createMemoryRouter([{ path: '/x', element: <Harness /> }], { initialEntries: [path] })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root?.render(<RouterProvider router={router} />))
  return { router, el: host }
}

const tabs = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLButtonElement>('[role="tab"]'))

describe('tabs', () => {
  it('opens the tab the address names, and only mounts that panel', () => {
    const { el } = mount('/x?tab=three')
    expect(el.querySelector('[role="tabpanel"]')?.textContent).toBe('panel-three')
    expect(tabs(el)[2].getAttribute('aria-selected')).toBe('true')
    expect(el.textContent).not.toContain('panel-one')
  })

  it('replaces the address instead of pushing, and drops the param for the first tab', () => {
    const { el, router } = mount()
    act(() => tabs(el)[1].click())
    expect(router.state.location.search).toBe('?tab=two')
    expect(router.state.historyAction).toBe('REPLACE')
    act(() => tabs(el)[0].click())
    expect(router.state.location.search).toBe('')
  })

  it('walks with the arrow keys, wrapping at the ends, with one tab stop', () => {
    const { el } = mount()
    expect(tabs(el).map((t) => t.tabIndex)).toEqual([0, -1, -1])
    act(() => {
      tabs(el)[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    })
    expect(el.querySelector('[role="tabpanel"]')?.textContent).toBe('panel-three')
  })

  it('shows a badge only where there is something to count', () => {
    const { el } = mount()
    expect(tabs(el)[1].textContent).toBe('TWO4')
    expect(tabs(el)[0].textContent).toBe('ONE')
  })

  it('moves to the next tab on a sideways flick, and ignores a vertical scroll', () => {
    const { el } = mount()
    const panel = () => el.querySelector('[role="tabpanel"]') as HTMLElement
    // jsdom has no PointerEvent; a MouseEvent under the pointer event's name reaches React's
    // handler the same way, with no pointerType — which the component treats as touch.
    const flick = (dx: number, dy: number) => {
      act(() => {
        panel().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 200 }))
      })
      act(() => {
        panel().dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 200 + dx, clientY: 200 + dy }))
      })
    }
    flick(-20, 160)
    expect(panel().textContent).toBe('panel-one')
    flick(-120, 10)
    expect(panel().textContent).toBe('panel-two')
    flick(120, 0)
    expect(panel().textContent).toBe('panel-one')
  })
})
