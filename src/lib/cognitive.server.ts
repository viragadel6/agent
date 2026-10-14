import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type Think = (system: string, user: string) => Promise<string>;
export type Probe = (command: string) => Promise<boolean>;

export type Phase = "osPerceive" | "osDeliberate" | "osAct" | "osValidate" | "osReflect" | "osConsolidate";

const TRANSITIONS: Record<Phase, Phase[]> = {
  osPerceive: ["osDeliberate", "osConsolidate"],
  osDeliberate: ["osAct", "osConsolidate"],
  osAct: ["osAct", "osValidate", "osReflect", "osPerceive", "osDeliberate", "osConsolidate"],
  osValidate: ["osReflect", "osConsolidate"],
  osReflect: ["osDeliberate", "osConsolidate"],
  osConsolidate: []
};

export class Lifecycle {
  phase: Phase = "osPerceive";
  readonly trail: Phase[] = ["osPerceive"];
  constructor(private readonly onChange: (from: Phase, to: Phase) => Promise<void>) {}
  async to(next: Phase): Promise<void> {
    if (!TRANSITIONS[this.phase].includes(next)) throw new Error(`Tiltott fázisátmenet: ${this.phase} -> ${next}`);
    const from = this.phase;
    this.phase = next;
    this.trail.push(next);
    await this.onChange(from, next);
  }
}

export const VECTOR_DIMS = [
  "confidence", "progress", "risk", "uncertainty", "complexity", "novelty", "urgency", "tool_need",
  "info_need", "verification_need", "reversibility", "resource_cost", "alignment", "coherence", "momentum", "blocker_pressure"
] as const;

const GATE_WEIGHTS: Record<(typeof VECTOR_DIMS)[number], number> = {
  confidence: 1.6, progress: 0.8, risk: -1.4, uncertainty: -1.2, complexity: -0.4, novelty: -0.3, urgency: 0.3, tool_need: 0.2,
  info_need: -0.9, verification_need: -0.3, reversibility: 0.7, resource_cost: -0.4, alignment: 1.0, coherence: 0.9, momentum: 0.5, blocker_pressure: -1.3
};

export type GateDecision = "act" | "probe" | "replan";
export type Subgoal = { id: string; text: string; done: boolean };
export type GoalSpec = {
  state_pointers: { pointer: string; equals: unknown }[];
  required_files: string[];
  file_contents: { path: string; contains: string }[];
};
export type Sigma = {
  objective: string;
  strategy: string;
  subgoals: Subgoal[];
  closed_subgoals: number;
  facts: string[];
  blockers: string[];
  next_steps: string[];
  vector: number[];
  gate: number;
  decision: GateDecision;
  goal: GoalSpec;
};

export function emptySigma(objective: string): Sigma {
  return {
    objective: clip(objective, 4000), strategy: "", subgoals: [], closed_subgoals: 0, facts: [], blockers: [], next_steps: [],
    vector: VECTOR_DIMS.map(() => 0.5), gate: 0.5, decision: "act", goal: { state_pointers: [], required_files: [], file_contents: [] }
  };
}

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function rec(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (!rec(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) if (key !== "messages" && key !== "chain_of_thought") out[key] = strip(inner);
  return out;
}

export function maintain(sigma: Sigma): Sigma {
  const closed = sigma.subgoals.filter((g) => g.done).length;
  const clean = strip(sigma) as Sigma;
  clean.subgoals = clean.subgoals.filter((g) => !g.done).slice(0, 12).map((g) => ({ id: clip(g.id, 40), text: clip(g.text, 400), done: false }));
  clean.closed_subgoals = sigma.closed_subgoals + closed;
  clean.facts = [...new Set(clean.facts.map((f) => clip(f, 400)))].slice(-20);
  clean.blockers = [...new Set(clean.blockers.map((b) => clip(b, 400)))].slice(-8);
  clean.next_steps = clean.next_steps.slice(0, 8).map((s) => clip(s, 400));
  clean.strategy = clip(clean.strategy, 2000);
  return clean;
}

export function gate(vector: number[]): { gate: number; decision: GateDecision } {
  let z = -0.6;
  VECTOR_DIMS.forEach((dim, i) => { z += GATE_WEIGHTS[dim] * (vector[i] ?? 0.5); });
  const g = 1 / (1 + Math.exp(-z));
  return { gate: g, decision: g >= 0.5 ? "act" : g >= 0.3 ? "probe" : "replan" };
}

export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced?.[1] ?? text;
  const start = body.search(/[[{]/);
  if (start < 0) return null;
  const open = body[start];
  const close = open === "{" ? "}" : "]";
  const end = body.lastIndexOf(close);
  if (end <= start) return null;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return null; }
}

function strings(value: unknown, max: number): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).slice(0, max) : [];
}

