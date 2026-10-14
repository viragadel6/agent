const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const FAST_MODEL = "models/gemini-3.8-flash";
const ADVISOR_MODEL = "models/gemini-3.1-pro-preview";
const CONSENSUS_MODELS = ["models/gemini-3.8-flash", "models/gemini-3.5-flash", "models/gemini-3.1-pro-preview"];
const TOOLS = [{ type: "code_execution" }, { type: "google_search" }, { type: "url_context" }];

export type SubagentResult = { status: "completed" | "error"; result: Record<string, unknown> };

function collectText(value: unknown, out: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, out);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (record.type === "text" && typeof record.text === "string") out.push(record.text);
  for (const key of ["outputs", "steps", "content", "parts"]) {
    if (key in record) collectText(record[key], out);
  }
}

async function interact(model: string, input: string, signal: AbortSignal): Promise<{ model: string; text: string }> {
  const key = process.env["GEMINI_API_KEY"];
  if (!key) throw new Error("A GEMINI_API_KEY nincs beállítva.");
  let attempt = 0;
  for (;;) {
    const response = await fetch(INTERACTIONS_URL, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ model, input, tools: TOOLS, generation_config: { max_output_tokens: 65536, thinking_level: "high" } }),
      signal,
    });
    const body = await response.text();
    if (response.ok) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        throw new Error(`${model}: érvénytelen válasz.`);
      }
      const parts: string[] = [];
      collectText(parsed, parts);
      const text = parts.join("\n").trim();
      if (!text) throw new Error(`${model}: üres válasz.`);
      return { model, text };
    }
    let message = body.slice(0, 500);
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } };
      if (parsed.error?.message) message = parsed.error.message;
    } catch {}
    if ((response.status === 429 || response.status >= 500) && attempt < 2 && !/quota/i.test(message)) {
      attempt += 1;
      const wait = Number(response.headers.get("retry-after")) * 1000 || 2000 * 2 ** attempt + Math.random() * 1000;
      await new Promise((resolve) => setTimeout(resolve, wait));
      continue;
    }
    throw new Error(`${model} (${response.status}): ${message}`);
  }
}

function errorResult(error: unknown): SubagentResult {
  return { status: "error", result: { code: "SUBAGENT_FAILED", message: error instanceof Error ? error.message : "Az alügynök hibával leállt." } };
}

export async function delegateTask(task: string, context: string, signal: AbortSignal): Promise<SubagentResult> {
  try {
    const input = `Önálló alügynök vagy. Hajtsd végre pontosan a részfeladatot; kódfuttatást, Google keresést és URL-olvasást használhatsz. Adj tömör, ellenőrzött eredményt magyarul, forrásokkal ha kerestél.\n\nKontextus:\n${context || "nincs"}\n\nRészfeladat:\n${task}`;
    const answer = await interact(FAST_MODEL, input, signal);
    return { status: "completed", result: { model: answer.model, answer: answer.text } };
  } catch (error) {
    return errorResult(error);
  }
}

export async function consultAdvisor(question: string, context: string, signal: AbortSignal): Promise<SubagentResult> {
  try {
    const input = `Szakértő tanácsadó vagy egy autonóm ügynök mellett. Elemezd a helyzetet, mutass rá hibákra és kockázatokra, és adj konkrét, sorrendbe állított javaslatot a továbblépésre magyarul.\n\nHelyzet:\n${context || "nincs"}\n\nKérdés:\n${question}`;
    const answer = await interact(ADVISOR_MODEL, input, signal);
    return { status: "completed", result: { model: answer.model, advice: answer.text } };
  } catch (error) {
    return errorResult(error);
  }
}

export async function multiModelConsensus(question: string, context: string, signal: AbortSignal): Promise<SubagentResult> {
  const input = `Válaszolj önállóan és indokolva magyarul a kérdésre; ellenőrizd keresővel vagy kóddal, ahol lehet.\n\nKontextus:\n${context || "nincs"}\n\nKérdés:\n${question}`;
  const settled = await Promise.allSettled(CONSENSUS_MODELS.map((model) => interact(model, input, signal)));
  const answers = settled.flatMap((entry) => (entry.status === "fulfilled" ? [entry.value] : []));
  const failures = settled.flatMap((entry) => (entry.status === "rejected" ? [entry.reason instanceof Error ? entry.reason.message : String(entry.reason)] : []));
  if (!answers.length) return { status: "error", result: { code: "SUBAGENT_FAILED", message: "Egyik modell sem válaszolt.", failures } };
  try {
    const synthesisInput = `Több modell független válaszát kaptad ugyanarra a kérdésre. Hasonlítsd össze őket: hol értenek egyet, hol térnek el, melyik érvelés erősebb. Adj végső, megalapozott konszenzusválaszt és bizonyossági szintet magyarul.\n\nKérdés:\n${question}\n\n${answers.map((answer, index) => `### ${index + 1}. válasz (${answer.model})\n${answer.text}`).join("\n\n")}`;
    const synthesis = await interact(ADVISOR_MODEL, synthesisInput, signal);
    return { status: "completed", result: { consensus: synthesis.text, answers: answers.map((answer) => ({ model: answer.model, answer: answer.text })), failures } };
  } catch (error) {
    return { status: "completed", result: { consensus: null, synthesis_error: error instanceof Error ? error.message : String(error), answers: answers.map((answer) => ({ model: answer.model, answer: answer.text })), failures } };
  }
}
