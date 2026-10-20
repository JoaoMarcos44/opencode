import { createMemo, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createSizing } from "./helpers"
import type { SessionModel } from "./model"
import { clampSessionPanelWidth, sessionPanelWidthMax } from "./session-panel-width"

/** wide asks for the wider session minimum. */
export function createSessionScreenLayout(session: SessionModel, input: { wide: Accessor<boolean> }) {
  const size = createSizing()
  const view = session.layout.view
  const tabsOpen = createMemo(() => session.isDesktop() && view().side.opened() && !!session.identity.params.id)

  const [rowSize, setRowSize] = createStore<{ width?: number }>({})
  let row: HTMLDivElement | undefined
  createResizeObserver(
    () => row,
    ({ width }) => setRowSize({ width }),
  )

  const available = createMemo<number | undefined>(() => {
    const width = rowSize.width

    if (width === undefined) return undefined

    return width - 8
  })

  const splitSide = createMemo(() => tabsOpen() && input.wide())

  const resizedWidth = createMemo(() =>
    clampSessionPanelWidth({
      width: view().session.width(),
      available: available(),
      split: splitSide(),
      resized: view().session.resized(),
    }),
  )

  const panelWidth = createMemo(() => {
    if (!tabsOpen()) return "100%"

    return `${resizedWidth()}px`
  })

  const panelMax = createMemo(() => {
    const width = available()

    if (width === undefined) return 1000

    return sessionPanelWidthMax({ available: width, split: splitSide(), resized: true })
  })

  const sideContentWidth = createMemo<string>((previous) => {
    const width = available()

    if (tabsOpen() && width !== undefined) return `${Math.max(0, width - resizedWidth())}px`

    return previous
  }, "100%")

  return {
    centered: createMemo(() => session.isDesktop()),
    panel: {
      max: panelMax,
      ref: (element: HTMLDivElement) => {
        row = element
      },
      resizable: tabsOpen,
      resizedWidth,
      width: panelWidth,
    },
    side: {
      contentWidth: sideContentWidth,
      open: tabsOpen,
      tabs: { open: tabsOpen },
    },
    size,
  }
}

export type SessionScreenLayout = ReturnType<typeof createSessionScreenLayout>
