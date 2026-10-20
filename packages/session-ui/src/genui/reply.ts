import { createSignal } from "solid-js"

/**
 * Sends a surface's reply once. The first press claims the send before its request goes out, so a double click or
 * a repeated Enter cannot send it twice, and a reply already in the session blocks any more. A failed send can be
 * retried. Returns the send in flight, if this press started one.
 */
export function createReplySender<T>(input: { sent: () => boolean; send: (reply: T) => Promise<void> }) {
  const [sending, setSending] = createSignal(false)
  const [failed, setFailed] = createSignal(false)

  return {
    sending,
    failed,
    send(reply: T) {
      if (sending() || input.sent()) return
      setSending(true)
      setFailed(false)

      return input
        .send(reply)
        .catch(() => setFailed(true))
        .finally(() => setSending(false))
    },
  }
}