export async function deliberate(think: Think, sigma: Sigma, trace: string, guidance: string): Promise<Sigma> {
  const system = [
    "Te a System 2 stratégiai tervező vagy. Kizárólag egyetlen JSON objektumot adj vissza, magyarázat nélkül.",
    "Séma: {\"strategy\": string, \"subgoals\": [{\"id\": string, \"text\": string, \"done\": boolean}], \"next_steps\": [string], \"vector\": [16 szám 0 és 1 között], \"goal\": {\"state_pointers\": [{\"pointer\": JSON-pointer a munkamemóriába, \"equals\": érték}], \"required_files\": [abszolút útvonal], \"file_contents\": [{\"path\": string, \"contains\": string}]}}",
    `A vector dimenziói sorrendben: ${VECTOR_DIMS.join(", ")}.`,
    "A next_steps legfeljebb 5 konkrét, azonnal végrehajtható mikrolépés a System 1 számára.",
    "A goal csak olyan ellenőrizhető feltételeket tartalmazzon, amelyek a feladat valódi befejezését bizonyítják; ha nincs fájlkimenet, hagyd üresen a fájllistákat.",
    "Egyszerű beszélgetési üzenetnél vagy egylépéses kérdésnél a subgoals és a goal minden listája legyen üres."
  ].join("\n");
  const user = `MUNKAMEMÓRIA:\n${JSON.stringify(sigma)}\n\nTANULT ÚTMUTATÁS:\n${guidance || "nincs"}\n\nFRISS NYOMVONAL:\n${clip(trace, 8000)}`;
  const parsed = extractJson(await think(system, user));
  if (!rec(parsed)) return sigma;
  const next: Sigma = { ...sigma };
  if (typeof parsed.strategy === "string") next.strategy = parsed.strategy;
  if (Array.isArray(parsed.subgoals)) {
    next.subgoals = parsed.subgoals.filter(rec).map((g, i) => ({
      id: typeof g.id === "string" && g.id ? g.id : `g${i + 1}`,
      text: typeof g.text === "string" ? g.text : "",
      done: g.done === true
    })).filter((g) => g.text);
  }
  next.next_steps = strings(parsed.next_steps, 5);
  if (Array.isArray(parsed.vector) && parsed.vector.length === 16) {
    next.vector = parsed.vector.map((v) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5));
  }
  if (rec(parsed.goal)) {
    const goal = parsed.goal;
    next.goal = {
      state_pointers: Array.isArray(goal.state_pointers) ? goal.state_pointers.filter(rec).filter((p) => typeof p.pointer === "string").map((p) => ({ pointer: p.pointer as string, equals: p.equals })).slice(0, 10) : [],
      required_files: strings(goal.required_files, 20),
      file_contents: Array.isArray(goal.file_contents) ? goal.file_contents.filter(rec).filter((f) => typeof f.path === "string" && typeof f.contains === "string").map((f) => ({ path: f.path as string, contains: f.contains as string })).slice(0, 20) : []
    };
  }
  const g = gate(next.vector);
  next.gate = g.gate;
  next.decision = g.decision;
  return maintain(next);
}

