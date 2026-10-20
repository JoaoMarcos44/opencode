import { describe, expect, test } from "bun:test"
import { GenUI } from "../src/genui"

describe("GenUI.replyTo", () => {
  test("finds the reply a render call received among the session's prompts", () => {
    const reply = { callID: "call_form", fields: { scope: "B", tests: true } }

    expect(
      GenUI.replyTo("call_form", [
        undefined,
        { genui: true },
        { [GenUI.REPLY_METADATA]: { callID: "call_other", fields: {} } },
        { genui: true, [GenUI.REPLY_METADATA]: reply },
      ]),
    ).toEqual(reply)
  })

  test("a call nobody answered, or a malformed reply, has none", () => {
    expect(GenUI.replyTo("call_form", [{ genui: true }])).toBeUndefined()
    expect(GenUI.replyTo("call_form", [{ [GenUI.REPLY_METADATA]: { callID: "call_form" } }])).toBeUndefined()
  })
})
