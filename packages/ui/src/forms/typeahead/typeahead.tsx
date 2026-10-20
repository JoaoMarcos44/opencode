import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createEffect, createSignal, createUniqueId, For, type JSX, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@opencode/ui/icon"
import { useI18n } from "../../context/i18n"
import { Spinner } from "../../components/spinner"
import { springStyle } from "../../motion/solid"
import { createTypeahead, type TypeaheadOptions } from "./controller"
import "./typeahead.css"

export { createTypeahead, retainTypeaheadResults } from "./controller"

export type { TypeaheadController, TypeaheadSource } from "./controller"

// A pending hint that appears only for requests slower than this never flickers on fast responses.
const PENDING_HINT_DELAY = 150

// Height follows the results on a critically damped spring (duration .3 s, bounce 0).
const HEIGHT_SPRING = { omega: (2 * Math.PI) / 0.3, zeta: 1 }

export type TypeaheadProps<T> = Omit<TypeaheadOptions<T>, "query"> & {
  placeholder: string
  emptyLabel?: string
  clearLabel?: string
  retryLabel?: string
  /** Key of the current value, which shows a check. */
  selected?: string
  inputRef?: (element: HTMLInputElement) => void
  class?: string
  children: (item: T) => JSX.Element
}

/** A search field above a list of options that keeps its results on screen while a query is pending. */
export function Typeahead<T>(props: TypeaheadProps<T>) {
  const i18n = useI18n()
  const id = createUniqueId()
  const [store, setStore] = createStore({ query: "", hint: false, overflow: false })
  const [frame, setFrame] = createSignal<HTMLDivElement>()
  const [content, setContent] = createSignal<HTMLDivElement>()
  const [height, setHeight] = createSignal<number>()
  let input: HTMLInputElement | undefined

  const typeahead = createTypeahead<T>({
    get items() {
      return props.items
    },
    get source() {
      return props.source
    },
    get match() {
      return props.match
    },
    get delay() {
      return props.delay
    },
    get onClose() {
      return props.onClose
    },
    query: () => store.query,
    key: (item) => props.key(item),
    onSelect: (item) => props.onSelect(item),
  })

  createEffect(() => {
    if (!typeahead.pending()) return setStore("hint", false)
    const timer = setTimeout(() => setStore("hint", true), PENDING_HINT_DELAY)
    onCleanup(() => clearTimeout(timer))
  })

  createResizeObserver(content, (rect) => setHeight(rect.height))
  springStyle<string>(
    frame,
    // The first measurement is the resting height, so opening never animates.
    () => {
      const value = height()
      const targets: Record<string, number> = {}

      if (value !== undefined) targets.height = value

      return targets
    },
    (element, values) => {
      if ("height" in values) element.style.height = `${values.height}px`
    },
    HEIGHT_SPRING,
  )

  let scroller: HTMLDivElement | undefined

  const overflow = () => {
    if (!scroller) return
    setStore("overflow", scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1)
  }

  createEffect(() => {
    const key = typeahead.active()

    typeahead.items()
    overflow()

    if (key === undefined) return

    const handle = requestAnimationFrame(() =>
      scroller?.querySelector("[data-active]")?.scrollIntoView({ block: "nearest" }),
    )

    onCleanup(() => cancelAnimationFrame(handle))
  })

  const option = (index: number) => `${id}-option-${index}`

  const activeOption = () => {
    const index = typeahead.items().findIndex((item) => item === typeahead.activeItem())

    return index < 0 ? undefined : option(index)
  }

  const setQuery = (query: string) => {
    setStore("query", query)
    typeahead.setActive(undefined)
  }

  return (
    <div data-component="typeahead" class={props.class}>
      <div data-slot="typeahead-field">
        <span data-slot="typeahead-glyph" data-pending={store.hint ? "" : undefined} aria-hidden="true">
          <Icon name="magnifying-glass" size="small" data-slot="typeahead-search-icon" />
          <Spinner data-slot="typeahead-spinner" />
        </span>
        <input
          ref={(element) => {
            input = element
            props.inputRef?.(element)
          }}
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-listbox`}
          aria-autocomplete="list"
          aria-busy={typeahead.pending()}
          aria-activedescendant={activeOption()}
          aria-label={props.placeholder}
          placeholder={props.placeholder}
          value={store.query}
          autocomplete="off"
          spellcheck={false}
          onInput={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={typeahead.onKeyDown}
        />
        <Show when={store.query}>
          <button
            type="button"
            data-slot="typeahead-clear"
            aria-label={props.clearLabel ?? i18n.t("ui.list.clearFilter")}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              setQuery("")
              input?.focus()
            }}
          >
            <Icon name="circle-xmark" size="small" />
          </button>
        </Show>
      </div>
      <div ref={setFrame} data-slot="typeahead-frame">
        <div ref={setContent}>
          <div
            ref={(element) => (scroller = element)}
            id={`${id}-listbox`}
            role="listbox"
            data-slot="typeahead-list"
            data-overflow={store.overflow ? "" : undefined}
            onScroll={overflow}
          >
            <For each={typeahead.items()}>
              {(item, index) => (
                <div
                  id={option(index())}
                  role="option"
                  data-slot="typeahead-option"
                  aria-selected={typeahead.activeItem() === item}
                  data-active={typeahead.activeItem() === item ? "" : undefined}
                  data-stale={typeahead.stale(item) ? "" : undefined}
                  onMouseMove={(event) => {
                    // A static cursor must not steal the active row while the keyboard scrolls the list.
                    if (event.movementX === 0 && event.movementY === 0) return
                    typeahead.setActive(props.key(item))
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => props.onSelect(item)}
                >
                  {props.children(item)}
                  <Show when={props.selected === props.key(item)}>
                    <Icon name="check" size="small" data-slot="typeahead-check" />
                  </Show>
                </div>
              )}
            </For>
          </div>
          <Show when={typeahead.items().length === 0 && !typeahead.pending()}>
            <Show
              when={typeahead.failed() && props.retryLabel}
              fallback={<div data-slot="typeahead-empty">{props.emptyLabel ?? i18n.t("ui.list.empty")}</div>}
            >
              <button
                type="button"
                data-slot="typeahead-retry"
                onMouseDown={(event) => event.preventDefault()}
                onClick={typeahead.retry}
              >
                {props.retryLabel}
              </button>
            </Show>
          </Show>
        </div>
      </div>
    </div>
  )
}