export function applyStateUpdate(sigma: Sigma, args: Record<string, unknown>): Sigma {
  const next: Sigma = { ...sigma, facts: [...sigma.facts], blockers: [...sigma.blockers], subgoals: sigma.subgoals.map((g) => ({ ...g })) };
  if (typeof args.fact === "string" && args.fact.trim()) next.facts.push(args.fact.trim());
  if (typeof args.blocker === "string" && args.blocker.trim()) next.blockers.push(args.blocker.trim());
  if (typeof args.resolve_blocker === "string" && args.resolve_blocker.trim()) {
    const key = args.resolve_blocker.trim().toLowerCase();
    next.blockers = next.blockers.filter((b) => !b.toLowerCase().includes(key));
  }
  if (typeof args.complete_subgoal === "string" && args.complete_subgoal.trim()) {
    const key = args.complete_subgoal.trim();
    for (const g of next.subgoals) if (g.id === key || g.text === key) g.done = true;
  }
  return maintain(next);
}

function pointer(root: unknown, path: string): unknown {
  if (path === "" || path === "/") return root;
  if (!path.startsWith("/")) return undefined;
  let cur: unknown = root;
  for (const raw of path.slice(1).split("/")) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(cur)) cur = cur[Number(key)];
    else if (rec(cur)) cur = cur[key];
    else return undefined;
  }
  return cur;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function verify(sigma: Sigma, probe: Probe | null): Promise<{ ok: boolean; failures: string[] }> {
  const failures: string[] = [];
  for (const p of sigma.goal.state_pointers) {
    if (JSON.stringify(pointer(sigma, p.pointer)) !== JSON.stringify(p.equals)) failures.push(`Állapot nem egyezik: ${p.pointer}`);
  }
  const needsFiles = sigma.goal.required_files.length + sigma.goal.file_contents.length > 0;
  if (needsFiles && !probe) failures.push("Fájlellenőrzés szükséges, de nincs elérhető VM.");
  if (probe) {
    for (const path of sigma.goal.required_files) if (!(await probe(`test -f ${shellQuote(path)}`))) failures.push(`Hiányzó fájl: ${path}`);
    for (const fc of sigma.goal.file_contents) if (!(await probe(`grep -F -q -- ${shellQuote(fc.contains)} ${shellQuote(fc.path)}`))) failures.push(`Fájltartalom nem egyezik: ${fc.path}`);
  }
  if (sigma.blockers.length) failures.push(`Nyitott blokkolók: ${sigma.blockers.join("; ")}`);
  const open = sigma.subgoals.filter((g) => !g.done);
  if (open.length) failures.push(`Lezáratlan részcélok: ${open.map((g) => g.id).join(", ")}`);
  return { ok: failures.length === 0, failures };
}

export type Reflection = {
  failure_point: string;
  component: string;
  root_cause: string;
  pivot_action: string;
  patch: string;
  failed_action: string;
  corrective_action: string;
};

export async function reflect(think: Think, objective: string, trace: string, failedAction: string): Promise<Reflection> {
  const system = [
    "Hibaelemző vagy. A nyers nyomvonal alapján végezz gyökérok-elemzést. Kizárólag JSON-t adj vissza.",
    "Séma: {\"failure_point\": a kudarc pontos lépése, \"component\": felelős komponens (planner|executor|tool|environment|verifier|model), \"root_cause\": string, \"pivot_action\": egyetlen konkrét korrekciós lépés, \"patch\": javítócsomag leírása}"
  ].join("\n");
  const parsed = extractJson(await think(system, `CÉL:\n${objective}\n\nSIKERTELEN MŰVELET:\n${clip(failedAction, 2000)}\n\nNYOMVONAL:\n${clip(trace, 10000)}`));
  const r = rec(parsed) ? parsed : {};
  const str = (k: string, d: string) => (typeof r[k] === "string" && (r[k] as string).trim() ? clip(r[k] as string, 2000) : d);
  return {
    failure_point: str("failure_point", "ismeretlen lépés"),
    component: str("component", "executor"),
    root_cause: str("root_cause", "nem azonosítható"),
    pivot_action: str("pivot_action", "Vizsgáld meg újra a környezetet, mielőtt ismételsz."),
    patch: str("patch", ""),
    failed_action: clip(failedAction, 2000),
    corrective_action: ""
  };
}

