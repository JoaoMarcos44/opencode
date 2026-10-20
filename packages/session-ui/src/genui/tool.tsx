import { createMemo, Show } from "solid-js"
import { Option, Schema } from "effect"
import { GenUI } from "@opencode/plugin-genui/genui"
import { useI18n } from "@opencode/ui/context/i18n"
import { Icon } from "@opencode/ui/icon"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { useData } from "../context/data"
import { ToolRegistry, type ToolProps } from "../tools/tool-renderer"
import { createReplySender } from "./reply"
import { genuiReplyText, GenUISurface, type GenUIReply } from "./surface"

const decodeInput = Schema.decodeUnknownOption(GenUI.RenderInput)

/** A `genui_render` call in the timeline: the surface itself, drawn while its program streams in. */
// ToolDisplay passes the tool call ID along with the props every tool gets.
function GenUITool(props: ToolProps & { id?: string }) {
  const i18n = useI18n()
  const data = useData()
  const input = createMemo(() => Option.getOrElse(decodeInput(props.input), (): GenUI.RenderInput => ({})))
  const writing = () => props.status === "streaming" || props.status === "running" || props.status === "pending"

  // Durable: the reply is a prompt in the session, so the surface stays sent after a reload or remount.
  const sent = createMemo(() => {
    const sessionID = data.sessionID

    if (!sessionID || !props.id) return undefined

    return GenUI.replyTo(props.id, data.promptMetadata?.(sessionID) ?? [])
  })

  const sender = createReplySender({
    sent: () => sent() !== undefined,
    send: (value: GenUIReply) => {
      const prompt = data.prompt
      const sessionID = data.sessionID

      if (!prompt || !sessionID || !props.id) return Promise.resolve()

      const heading = i18n.t("ui.genui.submitted", { title: input().title ?? i18n.t("ui.genui.title") })

      return prompt({
        sessionID,
        text: genuiReplyText(value, heading),
        metadata: { [GenUI.REPLY_METADATA]: { callID: props.id, fields: { ...value.fields } } },
      })
    },
  })

  return (
    <div data-component="genui-inline" data-writing={writing() || undefined}>
      <div data-slot="genui-inline-header">
        <span data-slot="genui-row-icon">
          <Icon name="window-analytics" size="small" />
        </span>
        <span data-slot="genui-inline-title">{input().title ?? i18n.t("ui.genui.title")}</span>
        <Show when={writing()}>
          <span data-slot="genui-inline-status">
            <TextShimmer text={i18n.t("ui.genui.writing")} active />
          </span>
        </Show>
      </div>
      <Show when={input().code}>
        {(code) => (
          <div data-slot="genui-inline-body">
            <GenUISurface
              code={code()}
              streaming={writing()}
              busy={!data.prompt || !props.id || sender.sending() || sent() !== undefined}
              sent={sent()?.fields}
              failed={sender.failed()}
              onReply={sender.send}
              onOpen={(url) => {
                if (/^https?:\/\//iu.test(url)) window.open(url, "_blank", "noopener,noreferrer")
              }}
            />
          </div>
        )}
      </Show>
    </div>
  )
}

ToolRegistry.register({ name: GenUI.RENDER_TOOL, render: GenUITool })
