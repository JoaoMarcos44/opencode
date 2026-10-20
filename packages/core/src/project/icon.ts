export * as ProjectIcon from "./icon.js"

import path from "path"
import { Effect, Option, Schema } from "effect"
import { parse } from "jsonc-parser"
import { FSUtil } from "@opencode/util/fs-util"
import { Hash } from "@opencode/util/hash"
import { AbsolutePath } from "../schema.js"

export interface Image {
  readonly path: string
  readonly bytes: Uint8Array
  readonly type: string
  readonly hash: string
}

export type Candidate = Image | { readonly url: string }

const IMAGES = new Set([".svg", ".png", ".ico", ".jpg", ".jpeg", ".webp"])
const CONFIGS = ["opencode.jsonc", "opencode.json", ".opencode/opencode.jsonc", ".opencode/opencode.json"]
const CANDIDATES = [
  ...["Assets.xcassets/", "ios/App/Assets.xcassets/"].map((dir) => `${dir}AppIcon.appiconset`),
  ...["", "app/", "assets/"].map((dir) => `${dir}AppIcon.icon`),
  ...["assets/app-icon", "build/icon", "src-tauri/icons/icon", "resources/icon", "icons/icon", "extension/icons/icon"].flatMap(
    (base) => [`${base}.svg`, `${base}.png`],
  ),
  ...["favicon.svg", "icon.svg", "favicon.png", "apple-touch-icon.png", "icon.png", "favicon.ico"].flatMap((file) =>
    ["public/", "app/", "src/app/", "site/public/", ""].map((dir) => `${dir}${file}`),
  ),
  ...["assets/icon", "assets/logo", "public/logo", "logo"].flatMap((base) => [`${base}.svg`, `${base}.png`]),
]

const decodeConfig = Schema.decodeUnknownOption(Schema.Struct({ icon: Schema.String }))
const decodeManifest = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      groups: Schema.Array(Schema.Struct({ layers: Schema.Array(Schema.Struct({ "image-name": Schema.optional(Schema.String) })) })),
    }),
  ),
)

/** Ordered icon candidates in `root`: project config first, then fixed well-known paths. */
export const discover = Effect.fn("ProjectIcon.discover")(function* (
  fs: FSUtil.Interface,
  root: AbsolutePath,
  options?: { readonly limit?: number },
): Effect.fn.Return<readonly Candidate[]> {
  const configured = yield* config(fs, root)
  const found: Candidate[] = configured ? [configured] : []
  for (const candidate of CANDIDATES) {
    if (options?.limit && found.length >= options.limit) break
    const item = yield* resolveCandidate(fs, root, candidate)
    if (item && (!configured || !("path" in configured) || item.path !== configured.path)) found.push(item)
  }
  return found
})

/** Resolves `relative` inside `root` and reads its image bytes and content hash, rejecting paths outside `root`. */
export const read = Effect.fn("ProjectIcon.read")(function* (
  fs: FSUtil.Interface,
  root: AbsolutePath,
  relative: string,
): Effect.fn.Return<Image | undefined> {
  if (relative.includes("\u0000") || path.isAbsolute(relative)) return undefined
  const file = path.resolve(root, relative)
  if (!FSUtil.contains(root, file) || file === root) return undefined
  const extension = path.extname(file).toLowerCase()
  if (!IMAGES.has(extension)) return undefined
  const bytes = yield* fs.readFile(file).pipe(Effect.orElseSucceed(() => undefined))
  if (!bytes?.byteLength) return undefined
  return {
    path: path.relative(root, file).split(path.sep).join("/"),
    bytes,
    type: extension === ".ico" ? "image/x-icon" : FSUtil.mimeType(file),
    hash: Hash.fast(Buffer.from(bytes)).slice(0, 16),
  }
})

const config = Effect.fnUntraced(function* (fs: FSUtil.Interface, root: AbsolutePath) {
  for (const name of CONFIGS) {
    const text = yield* fs.readFileString(path.join(root, name)).pipe(Effect.orElseSucceed(() => undefined))
    if (text === undefined) continue
    const value = Option.getOrUndefined(decodeConfig(parse(text)))?.icon.trim()
    if (!value) continue
    if (/^https?:/i.test(value)) return { url: value }
    const image = yield* read(fs, root, path.join(path.dirname(name), value))
    if (image) return image
  }
})

const resolveCandidate = Effect.fnUntraced(function* (fs: FSUtil.Interface, root: AbsolutePath, candidate: string) {
  if (candidate.endsWith(".appiconset")) {
    const entries = yield* fs.readDirectoryEntries(path.join(root, candidate)).pipe(Effect.orElseSucceed(() => []))
    const files = entries
      .flatMap((entry) => (entry.type === "file" && IMAGES.has(path.extname(entry.name).toLowerCase()) ? [entry.name] : []))
      .toSorted()
    const chosen = files.find((name) => /128|256/.test(name)) ?? files[0]
    return chosen ? yield* read(fs, root, `${candidate}/${chosen}`) : undefined
  }
  if (!candidate.endsWith(".icon")) return yield* read(fs, root, candidate)
  const manifest = yield* fs.readFileString(path.join(root, candidate, "icon.json")).pipe(Effect.orElseSucceed(() => undefined))
  const layer = Option.getOrUndefined(decodeManifest(manifest))
    ?.groups.flatMap((group) => group.layers.flatMap((item) => item["image-name"] ?? []))
    .at(0)
  return layer ? yield* read(fs, root, `${candidate}/Assets/${layer}`) : undefined
})
