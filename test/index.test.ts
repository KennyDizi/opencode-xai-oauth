import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { XaiOAuthPlugin } from "../src/index"
import { authPath, pkcePair, readStoredAuth, writeStoredAuth } from "../src/xai"

function pluginCtx() {
  return { client: { app: { log: async () => undefined } } } as never
}

describe("XaiOAuthPlugin", () => {
  test("exports OpenCode auth/provider/tools hooks", async () => {
    const plugin = await XaiOAuthPlugin(pluginCtx())

    expect(typeof XaiOAuthPlugin).toBe("function")
    expect(plugin.auth?.provider).toBe("xai")
    expect(plugin.provider).toBeUndefined()
    expect(typeof plugin.config).toBe("function")
    expect(typeof plugin["chat.params"]).toBe("function")
    expect(Object.keys(plugin.tool || {}).sort()).toEqual([
      "xai_generate_text",
      "xai_image_generate",
      "xai_status",
      "xai_tts",
      "xai_web_search",
      "xai_x_search",
    ])
  })


  test("adds Grok thinking metadata to the built-in xAI provider config", async () => {
    const plugin = await XaiOAuthPlugin(pluginCtx())
    const config = {} as Record<string, unknown>

    await plugin.config!(config as never)

    const provider = config.provider as Record<string, { models: Record<string, Record<string, unknown>> }>
    const grok43 = provider.xai.models["grok-4.3"]
    const grok43Variants = grok43.variants as Record<string, { reasoningEffort: string }>

    expect(grok43.reasoning).toBe(true)
    expect(grok43Variants.high.reasoningEffort).toBe("high")
    expect(grok43Variants.xhigh.reasoningEffort).toBe("high")
    expect(grok43Variants.max.reasoningEffort).toBe("high")
    expect(provider.xai.models["grok-4.20-reasoning"].reasoning).toBe(true)
  })

  test("maps xAI Grok 4.3 variants to reasoning effort request options", async () => {
    const plugin = await XaiOAuthPlugin(pluginCtx())
    const output = { options: {} } as { options: Record<string, unknown> }

    await plugin["chat.params"]!(
      { model: { providerID: "xai", modelID: "grok-4.3" }, provider: { id: "xai" }, message: { variant: "xhigh" } } as never,
      output as never,
    )

    expect(output.options.reasoningEffort).toBe("high")
    expect(output.options.reasoning_effort).toBe("high")
  })

  test("maps max Grok 4.3 variant to high reasoning effort request options", async () => {
    const plugin = await XaiOAuthPlugin(pluginCtx())
    const output = { options: {} } as { options: Record<string, unknown> }

    await plugin["chat.params"]!(
      { model: { providerID: "xai", modelID: "grok-4.3" }, provider: { id: "xai" }, message: { variant: "max" } } as never,
      output as never,
    )

    expect(output.options.reasoningEffort).toBe("high")
    expect(output.options.reasoning_effort).toBe("high")
  })

  test("does not send unsupported reasoning_effort to Grok 4.20 reasoning", async () => {
    const plugin = await XaiOAuthPlugin(pluginCtx())
    const output = { options: {} } as { options: Record<string, unknown> }

    await plugin["chat.params"]!(
      { model: { providerID: "xai", modelID: "grok-4.20-reasoning" }, provider: { id: "xai" }, message: { variant: "high" } } as never,
      output as never,
    )

    expect(output.options.reasoningEffort).toBeUndefined()
    expect(output.options.reasoning_effort).toBeUndefined()
  })

  test("status tool reports missing credentials without throwing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencode-xai-oauth-"))
    process.env.OPENCODE_XAI_OAUTH_AUTH_FILE = join(dir, "auth.json")
    delete process.env.XAI_API_KEY
    const plugin = await XaiOAuthPlugin(pluginCtx())
    const result = await plugin.tool!.xai_status.execute({}, { directory: process.cwd(), worktree: process.cwd() } as never)
    expect(String(result)).toContain("credentials not found")
    rmSync(dir, { recursive: true, force: true })
    delete process.env.OPENCODE_XAI_OAUTH_AUTH_FILE
  })
})

describe("xAI auth helpers", () => {
  afterEach(() => {
    delete process.env.OPENCODE_XAI_OAUTH_AUTH_FILE
  })

  test("generates PKCE verifier and challenge", () => {
    const pair = pkcePair()
    expect(pair.verifier.length).toBeGreaterThan(20)
    expect(pair.challenge.length).toBeGreaterThan(20)
    expect(pair.verifier).not.toBe(pair.challenge)
  })

  test("stores auth file with restricted JSON payload", () => {
    const dir = mkdtempSync(join(tmpdir(), "opencode-xai-oauth-"))
    process.env.OPENCODE_XAI_OAUTH_AUTH_FILE = join(dir, "auth.json")
    writeStoredAuth({ provider: "xai-oauth", access: "a", refresh: "r", expires: 123, tokenEndpoint: "https://auth.x.ai/oauth2/token", tokenType: "Bearer" })
    expect(authPath()).toBe(join(dir, "auth.json"))
    expect(existsSync(authPath())).toBe(true)
    expect(readStoredAuth()?.access).toBe("a")
    expect(readFileSync(authPath(), "utf8")).toContain("xai-oauth")
    rmSync(dir, { recursive: true, force: true })
  })

  test("ignores corrupt stored auth instead of crashing status checks", () => {
    const dir = mkdtempSync(join(tmpdir(), "opencode-xai-oauth-"))
    process.env.OPENCODE_XAI_OAUTH_AUTH_FILE = join(dir, "auth.json")
    writeFileSync(authPath(), "{not-json")
    expect(readStoredAuth()).toBeUndefined()
    rmSync(dir, { recursive: true, force: true })
  })
})