const DIM = 256;

export function tokens(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
}

function fnv(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export function embed(text: string): number[] {
  const v = new Array<number>(DIM).fill(0);
  const t = tokens(text);
  for (let i = 0; i < t.length; i++) {
    const a = t[i] as string;
    v[fnv(a) % DIM] += 1;
    const b = t[i + 1];
    if (b) v[fnv(`${a} ${b}`) % DIM] += 0.5;
    for (let j = 0; j + 3 <= a.length; j++) v[fnv(`#${a.slice(j, j + 3)}`) % DIM] += 0.25;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] as number) * (b[i] as number);
  return s;
}

export type Skill = { id: string; name: string; dsl: string; terms: string; vector: number[]; successes: number; failures: number };

export async function retrieve(objective: string, context: string): Promise<{ skills: Skill[]; playbook: string }> {
  const [{ data: skills }, { data: playbooks }] = await Promise.all([
    supabaseAdmin.from("agent_skills").select("id,name,dsl,terms,vector,successes,failures").eq("status", "active").limit(500),
    supabaseAdmin.from("agent_playbooks").select("content").order("created_at", { ascending: false }).limit(1)
  ]);
  const query = `${objective}\n${context}`;
  const qv = embed(query);
  const qt = new Set(tokens(query));
  const ranked = (skills ?? []).map((s) => {
    const terms = tokens(`${s.name} ${s.terms}`);
    const lexical = terms.length ? terms.filter((t) => qt.has(t)).length / Math.sqrt(terms.length * Math.max(1, qt.size)) : 0;
    const rate = (s.successes + 1) / (s.successes + s.failures + 2);
    return { skill: s as Skill, score: 0.5 * cosine(qv, s.vector) + 0.3 * Math.min(1, lexical) + 0.2 * rate };
  }).filter((x) => x.score > 0.25).sort((a, b) => b.score - a.score).slice(0, 3);
  return { skills: ranked.map((x) => x.skill), playbook: playbooks?.[0]?.content ?? "" };
}

function ngrams(text: string): string[] {
  const t = tokens(text);
  const out: string[] = [];
  for (let i = 0; i + 1 < t.length; i++) out.push(`${t[i]} ${t[i + 1]}`);
  return out;
}

function distribution(grams: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const g of grams) m.set(g, (m.get(g) ?? 0) + 1);
  for (const [k, v] of m) m.set(k, v / grams.length);
  return m;
}

export async function distill(pairs: { failed: string; corrective: string }[]): Promise<void> {
  const deltas = new Map<string, number>();
  const eps = 1e-3;
  const lr = 0.5;
  for (const pair of pairs) {
    const fail = ngrams(pair.failed);
    const fix = ngrams(pair.corrective);
    if (!fail.length || !fix.length) continue;
    const p = distribution(fail);
    const q = distribution(fix);
    const advantage = 1;
    for (const g of new Set([...p.keys(), ...q.keys()])) {
      const qg = (q.get(g) ?? 0) + eps;
      const pg = (p.get(g) ?? 0) + eps;
      const reverseKl = qg * Math.log(qg / pg);
      const forwardKl = pg * Math.log(pg / qg);
      const d = lr * advantage * (reverseKl - forwardKl);
      if (Math.abs(d) > 1e-4) deltas.set(g, (deltas.get(g) ?? 0) + d);
    }
  }
  if (!deltas.size) return;
  const keys = [...deltas.keys()].slice(0, 400);
  const { data: existing } = await supabaseAdmin.from("agent_policy_weights").select("ngram,weight,observations").in("ngram", keys);
  const prev = new Map((existing ?? []).map((r) => [r.ngram, r]));
  const rows = keys.map((k) => {
    const old = prev.get(k);
    return { ngram: k, weight: (old?.weight ?? 0) + (deltas.get(k) ?? 0), observations: (old?.observations ?? 0) + 1, updated_at: new Date().toISOString() };
  });
  await supabaseAdmin.from("agent_policy_weights").upsert(rows, { onConflict: "ngram" });
}

