import { describe, expect, test } from "bun:test"
import { createComputed, createRoot, createSignal } from "solid-js"
import { createTypeahead } from "@opencode/ui/typeahead"

function branches(responses: Record<string, PromiseWithResolvers<string[]>>) {
  return createRoot((dispose) => {
    const [query, setQuery] = createSignal("")
    const requests: string[] = []
    const shown: string[][] = []

    const typeahead = createTypeahead<string>({
      query,
      source: (search) => {
        requests.push(search)
        responses[search] ??= Promise.withResolvers<string[]>()

        return responses[search].promise
      },
      match: (branch, search) => branch.includes(search),
      key: (branch) => branch,
      onSelect: () => {},
    })

    createComputed(() => shown.push(typeahead.items()))

    const settle = (search: string, items: string[]) => {
      const visible = Promise.withResolvers<void>()
      createRoot((stop) =>
        createComputed(() => {
          if (typeahead.pending()) return
          stop()
          visible.resolve()
        }),
      )
      responses[search] ??= Promise.withResolvers<string[]>()
      responses[search].resolve(items)

      return visible.promise
    }

    return { typeahead, setQuery, settle, requests, shown, dispose }
  })
}

describe("typeahead results", () => {
  test("a refined query narrows the previous results while its request is pending", async () => {
    const root = branches({})
    await root.settle("", ["main", "release/base", "release/next"])
    expect(root.typeahead.items()).toEqual(["main", "release/base", "release/next"])
    root.shown.length = 0

    root.setQuery("release")
    expect(root.typeahead.pending()).toBe(true)
    expect(root.typeahead.items()).toEqual(["release/base", "release/next"])

    await root.settle("release", ["release/base", "release/next", "release/old"])
    expect(root.typeahead.items()).toEqual(["release/base", "release/next", "release/old"])
    expect(root.shown.every((items) => items.length > 0)).toBe(true)
    root.dispose()
  })

  test("a query no earlier row matches keeps the previous rows, marked stale, until its results arrive", async () => {
    const root = branches({})
    await root.settle("", ["main", "dev"])

    root.setQuery("feature")
    expect(root.typeahead.items()).toEqual(["main", "dev"])
    expect(root.typeahead.stale("main")).toBe(true)

    await root.settle("feature", ["feature/one"])
    expect(root.typeahead.items()).toEqual(["feature/one"])
    expect(root.typeahead.stale("feature/one")).toBe(false)

    root.setQuery("")
    expect(root.typeahead.items()).toEqual(["main", "dev"])
    root.dispose()
  })

  test("an empty response shows no rows once the request settles", async () => {
    const root = branches({})
    await root.settle("", ["main"])
    root.setQuery("zzz")
    await root.settle("zzz", [])
    expect(root.typeahead.items()).toEqual([])
    expect(root.typeahead.pending()).toBe(false)
    root.dispose()
  })

  test("the active row survives new results and falls back to the first row when it leaves", async () => {
    const root = branches({})
    await root.settle("", ["main", "release/base", "release/next"])
    expect(root.typeahead.active()).toBe("main")

    root.typeahead.move("last")
    expect(root.typeahead.active()).toBe("release/next")
    root.setQuery("release")
    expect(root.typeahead.active()).toBe("release/next")

    await root.settle("release", ["release/base"])
    expect(root.typeahead.active()).toBe("release/base")
    root.typeahead.move("previous")
    expect(root.typeahead.active()).toBe("release/base")
    root.dispose()
  })
})
