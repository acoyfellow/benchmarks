# Workers AI Tool-Calling Findings

## Compatibility Matrix

Tested Feb 21, 2026 against the Workers AI REST API.  
Prompt: `"What is the weather in Austin, TX?"`  
Tool: `get_weather(location: string)`

| Model | Endpoint | Tool Format | Result |
|-------|----------|-------------|--------|
| llama-3.2-3b | /ai/run | flat `{name, description, parameters}` | ✅ flat response |
| llama-3.2-3b | /ai/run | openai `{type:"function", function:{…}}` | ✅ flat response |
| **glm-4.7-flash** | **/ai/run** | **flat** | **❌ 8001 Invalid input** |
| glm-4.7-flash | /ai/run | openai | ✅ openai response |
| llama-3.2-3b | /ai/v1/chat/completions | flat | ✅ openai response |
| llama-3.2-3b | /ai/v1/chat/completions | openai | ✅ openai response |
| **glm-4.7-flash** | **/ai/v1/chat/completions** | **flat** | **❌ 8001 Invalid input** |
| glm-4.7-flash | /ai/v1/chat/completions | openai | ✅ openai response |

### Key findings

1. **GLM rejects flat tool format on both endpoints.** Llama accepts both formats. There is no API-level normalization of tool input on either endpoint.

2. **`/ai/v1/chat/completions` normalizes output.** Both models return consistent `choices[].message.tool_calls[].function` format. `/ai/run` does not — Llama returns flat `{tool_calls: [{name, arguments}]}`, GLM returns OpenAI-style nested format.

3. **No model metadata indicates which format is required.** The `/ai/models/search` endpoint has no `capabilities.tools` or format flag.

## Reproduce

Replace `$ACCOUNT_ID` and auth headers with your own credentials.

```bash
# ❌ This fails — GLM + flat tools
curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/ai/v1/chat/completions" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"model":"@cf/zai-org/glm-4.7-flash","messages":[{"role":"user","content":"Weather in Austin?"}],"tools":[{"name":"get_weather","description":"Get weather","parameters":{"type":"object","properties":{"location":{"type":"string"}},"required":["location"]}}]}'

# ✅ This works — GLM + openai tools
curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/ai/v1/chat/completions" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"model":"@cf/zai-org/glm-4.7-flash","messages":[{"role":"user","content":"Weather in Austin?"}],"tools":[{"type":"function","function":{"name":"get_weather","description":"Get weather","parameters":{"type":"object","properties":{"location":{"type":"string"}},"required":["location"]}}}]}'

# ✅ This works — Llama + flat tools (same format that fails on GLM)
curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/ai/v1/chat/completions" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"model":"@cf/meta/llama-3.2-3b-instruct","messages":[{"role":"user","content":"Weather in Austin?"}],"tools":[{"name":"get_weather","description":"Get weather","parameters":{"type":"object","properties":{"location":{"type":"string"}},"required":["location"]}}]}'
```

## Benchmark

Live leaderboard: https://benchmarks.coey.dev  
Source: https://github.com/acoyfellow/benchmarks
