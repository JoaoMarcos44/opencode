import { describe, expect, test } from "bun:test"
import { createReplySender } from "./reply"

describe("createReplySender", () => {
  test("a second press while the first reply sends does nothing", async () => {
    const sent: string[] = []
    const pending = Promise.withResolvers<void>()

    const sender = createReplySender({
      sent: () => false,
      send: (reply: string) => {
        sent.push(reply)

        return pending.promise
      },
    })

    sender.send("first")
    sender.send("second")
    expect(sender.sending()).toBe(true)
    pending.resolve()
    await pending.promise
    expect(sent).toEqual(["first"])
  })

  test("a reply already in the session blocks another", () => {
    const sent: string[] = []

    const sender = createReplySender({
      sent: () => true,
      send: async (reply: string) => {
        sent.push(reply)
      },
    })

    sender.send("again")
    expect(sent).toEqual([])
    expect(sender.sending()).toBe(false)
  })

  test("a failed send can be retried", async () => {
    const attempts: string[] = []

    const sender = createReplySender({
      sent: () => false,
      send: (reply: string) => {
        attempts.push(reply)

        return attempts.length === 1 ? Promise.reject(new Error("offline")) : Promise.resolve()
      },
    })

    await sender.send("first")
    expect(sender.failed()).toBe(true)
    expect(sender.sending()).toBe(false)
    sender.send("retry")
    expect(sender.failed()).toBe(false)
    expect(attempts).toEqual(["first", "retry"])
  })
})
