async function testAllZenFreeModels() {
  console.log("Fetching live models from Zen endpoint...")
  const res = await fetch("https://opencode.ai/zen/v1/models", {
    headers: {
      "User-Agent": "opencode/0.1.0 (darwin; arm64)",
      "x-opencode-client": "cli",
    },
  })
  const json = await res.json()
  const allFreeModels = json.data.filter((m: any) => m.id.endsWith("-free")).map((m: any) => m.id)
  console.log("Found Free Models:", allFreeModels)

  for (const model of allFreeModels) {
    console.log(`\nTesting stream on model: ${model} ...`)
    try {
      const chatRes = await fetch("https://opencode.ai/zen/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "opencode/0.1.0 (darwin; arm64)",
          "x-opencode-client": "cli",
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: "user", content: "Write 1 line of python code to print hello" }],
          stream: true,
        }),
      })

      console.log(`Status for ${model}: ${chatRes.status} ${chatRes.statusText}`)
      if (chatRes.ok && chatRes.body) {
        const reader = chatRes.body.getReader()
        const decoder = new TextDecoder()
        let chunksCount = 0
        let fullText = ""
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          chunksCount++
          fullText += chunk
          if (chunksCount <= 2) {
            console.log(`  Chunk #${chunksCount}:`, chunk.slice(0, 150))
          }
        }
        console.log(`  Total chunks: ${chunksCount}, Stream successfully completed!`)
      } else {
        const err = await chatRes.text()
        console.log(`  Error:`, err.slice(0, 200))
      }
    } catch (e: any) {
      console.error(`  Exception on ${model}:`, e.message)
    }
  }
}

testAllZenFreeModels()
