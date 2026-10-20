import { createEffect, createMemo, createResource, createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"

export type TypeaheadSource<T> = (query: string, signal: AbortSignal) => Promise<T[]>

export type TypeaheadResult<T> = { query: string; items: T[]; failed: boolean }

export type TypeaheadOptions<T> = {
  query: () => string
  /** Results known without waiting, such as commands or a fixed list. */
  items?: (query: string) => T[]
  /** Results that need a request. */
  source?: TypeaheadSource<T>
  key: (item: T) => string
  /** Narrows earlier source results while the request for the current query is pending. */
  match?: (item: T, query: string) => boolean
  /** Milliseconds a typed query waits before it reaches the source. An empty query searches at once. */
  delay?: number
  onSelect: (item: T) => void
  onClose?: () => void
}

/**
 * What a pending query shows from earlier source results: the answer to the same query, rows that still match, else
 * the rows already on screen, marked stale. Clearing or refining a query never collapses the list while its request
 * is in flight.
 */
export function retainTypeaheadResults<T>(input: {
  query: string
  result: TypeaheadResult<T>
  /** Earlier answers by query. */
  cache: Record<string, T[]>
  seen: T[]
  /** The source rows on screen now. */
  shown: T[]
  key: (item: T) => string
  match?: (item: T, query: string) => boolean
}) {
  if (input.result.query === input.query) return { items: input.result.items, stale: false }
  const cached = input.cache[input.query]

  if (cached) return { items: cached, stale: false }
  const match = input.match

  if (match) {
    const matched = unique([...input.result.items, ...input.seen], input.key).filter((item) => match(item, input.query))

    if (matched.length > 0) return { items: matched, stale: false }
  }

  const items = input.shown.length > 0 ? input.shown : input.result.items

  return { items, stale: items.length > 0 }
}

/** Results, the active row and keyboard handling for a search field above a list of options. */
export function createTypeahead<T>(props: TypeaheadOptions<T>) {
  const [store, setStore] = createStore<{ searched: string; active?: string }>({ searched: props.query().trim() })

  // Earlier answers stay outside the store so items keep their identity instead of becoming store proxies.
  const [history, setHistory] = createSignal<{ seen: T[]; cache: Record<string, T[]> }>({ seen: [], cache: {} })

  const query = createMemo(() => props.query().trim())
  const empty: TypeaheadResult<T> = { query: "", items: [], failed: false }

  createEffect(() => {
    const next = query()
    const timer = setTimeout(() => setStore("searched", next), next ? (props.delay ?? 0) : 0)
    onCleanup(() => clearTimeout(timer))
  })

  let abort: AbortController | undefined
  onCleanup(() => abort?.abort())

  const [result, actions] = createResource(
    () => (props.source ? store.searched : undefined),
    async (searched, info): Promise<TypeaheadResult<T>> => {
      abort?.abort()
      const current = new AbortController()
      abort = current
      const previous = info.value ?? empty

      return (props.source?.(searched, current.signal) ?? Promise.resolve([])).then(
        (items) => {
          if (current.signal.aborted) return previous
          setHistory((previous) => ({
            seen: unique([...items, ...previous.seen], props.key).slice(0, 500),
            cache: { ...previous.cache, [searched]: items },
          }))

          return { query: searched, items, failed: false }
        },
        () => (current.signal.aborted ? previous : { query: searched, items: [], failed: true }),
      )
    },
  )

  // `latest` suspends until the first response, so read it only once the resource has settled.
  const settled = () => (result.state === "ready" || result.state === "refreshing" ? result.latest : undefined)

  const remote = createMemo<{ items: T[]; stale: boolean }>((previous) => {
    const loaded = settled()

    if (!props.source || !loaded) return { items: [], stale: false }

    return retainTypeaheadResults({
      query: query(),
      result: loaded,
      cache: history().cache,
      seen: history().seen,
      shown: previous?.items ?? [],
      key: props.key,
      match: props.match,
    })
  })

  const items = createMemo<T[]>((previous) => {
    const next = unique([...(props.items?.(query()) ?? []), ...remote().items], props.key)

    return previous && previous.length === next.length && previous.every((item, index) => item === next[index])
      ? previous
      : next
  })

  const pending = () => !!props.source && (store.searched !== query() || result.loading)

  const activeItem = createMemo(() => items().find((item) => props.key(item) === store.active) ?? items()[0])

  const move = (to: "next" | "previous" | "first" | "last") => {
    const list = items()

    if (list.length === 0) return
    const index = list.findIndex((item) => item === activeItem())

    const target = {
      next: (index + 1) % list.length,
      previous: (index - 1 + list.length) % list.length,
      first: 0,
      last: list.length - 1,
    }[to]

    setStore("active", props.key(list[target]))
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing) return
    const direction = keyDirection(event)

    if (direction) {
      event.preventDefault()
      event.stopPropagation()
      move(direction)

      return
    }

    if (event.key === "Enter") {
      const item = activeItem()

      event.preventDefault()
      event.stopPropagation()

      if (item !== undefined) props.onSelect(item)

      return
    }

    if (event.key === "Escape" && props.onClose) {
      event.preventDefault()
      event.stopPropagation()
      props.onClose()
    }
  }

  return {
    items,
    pending,
    /** The row is an earlier result that the pending query has not confirmed. */
    stale: (item: T) => remote().stale && remote().items.includes(item),
    failed: () => settled()?.query === query() && settled()?.failed === true,
    activeItem,
    active: () => {
      const item = activeItem()

      return item === undefined ? undefined : props.key(item)
    },
    /** The row the user chose with the pointer or keyboard; until then the first row is active. */
    chosen: () => store.active,
    setActive: (key: string | undefined) => setStore("active", key),
    move,
    onKeyDown,
    retry: () => void actions.refetch(),
  }
}

export type TypeaheadController<T> = ReturnType<typeof createTypeahead<T>>

function keyDirection(event: KeyboardEvent) {
  const modified = event.altKey || event.metaKey || event.ctrlKey || event.shiftKey

  if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    if (event.key === "n") return "next"

    if (event.key === "p") return "previous"
  }

  if (modified) return

  if (event.key === "ArrowDown") return "next"

  if (event.key === "ArrowUp") return "previous"

  if (event.key === "Home") return "first"

  if (event.key === "End") return "last"
}

function unique<T>(items: T[], key: (item: T) => string) {
  const seen = new Set<string>()

  return items.filter((item) => {
    const id = key(item)

    if (seen.has(id)) return false
    seen.add(id)

    return true
  })
}