export async function policyGuidance(): Promise<string> {
  const [{ data: favor }, { data: avoid }] = await Promise.all([
    supabaseAdmin.from("agent_policy_weights").select("ngram,weight").gt("weight", 0.01).order("weight", { ascending: false }).limit(8),
    supabaseAdmin.from("agent_policy_weights").select("ngram,weight").lt("weight", -0.01).order("weight", { ascending: true }).limit(8)
  ]);
  const lines: string[] = [];
  if (favor?.length) lines.push(`FAVOR: ${favor.map((r) => `"${r.ngram}"`).join(", ")}`);
  if (avoid?.length) lines.push(`AVOID: ${avoid.map((r) => `"${r.ngram}"`).join(", ")}`);
  return lines.join("\n");
}

export function validDsl(dsl: string): boolean {
  const lines = dsl.split("\n").map((l) => l.trim());
  const has = (k: string) => lines.some((l) => l.startsWith(`${k} `) || l.startsWith(`${k}:`));
  return has("SKILL") && has("WHEN") && has("REQUIRE") && has("STEP") && has("VERIFY") && has("RECOVER");
}

async function rollout(think: Think, objective: string, rootCause: string, skills: string[]): Promise<boolean> {
  const system = [
    "Izolált rollout-szimulátor vagy: a globális állapotot nem módosítod. Kizárólag JSON-t adj vissza.",
    "Feladat: a megadott képességek alkalmazásával tervezd meg a lépéseket, és döntsd el, hogy a terv elhárítja-e a megadott gyökérokot.",
    "Séma: {\"steps\": [string], \"addresses_root_cause\": boolean, \"verifiable\": boolean}"
  ].join("\n");
  const parsed = extractJson(await think(system, `FELADAT:\n${objective}\n\nKORÁBBI GYÖKÉROK:\n${rootCause}\n\nKÉPESSÉGEK:\n${skills.join("\n\n") || "nincs"}`));
  return rec(parsed) && parsed.addresses_root_cause === true && parsed.verifiable === true && strings(parsed.steps, 50).length > 0;
}

async function regressionGate(think: Think, candidate: string): Promise<{ accept: boolean; baseline: number; candidate: number }> {
  const [{ data: active }, { data: diag }] = await Promise.all([
    supabaseAdmin.from("agent_skills").select("dsl").eq("status", "active").limit(20),
    supabaseAdmin.from("agent_reflections").select("objective,root_cause").order("created_at", { ascending: false }).limit(12)
  ]);
  const seen = new Set<string>();
  const tasks = (diag ?? []).filter((d) => !seen.has(d.objective) && seen.add(d.objective)).slice(0, 3);
  if (!tasks.length) return { accept: false, baseline: 0, candidate: 0 };
  const base = (active ?? []).map((s) => s.dsl);
  const results = await Promise.all(tasks.map(async (t) => [await rollout(think, t.objective, t.root_cause, base), await rollout(think, t.objective, t.root_cause, [...base, candidate])] as const));
  const baseline = results.filter((r) => r[0]).length / results.length;
  const cand = results.filter((r) => r[1]).length / results.length;
  return { accept: cand >= baseline && cand > 0, baseline, candidate: cand };
}

