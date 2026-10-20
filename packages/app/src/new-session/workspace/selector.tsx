import { For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import { Tooltip } from "@opencode/ui/tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import type { NewSessionWorkspaceController } from "./controller"

export function NewSessionBranch(props: { workspace: NewSessionWorkspaceController; onDone: () => void }) {
  const language = useLanguage()

  const [state, setState] = createStore<{ search: string; truncated: boolean; pending?: string }>({
    search: "",
    truncated: false,
  })

  let input: HTMLInputElement | undefined
  const creating = () => props.workspace.selection.value() === "create"

  const label = () =>
    creating()
      ? language.t("session.new.workspace.fromBranch", { branch: props.workspace.bar.branch() ?? "" })
      : props.workspace.bar.branch()

  const observe = (element: HTMLSpanElement) =>
    createResizeObserver(element, () => setState("truncated", element.scrollWidth > element.clientWidth))

  return (
    <Show when={props.workspace.bar.branch()}>
      <Tooltip
        placement="top"
        value={label()}
        disabled={!state.truncated}
        class="flex min-w-0 max-w-[220px]"
        contentClass="max-w-[calc(100vw-32px)] break-all"
      >
        <Show
          when={creating()}
          fallback={
            <div class="flex h-7 min-w-0 max-w-[220px] items-center gap-1.5 ps-1.5 pe-2 text-v2-text-text-faint">
              <Icon name="branch" size="small" class="shrink-0 text-v2-icon-icon-faint" />
              <span ref={observe} dir="auto" class="min-w-0 truncate">
                {label()}
              </span>
            </div>
          }
        >
          <Menu
            placement="bottom-start"
            gutter={4}
            onOpenChange={(open) => {
              props.workspace.branches.open(open)

              if (open) {
                setState({ search: "", pending: undefined })

                return
              }

              if (state.pending) props.workspace.selection.branch(state.pending)
              setState("pending", undefined)
              props.onDone()
            }}
          >
            <Menu.Trigger class="flex h-7 min-w-0 max-w-[220px] items-center gap-1.5 rounded-sm px-1.5 text-v2-text-text-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:text-v2-text-text-base focus-visible:outline-none data-[expanded]:bg-v2-overlay-simple-overlay-pressed data-[expanded]:text-v2-text-text-base">
              <Icon name="branch-out" size="small" class="shrink-0 text-v2-icon-icon-muted" />
              <span ref={observe} dir="auto" class="min-w-0 truncate">
                {label()}
              </span>
              <Icon name="chevron-down" size="small" class="-ms-0.5 shrink-0 text-v2-icon-icon-muted" />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content
                class="w-[243px] overflow-hidden rounded-md border-0 bg-v2-background-bg-layer-01 shadow-[var(--v2-elevation-floating)] focus:outline-none"
                onOpenAutoFocus={(event) => {
                  event.preventDefault()
                  // Kobalte schedules list autofocus after the focus scope opens.
                  setTimeout(() => requestAnimationFrame(() => input?.focus({ preventScroll: true })))
                }}
              >
                <div class="flex h-7 shrink-0 items-center gap-2 rounded-sm ps-3 pe-1 text-v2-icon-icon-muted">
                  <Icon name="magnifying-glass" size="small" class="shrink-0" />
                  <input
                    ref={input}
                    value={state.search}
                    placeholder={language.t("session.new.workspace.branch.search.placeholder")}
                    aria-label={language.t("session.new.workspace.branch.search.placeholder")}
                    autocomplete="off"
                    class="h-7 min-w-0 flex-1 border-0 bg-transparent text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
                    onInput={(event) => {
                      setState("search", event.currentTarget.value)
                      props.workspace.branches.search(event.currentTarget.value)
                    }}
                    onKeyDown={(event) => {
                      if (["Escape", "ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return
                      event.stopPropagation()
                    }}
                  />
                  <Show when={state.search.trim()}>
                    <button
                      type="button"
                      class="flex size-5 shrink-0 items-center justify-center rounded-sm text-v2-icon-icon-faint hover:text-v2-icon-icon-base focus-visible:text-v2-icon-icon-base"
                      aria-label={language.t("common.clear")}
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setState("search", "")
                        props.workspace.branches.search("")
                        input?.focus()
                      }}
                    >
                      <Icon name="circle-xmark" />
                    </button>
                  </Show>
                </div>
                <div class="max-h-[224px] overflow-y-auto">
                  <Show
                    when={!props.workspace.branches.failed()}
                    fallback={
                      <Menu.Item closeOnSelect={false} onSelect={() => void props.workspace.branches.retry()}>
                        {language.t("common.retry")}
                      </Menu.Item>
                    }
                  >
                    <Show
                      when={props.workspace.branches.items().length > 0}
                      fallback={
                        <div class="px-3 py-2 text-v2-text-text-faint">
                          {language.t(props.workspace.branches.loading() ? "common.loading" : "palette.empty")}
                        </div>
                      }
                    >
                      <Menu.RadioGroup value={props.workspace.bar.branch()}>
                        <For each={props.workspace.branches.items()}>
                          {(branch) => (
                            <Menu.RadioItem
                              value={branch}
                              closeOnSelect
                              class="h-7 gap-2 rounded-sm px-3 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-base data-[highlighted]:!bg-v2-overlay-simple-overlay-hover"
                              onSelect={() => setState("pending", branch)}
                            >
                              <span dir="auto" class="min-w-0 truncate leading-5">
                                {branch}
                              </span>
                            </Menu.RadioItem>
                          )}
                        </For>
                      </Menu.RadioGroup>
                    </Show>
                  </Show>
                </div>
              </Menu.Content>
            </Menu.Portal>
          </Menu>
        </Show>
      </Tooltip>
    </Show>
  )
}
