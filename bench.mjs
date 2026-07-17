import { writeFileSync } from 'fs';

const API_KEY = 'dd16ce86b093c276772b84d368f66747:NGEzZTZhZDEyOTJlNjgzNjE2ZTI2NjQy';
const BASE_URL = 'https://maas-coding-api.cn-huabei-1.xf-yun.com/anthropic';

const MODELS = [
  { id: 'xopdeepseekv4pro',   name: 'DeepSeek-V4-Pro' },
  { id: 'xsparkx2agent',       name: 'Spark X2 Agent' },
  { id: 'xopqwen35397b',       name: 'Qwen3.5-397B-A17B' },
  { id: 'xopkimik26',          name: 'Kimi-K2.6' },
  { id: 'xopglm52',            name: 'GLM-5.2' },
  { id: 'xopdeepseekv4flash',  name: 'DeepSeek-V4-Flash' },
];

const PROBLEMS = [
  {
    id: 'lru-cache',
    difficulty: 'Medium',
    prompt: `Design and implement an LRU (Least Recently Used) cache class in TypeScript. It should support get(key: number) and put(key: number, value: number) operations, both O(1) average time complexity. Include a brief explanation of your approach. Return ONLY the code and explanation, no extra commentary.`,
  },
  {
    id: 'json-query',
    difficulty: 'Medium',
    prompt: `Write a TypeScript function deepGet(obj: unknown, path: string): unknown that safely traverses a nested object/array using a dot-separated path string. For example: deepGet({a: {b: [1, {c: 'hello'}]}}, 'a.b.1.c') should return 'hello'. Handle edge cases: null, undefined, missing keys, array indices, and empty path. Include a brief explanation. Return ONLY the code and explanation.`,
  },
  {
    id: 'rate-limiter',
    difficulty: 'Hard',
    prompt: `Design a sliding window rate limiter class in TypeScript. It should track request counts per user within a configurable time window. Implement: isAllowed(userId: string): boolean and getRemainingTokens(userId: string): number. The class should be memory-efficient and thread-safe (single-threaded JS context is fine). Include edge case handling and a brief explanation. Return ONLY the code and explanation.`,
  },
];

const PAYLOAD = {
  max_tokens: 4096,
  temperature: 0.3,
};

async function callModel(modelId, prompt) {
    const url = `${BASE_URL}/v1/messages`;
  const start = Date.now();

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ...PAYLOAD,
        model: modelId,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(120_000),
    });

    const elapsed = Date.now() - start;
    const body = await res.json();

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: body?.error?.message || JSON.stringify(body),
        elapsed,
      };
    }

    const content = body.content?.[0]?.text || '';
    const usage = body.usage || {};
    return {
      ok: true,
      elapsed,
      content,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
    };
  } catch (err) {
    return { ok: false, error: err.message, elapsed: Date.now() - start };
  }
}

function scoreResponse(content, problemId) {
  let score = 0;
  const details = [];

  // Has code block
  if (/```(?:typescript|ts|javascript|js)/i.test(content)) {
    score += 2;
    details.push('code-block: +2');
  } else { details.push('code-block: 0'); }

  // Explanation
  if (/explanation|approach|algorithm|complexity|O\(/i.test(content)) {
    score += 1;
    details.push('explanation: +1');
  } else { details.push('explanation: 0'); }

  // Edge cases mentioned
  if (/edge case|null|undefined|empty|invalid/i.test(content)) {
    score += 1;
    details.push('edge-cases: +1');
  } else { details.push('edge-cases: 0'); }

  // Has function/class definition
  if (/function |class |=>|interface /.test(content)) {
    score += 1;
    details.push('impl: +1');
  } else { details.push('impl: 0'); }

  // Length quality (not too short, not too long)
  if (content.length > 300 && content.length < 15000) {
    score += 1;
    details.push('length-ok: +1');
  } else { details.push('length-ok: 0'); }

  return { score: Math.min(score, 6), details };
}

async function run() {
  const results = [];

  for (const model of MODELS) {
    console.log(`\n--- Testing ${model.name} (${model.id}) ---`);
    const modelResult = { model: model.name, id: model.id, problems: [], totalScore: 0, avgElapsed: 0 };

    for (const problem of PROBLEMS) {
      process.stdout.write(`  ${problem.id}... `);
      const res = await callModel(model.id, problem.prompt);

      if (!res.ok) {
        console.log(`FAIL (${res.elapsed}ms): ${res.error}`);
        modelResult.problems.push({ problem: problem.id, ok: false, error: res.error, elapsed: res.elapsed, score: 0 });
        continue;
      }

      const scored = scoreResponse(res.content, problem.id);
      modelResult.problems.push({
        problem: problem.id,
        ok: true,
        elapsed: res.elapsed,
        score: scored.score,
        details: scored.details,
        outputTokens: res.outputTokens,
        snippet: res.content.slice(0, 200) + '...',
      });
      modelResult.totalScore += scored.score;
      console.log(`OK (${res.elapsed}ms, score=${scored.score}/6)`);
    }

    modelResult.avgElapsed = modelResult.problems.reduce((s, p) => s + p.elapsed, 0) / modelResult.problems.length;
    results.push(modelResult);

    // Cooldown between models
    if (MODELS.indexOf(model) < MODELS.length - 1) {
      console.log('  (cooling down 3s...)');
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  // ---- REPORT ----
  console.log('\n\n========================================');
  console.log('         CODING BENCH RESULTS');
  console.log('========================================\n');

  // Summary table
  console.log('Rank | Model                | Total Score | Avg Time | Avg Tokens');
  console.log('-----|----------------------|------------|----------|-----------');
  const sorted = [...results].sort((a, b) => b.totalScore - a.totalScore);
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const avgTokens = r.problems.filter(p => p.ok).reduce((s, p) => s + (p.outputTokens || 0), 0);
    const count = r.problems.filter(p => p.ok).length;
    console.log(
      `  ${i + 1}  | ${r.model.padEnd(20)} |     ${String(r.totalScore).padStart(3)}/18  | ${String(Math.round(r.avgElapsed)).padStart(5)}ms | ${count > 0 ? Math.round(avgTokens / count) : '-'}`
    );
  }

  // Per-problem breakdown
  console.log('\n--- Per-Problem Breakdown ---\n');
  for (const prob of PROBLEMS) {
    console.log(`[${prob.difficulty}] ${prob.id}`);
    console.log('-'.repeat(40));
    for (const r of [...results].sort((a, b) => {
      const sa = a.problems.find(p => p.problem === prob.id)?.score || 0;
      const sb = b.problems.find(p => p.problem === prob.id)?.score || 0;
      return sb - sa;
    })) {
      const p = r.problems.find(p => p.problem === prob.id);
      if (!p) continue;
      const status = p.ok ? `OK` : 'FAIL';
      console.log(`  ${r.model.padEnd(20)} ${status}  score=${p.score}/6  ${p.elapsed}ms${p.ok ? `  tokens=${p.outputTokens || '-'}` : `  err=${p.error}`}`);
    }
    console.log();
  }

  const report = {
    summary: sorted.map((r, i) => ({
      rank: i + 1,
      model: r.model,
      id: r.id,
      totalScore: r.totalScore,
      avgElapsedMs: Math.round(r.avgElapsed),
    })),
    details: results,
    problems: PROBLEMS,
    timestamp: new Date().toISOString(),
  };

  writeFileSync('./bench-results.json', JSON.stringify(report, null, 2));
  console.log('\nFull results saved to bench-results.json');
}

run().catch(console.error);
