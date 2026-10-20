import { describe, expect } from "bun:test"
import { DateTime, Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { ModelResolver } from "@opencode/core/model-resolver"
import { Project } from "@opencode/core/project"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { Money } from "@opencode/schema/money"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const ref = location({ directory: AbsolutePath.make("test") })
const graph = (replacements: LayerNode.Replacements = []) =>
  AppNodeBuilder.build(
    LayerNode.group([
      Provider.node,
      Model.node,
      Bus.node,
      Credential.node,
      Integration.node,
      ModelResolver.node,
      SessionRunnerModel.node,
    ]),
    [Location.node.replace(Layer.succeed(Location.Service, Location.Service.of(ref))), ...replacements],
  )
const enabled = testEffect(graph())
const disabled = testEffect(graph([Model.node.replace(Model.configured({ free: false }))]))

const free = Model.ID.make("big-pickle")
const paid = Model.ID.make("paid")
const other = Provider.ID.make("other")

const seed = (options: { readonly paid: boolean }) =>
  Effect.gen(function* () {
    const providers = yield* Provider.Service
    yield* providers.transform((editor) => {
      editor.update(Provider.ID.opencode, () => {})
      editor.models.update(Provider.ID.opencode, free, (model) => {
        model.time.released = 3000
      })
      if (options.paid)
        editor.models.update(Provider.ID.opencode, paid, (model) => {
          model.time.released = 1000
          model.cost = [
            {
              input: Money.USDPerMillionTokens.make(1),
              output: Money.USDPerMillionTokens.make(1),
              cache: { read: Money.USDPerMillionTokens.zero, write: Money.USDPerMillionTokens.zero },
            },
          ]
        })
      // A zero-cost model from another provider is not an OpenCode free model.
      editor.update(other, () => {})
      editor.models.update(other, Model.ID.make("local"), (model) => {
        model.time.released = 2000
      })
    })
  })

const sessionUsing = (modelID: Model.ID) =>
  Session.Info.make({
    id: Session.ID.make("ses_free_model"),
    projectID: Project.ID.global,
    title: "test",
    model: { id: modelID, providerID: Provider.ID.opencode },
    cost: Money.USD.zero,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
    location: ref,
  })

describe("free OpenCode models", () => {
  enabled.effect("are listed and chosen as the default by default", () =>
    Effect.gen(function* () {
      const models = yield* Model.Service
      yield* seed({ paid: true })

      expect((yield* models.available()).map((model) => model.id)).toContain(free)
      expect((yield* models.default())?.id).toBe(free)
    }),
  )

  disabled.effect("are removed from the catalog when disabled", () =>
    Effect.gen(function* () {
      const models = yield* Model.Service
      yield* seed({ paid: true })

      expect((yield* models.all()).map((model) => model.id)).toEqual([Model.ID.make("local"), paid])
      expect((yield* models.available()).map((model) => model.id)).toEqual([Model.ID.make("local"), paid])
      expect(yield* models.get(Provider.ID.opencode, free)).toBeUndefined()
      expect(yield* models.get(Provider.ID.opencode, paid)).toBeDefined()
      expect((yield* models.default())?.id).toBe(Model.ID.make("local"))
    }),
  )

  disabled.effect("are not used as a configured default when disabled", () =>
    Effect.gen(function* () {
      const models = yield* Model.Service
      yield* seed({ paid: true })
      yield* models.transform((editor) => editor.default.set(Provider.ID.opencode, free))

      expect((yield* models.default())?.id).toBe(Model.ID.make("local"))
    }),
  )

  disabled.effect("leave other providers as the default when no paid OpenCode model exists", () =>
    Effect.gen(function* () {
      const models = yield* Model.Service
      yield* seed({ paid: false })

      expect((yield* models.available()).some((model) => model.providerID === Provider.ID.opencode)).toBe(false)
      expect((yield* models.default())?.providerID).toBe(other)
    }),
  )

  disabled.effect("report an explicitly selected free model as unavailable", () =>
    Effect.gen(function* () {
      const models = yield* Model.Service
      const runner = yield* SessionRunnerModel.Service
      const resolver = yield* ModelResolver.Service
      yield* seed({ paid: true })

      const failure = yield* runner.resolve(sessionUsing(free), models.available).pipe(Effect.flip)
      expect(failure).toMatchObject({ _tag: "SessionRunnerModel.ModelUnavailableError", modelID: free })
      expect(failure.message).toBe("Model unavailable: opencode/big-pickle")
      expect(yield* resolver.resolve(Model.Ref.make({ providerID: Provider.ID.opencode, id: free }))).toBeUndefined()
    }),
  )
})