async function synthesizeSkills(think: Think, log: (text: string) => Promise<void>): Promise<void> {
  const [{ data: refl }, { data: skills }] = await Promise.all([
    supabaseAdmin.from("agent_reflections").select("component,root_cause,pivot_action,patch,objective").order("created_at", { ascending: false }).limit(50),
    supabaseAdmin.from("agent_skills").select("vector").neq("status", "rejected").limit(500)
  ]);
  const items = (refl ?? []).map((r) => ({ ...r, v: embed(`${r.component} ${r.root_cause}`) }));
  const used = new Set<number>();
  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue;
    const cluster = [i];
    for (let j = i + 1; j < items.length; j++) if (!used.has(j) && items[j]?.component === items[i]?.component && cosine(items[i]!.v, items[j]!.v) >= 0.55) cluster.push(j);
    if (cluster.length < 2) continue;
    cluster.forEach((c) => used.add(c));
    const group = cluster.map((c) => items[c]!);
    const centroid = embed(group.map((g) => `${g.component} ${g.root_cause}`).join(" "));
    if ((skills ?? []).some((s) => cosine(s.vector, centroid) >= 0.8)) continue;
    const system = [
      "Meta-ágens vagy: a visszatérő hibamintából újrahasznosítható képességet szintetizálsz SKILL DSL nyelven. Csak a DSL-t add vissza.",
      "Kötelező formátum, minden záradék külön sorban:",
      "SKILL <rövid_snake_case_név>",
      "WHEN <alkalmazási feltétel>",
      "REQUIRE <előfeltétel>",
      "STEP <lépés> (több STEP sor is lehet)",
      "VERIFY <ellenőrizhető sikerfeltétel>",
      "RECOVER <helyreállítási lépés hiba esetén>"
    ].join("\n");
    const dsl = (await think(system, group.map((g) => `KOMPONENS: ${g.component}\nGYÖKÉROK: ${g.root_cause}\nKORREKCIÓ: ${g.pivot_action}\nJAVÍTÁS: ${g.patch}`).join("\n---\n"))).replace(/```[a-z]*\n?|```/g, "").trim();
    if (!validDsl(dsl)) { await log("A szintetizált képesség érvénytelen DSL-t adott, elvetve."); continue; }
    const name = /^SKILL[:\s]+(.+)$/m.exec(dsl)?.[1]?.trim().slice(0, 80) ?? "skill";
    const gateResult = await regressionGate(think, dsl);
    await supabaseAdmin.from("agent_skills").insert({
      name, dsl, terms: tokens(dsl).slice(0, 200).join(" "), vector: centroid,
      status: gateResult.accept ? "active" : "rejected", baseline_rate: gateResult.baseline, candidate_rate: gateResult.candidate
    });
    await log(`Új képesség „${name}”: ${gateResult.accept ? "aktiválva" : "elutasítva"} (alap ${gateResult.baseline.toFixed(2)}, jelölt ${gateResult.candidate.toFixed(2)}).`);
  }
}

async function evolvePlaybook(think: Think, log: (text: string) => Promise<void>): Promise<void> {
  const [{ count }, { data: last }] = await Promise.all([
    supabaseAdmin.from("agent_tasks").select("id", { count: "exact", head: true }),
    supabaseAdmin.from("agent_playbooks").select("task_count").order("created_at", { ascending: false }).limit(1)
  ]);
  const total = count ?? 0;
  if (total - (last?.[0]?.task_count ?? 0) < 5) return;
  const [{ data: refl }, { data: skills }, { data: prev }] = await Promise.all([
    supabaseAdmin.from("agent_reflections").select("component,root_cause,pivot_action").order("created_at", { ascending: false }).limit(40),
    supabaseAdmin.from("agent_skills").select("name,dsl").eq("status", "active").limit(20),
    supabaseAdmin.from("agent_playbooks").select("content").order("created_at", { ascending: false }).limit(1)
  ]);
  const system = "Tapasztalati tudáskonszolidátor vagy. Írj tömör, ember által olvasható magyar működési kézikönyvet két szakasszal: 'Bevált eljárások' és 'Elkerülendő anti-patternek'. Legfeljebb 40 pont.";
  const content = (await think(system, `ELŐZŐ KÉZIKÖNYV:\n${prev?.[0]?.content ?? "nincs"}\n\nREFLEXIÓK:\n${(refl ?? []).map((r) => `- [${r.component}] ${r.root_cause} => ${r.pivot_action}`).join("\n")}\n\nAKTÍV KÉPESSÉGEK:\n${(skills ?? []).map((s) => s.dsl).join("\n\n")}`)).trim();
  if (!content) return;
  await supabaseAdmin.from("agent_playbooks").insert({ content: clip(content, 20000), task_count: total });
  await log("A működési kézikönyv frissült.");
}

