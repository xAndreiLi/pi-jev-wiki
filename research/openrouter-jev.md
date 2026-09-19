# Jev on OpenRouter — Decisions API (verified 2026-09-19)

Fetched from the OpenRouter model endpoint, a working example repo, and a community API note.

## Contract

```
POST https://openrouter.ai/api/alpha/decisions
Authorization: Bearer <OPENROUTER_API_KEY>
Content-Type: application/json

{
  "model": "~typesafe/jev-latest",       // or pinned "typesafe/jev-1.13"
  "state": "text | { field: "text", ... } | ["text", ...]",
  "questions": {
    "<key>": {
      "type": "noul" | "choice" | "score",
      "instructions": "…",
      "criteria": …                       // noul: {true,false}; choice: {key: desc|null}; score: [levels]
    }
  }
}
```

Response is TypeSafe's native shape plus OpenRouter metadata:

```json
{
  "model": "typesafe/jev-1.13-20260917",
  "provider": "TypeSafe",
  "answers": { "<key>": { "type": "...", "noul|choice|score": ..., "probabilities": {...}, "confidence": 0.93 } },
  "usage": { "input_tokens": 423, "output_tokens": 70, "cost": 0.000018 }
}
```

## Facts that shaped the plugin design

| Fact | Source | Implication |
|---|---|---|
| Endpoint accepts TypeSafe's schema **verbatim** | deliberate-invalid-body error from the endpoint; community note | one client code path for OpenRouter and TypeSafe direct |
| Jev is **not in the public `/api/v1/models` catalog** (447 models, zero Jev hits) | `GET /api/v1/models` | don't discover models; configure the ID |
| `/chat/completions` rejects it: *"is a decisions model… use /api/alpha/decisions"* | OpenRouter API | no chat-SDK shims |
| Model IDs: `typesafe/jev-1.13` (pinned, endpoint reports `typesafe/jev-1.13-20260917`) and `~typesafe/jev-latest` ("always redirects to the latest model in the Jev family") | `/api/v1/models/.../endpoints` | default to the alias, allow pinning |
| Pricing: prompt `$0.000000042`/token = **$0.042/Mtok**, completion `0` | endpoints JSON | verification is effectively free |
| Context: **32,000** advertised on OpenRouter (vs 64k direct; 32k = state + longest question) | endpoints JSON | chunk at ~24k with margin |
| Auth is bearer; 401 without auth | live probe | reuse pi's OpenRouter auth |
| Errors: 402 no credits, 429/529 retry with `Retry-After`, 400 wrong endpoint | community note + example client | client handles backoff and surfaces 402 clearly |
| Round-trips ~600–950 ms with all three question types in one call | example README | batch aggressively |

## pi integration

`ctx.modelRegistry.getApiKeyForProvider("openrouter"): Promise<string | undefined>` resolves the
credential from pi's `auth.json` (OAuth token or API key), including refresh handling. The plugin
prefers this and falls back to `OPENROUTER_API_KEY` / config `apiKey` (`$ENV_VAR` supported).

If OpenRouter changes the alpha endpoint, the client is one file (`src/jev.ts`) plus config to
switch to `https://api.typesafe.ai/v1/systemone` with `jev-latest`.
