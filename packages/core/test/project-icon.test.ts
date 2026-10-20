import { describe, expect } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Project } from "@opencode/core/project"
import { ProjectIcon } from "@opencode/core/project/icon"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { FSUtil } from "@opencode/util/fs-util"
import { initGit } from "./fixture/git"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Project.node, Database.node, Bus.node, FSUtil.node])))

const SVG = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><circle cx='8' cy='8' r='6'/></svg>"
const SVG_UPDATED = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect width='16' height='16'/></svg>"

async function writeFile(root: string, relative: string, content: string | Uint8Array) {
  const target = path.join(root, relative)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await Bun.write(target, content)
}

describe("ProjectIcon.discover", () => {
  it.live("orders candidates by priority and picks a 128-256px .appiconset image and front .icon layer", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(async () => {
        await writeFile(tmp.path, "assets/logo.png", "logo")
        await writeFile(tmp.path, "public/favicon.ico", new Uint8Array([0, 0, 1, 0]))
        await writeFile(tmp.path, "app/icon.png", "app-icon")
        await writeFile(tmp.path, "public/favicon.svg", SVG)
        await writeFile(tmp.path, "Assets.xcassets/AppIcon.appiconset/icon_32.png", "small")
        await writeFile(tmp.path, "Assets.xcassets/AppIcon.appiconset/icon_256.png", "medium")
        await writeFile(tmp.path, "Assets.xcassets/AppIcon.appiconset/icon_1024.png", "huge")
        await writeFile(
          tmp.path,
          "AppIcon.icon/icon.json",
          JSON.stringify({ groups: [{ layers: [{ "image-name": "glyph.svg" }] }] }),
        )
        await writeFile(tmp.path, "AppIcon.icon/Assets/glyph.svg", SVG)
      })
      const fsUtil = yield* FSUtil.Service
      const found = yield* ProjectIcon.discover(fsUtil, AbsolutePath.make(tmp.path))

      expect(found.map((item) => ("path" in item ? item.path : item.url))).toEqual([
        "Assets.xcassets/AppIcon.appiconset/icon_256.png",
        "AppIcon.icon/Assets/glyph.svg",
        "public/favicon.svg",
        "app/icon.png",
        "public/favicon.ico",
        "assets/logo.png",
      ])
    }),
  )

  it.live("keeps https URLs from config and blocks path traversal at the boundary", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const fsUtil = yield* FSUtil.Service
      const root = AbsolutePath.make(path.join(tmp.path, "repo"))
      yield* Effect.promise(async () => {
        await writeFile(tmp.path, "outside.svg", SVG)
        await writeFile(root, "public/favicon.svg", SVG)
        await writeFile(root, "opencode.jsonc", `{\n  // custom icon\n  "icon": "https://example.com/icon.svg"\n}`)
      })

      const configured = yield* ProjectIcon.discover(fsUtil, root)
      expect(configured[0]).toEqual({ url: "https://example.com/icon.svg" })
      expect(configured[1]).toMatchObject({ path: "public/favicon.svg" })

      yield* Effect.promise(() => writeFile(root, "opencode.jsonc", JSON.stringify({ icon: "../outside.svg" })))
      const escaped = yield* ProjectIcon.discover(fsUtil, root)
      expect(escaped.map((item) => ("path" in item ? item.path : item.url))).toEqual(["public/favicon.svg"])
      expect(yield* ProjectIcon.read(fsUtil, root, "../outside.svg")).toBeUndefined()
      expect(yield* ProjectIcon.read(fsUtil, root, path.join(tmp.path, "outside.svg"))).toBeUndefined()
    }),
  )
})

describe("Project icon persistence", () => {
  it.live("stores a versioned icon URL, updates the hash on edit, rediscovers when deleted, and rejects traversal", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const root = AbsolutePath.make( path.join(tmp.path, "repo"))
      yield* Effect.promise(async () => {
        await writeFile(tmp.path, "outside.svg", SVG)
        await initGit(root)
        await $`git remote add origin git@github.com:kitlangton/team-board.git`.cwd(root).quiet()
        await writeFile(root, "public/favicon.svg", SVG)
        await writeFile(root, "assets/logo.svg", SVG_UPDATED)
      })
      const project = yield* Project.Service
      const db = (yield* Database.Service).db
      const resolved = yield* project.resolve(root)
      const firstUrl = (yield* project.list()).find((item) => item.id === resolved.id)?.icon?.url ?? ""

      expect(firstUrl).toMatch(new RegExp(`^/api/project/${resolved.id}/icon\\?v=[0-9a-f]{16}$`))
      expect(new TextDecoder().decode((yield* project.icon(resolved.id))?.bytes)).toBe(SVG)

      yield* Effect.promise(() => writeFile(root, "public/favicon.svg", SVG_UPDATED))
      expect(new TextDecoder().decode((yield* project.icon(resolved.id))?.bytes)).toBe(SVG_UPDATED)
      yield* project.sweep()
      const updatedUrl = (yield* project.list()).find((item) => item.id === resolved.id)?.icon?.url ?? ""
      expect(updatedUrl).toMatch(new RegExp(`^/api/project/${resolved.id}/icon\\?v=[0-9a-f]{16}$`))
      expect(updatedUrl).not.toBe(firstUrl)

      yield* Effect.promise(() => fs.rm(path.join(root, "public/favicon.svg")))
      expect(yield* project.icon(resolved.id)).toBeUndefined()
      yield* project.sweep()
      expect(new TextDecoder().decode((yield* project.icon(resolved.id))?.bytes)).toBe(SVG_UPDATED)

      yield* db
        .update(ProjectTable)
        .set({ icon_url: `/api/project/${resolved.id}/icon?v=deadbeef&path=${encodeURIComponent("../outside.svg")}` })
        .where(eq(ProjectTable.id, resolved.id))
        .run()
        .pipe(Effect.orDie)
      expect(yield* project.icon(resolved.id)).toBeUndefined()
    }),
  )
})