export async function consolidate(think: Think, input: { taskId: string; objective: string; outcome: string; steps: number; verified: boolean; reflections: Reflection[]; usedSkills: string[] }, log: (text: string) => Promise<void>): Promise<void> {
  await supabaseAdmin.from("agent_tasks").insert({ id: input.taskId, objective: clip(input.objective, 4000), outcome: input.outcome, steps: input.steps, verified: input.verified });
  if (input.reflections.length) {
    await supabaseAdmin.from("agent_reflections").insert(input.reflections.map((r) => ({ ...r, task_id: input.taskId, objective: clip(input.objective, 4000) })));
    await distill(input.reflections.filter((r) => r.corrective_action).map((r) => ({ failed: r.failed_action, corrective: r.corrective_action })));
  }
  for (const id of input.usedSkills) {
    const { data } = await supabaseAdmin.from("agent_skills").select("successes,failures").eq("id", id).single();
    if (data) await supabaseAdmin.from("agent_skills").update(input.verified ? { successes: data.successes + 1 } : { failures: data.failures + 1 }).eq("id", id);
  }
  if (input.reflections.length) await synthesizeSkills(think, log);
  await evolvePlaybook(think, log);
}

export async function takeOperatorMessages(taskId: string): Promise<string[]> {
  const { data } = await supabaseAdmin.from("agent_operator_messages").select("id,content").eq("task_id", taskId).eq("consumed", false).order("created_at");
  if (!data?.length) return [];
  await supabaseAdmin.from("agent_operator_messages").update({ consumed: true }).in("id", data.map((d) => d.id));
  return data.map((d) => d.content);
}

export async function postOperatorMessage(taskId: string, content: string): Promise<void> {
  const { error } = await supabaseAdmin.from("agent_operator_messages").insert({ task_id: taskId, content: clip(content, 8000) });
  if (error) throw new Error(error.message);
}

export type ReasonNode = { question: string; answer: string; children: ReasonNode[] };

export async function reasonTree(think: Think, question: string, depth: number, branches: number): Promise<ReasonNode> {
  if (depth <= 0) {
    const answer = await think("Izolált következtető vagy. Tömören, tényszerűen válaszolj a kérdésre; ne javasolj állapotmódosítást.", question);
    return { question, answer: clip(answer, 3000), children: [] };
  }
  const parsed = extractJson(await think(`Bontsd a kérdést legfeljebb ${branches} független, kisebb alkérdésre. Csak JSON tömböt adj vissza stringekkel. Ha a kérdés atomi, adj vissza üres tömböt.`, question));
  const subs = strings(parsed, branches);
  const children = await Promise.all(subs.map((q) => reasonTree(think, q, depth - 1, branches)));
  const answer = children.length
    ? await think("Összegző vagy. Az alkérdésekre adott válaszokból adj tömör, következetes választ az eredeti kérdésre.", `EREDETI KÉRDÉS:\n${question}\n\nALVÁLASZOK:\n${children.map((c) => `- ${c.question}: ${c.answer}`).join("\n")}`)
    : await think("Izolált következtető vagy. Tömören, tényszerűen válaszolj a kérdésre.", question);
  return { question, answer: clip(answer, 3000), children };
}
