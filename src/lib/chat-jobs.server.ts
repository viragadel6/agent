import type { AgentEvent, AgentSink, ChatMessage } from "@/routes/api/chat";

const LEASE_MS = 90_000;
const HEARTBEAT_MS = 20_000;
const PUBLISHED_ORIGIN = "https://chat-pal-deploy.lovable.app";

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function workerOrigin(requestUrl: string): string | null {
  const url = new URL(requestUrl);
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return null;
  if (url.hostname.startsWith("id-preview--")) return PUBLISHED_ORIGIN;
  return url.origin;
}

export async function dispatchChatJob(jobId: string, requestUrl: string): Promise<void> {
  const origin = workerOrigin(requestUrl);
  if (!origin) {
    executeChatJob(jobId).catch((error) => console.error(JSON.stringify({ kind: "chat_local_worker_failed", job_id: jobId, message: error instanceof Error ? error.message : "ismeretlen" })));
    return;
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.rpc("kick_chat_worker", { _base_url: origin, _job_id: jobId });
  if (error) throw new Error("A háttérmunka indítása sikertelen.");
}

export async function reviveStaleChatJob(jobId: string, requestUrl: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: job } = await supabaseAdmin.from("chat_jobs").select("status,lease_expires_at,stop_requested").eq("id", jobId).maybeSingle();
  if (!job || job.stop_requested) return;
  const stale = job.status === "queued" || (job.status === "running" && (!job.lease_expires_at || new Date(job.lease_expires_at) < new Date()));
  if (stale) await dispatchChatJob(jobId, requestUrl);
}

export async function executeChatJob(jobId: string): Promise<{ status: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: job } = await supabaseAdmin.from("chat_jobs").select("id,history,status,lease_expires_at,stop_requested").eq("id", jobId).maybeSingle();
  if (!job || job.status === "completed" || job.status === "cancelled" || job.status === "failed") return { status: job?.status ?? "missing" };
  if (job.stop_requested) {
    await supabaseAdmin.from("chat_jobs").update({ status: "cancelled", finished_at: new Date().toISOString(), lease_expires_at: null }).eq("id", jobId);
    return { status: "cancelled" };
  }
  const now = new Date();
  if (job.status === "running" && job.lease_expires_at && new Date(job.lease_expires_at) > now) return { status: "running" };
  let claim = supabaseAdmin.from("chat_jobs").update({ status: "running", started_at: now.toISOString(), updated_at: now.toISOString(), lease_expires_at: new Date(now.getTime() + LEASE_MS).toISOString() }).eq("id", jobId).eq("status", job.status);
  claim = job.lease_expires_at ? claim.eq("lease_expires_at", job.lease_expires_at) : claim.is("lease_expires_at", null);
  const { data: claimed } = await claim.select("id").maybeSingle();
  if (!claimed) return { status: "running" };

  const controller = new AbortController();
  let content = "";
  let reasoning = "";
  let finalStatus = "failed";
  const heartbeat = setInterval(() => {
    supabaseAdmin
      .from("chat_jobs")
      .update({ lease_expires_at: new Date(Date.now() + LEASE_MS).toISOString(), updated_at: new Date().toISOString() })
      .eq("id", jobId)
      .select("stop_requested")
      .maybeSingle()
      .then(({ data }) => {
        if (data?.stop_requested) controller.abort(new Error("A munkát leállították."));
      }, () => undefined);
  }, HEARTBEAT_MS);
  const sink: AgentSink = {
    async send(event: AgentEvent) {
      if (event.type === "delta") {
        content += text(event.content);
        reasoning += text(event.reasoning_content);
      }
      if (event.type === "done") finalStatus = event.outcome === "completed" ? "completed" : event.outcome === "cancelled" ? "cancelled" : "failed";
      await supabaseAdmin.from("chat_job_events").insert({ job_id: jobId, payload: event });
      if (event.type !== "delta" || content.length + reasoning.length < 200 || Math.random() < 0.1) {
        await supabaseAdmin.from("chat_jobs").update({ response_content: content, response_reasoning: reasoning, updated_at: new Date().toISOString() }).eq("id", jobId);
      }
    },
    async enqueue(value: string) {
      if (value.includes("[DONE]") && finalStatus === "failed") finalStatus = "completed";
    },
  };
  try {
    const { runDurableChat } = await import("@/routes/api/chat");
    await runDurableChat(jobId, job.history as ChatMessage[], sink, controller.signal);
  } catch (error) {
    finalStatus = controller.signal.aborted ? "cancelled" : "failed";
    await sink.send({ type: "error", task_id: jobId, code: "BACKGROUND_FAILURE", message: error instanceof Error ? error.message : "A háttérmunka hibával leállt." }).catch(() => undefined);
  } finally {
    clearInterval(heartbeat);
  }
  await supabaseAdmin.from("chat_jobs").update({ status: finalStatus, response_content: content, response_reasoning: reasoning, error: finalStatus === "failed" ? "A háttérmunka hibával leállt." : null, finished_at: new Date().toISOString(), lease_expires_at: null, updated_at: new Date().toISOString() }).eq("id", jobId);
  return { status: finalStatus };
}

const FOLLOW_POLL_MS = 800;
const FOLLOW_HEARTBEAT_MS = 15000;
const FOLLOW_MAX_MS = 21_600_000;
const FOLLOW_REVIVE_MS = 30_000;

export function followChatJob(jobId: string, after: number, signal: AbortSignal, requestUrl: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let cursor = after;
      let closed = false;
      const startedAt = Date.now();
      let lastHeartbeat = 0;
      let lastRevive = Date.now();
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {}
      };
      signal.addEventListener("abort", close, { once: true });
      const push = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close();
        }
      };
      await reviveStaleChatJob(jobId, requestUrl).catch(() => undefined);
      while (!closed && !signal.aborted) {
        if (Date.now() - startedAt > FOLLOW_MAX_MS) {
          push(`data: ${JSON.stringify({ type: "error", task_id: jobId, code: "RUNTIME_LIMIT", message: "Lejárt a teljes feladathatáridő." })}\n\n`);
          break;
        }
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: events } = await supabaseAdmin.from("chat_job_events").select("id,payload").eq("job_id", jobId).gt("id", cursor).order("id", { ascending: true }).limit(200);
          let terminal = false;
          for (const row of events ?? []) {
            cursor = Math.max(cursor, row.id);
            const payload = row.payload as { type?: string };
            push(`id: ${row.id}\ndata: ${JSON.stringify(payload)}\n\n`);
            if (payload?.type === "done" || payload?.type === "error") terminal = true;
          }
          if (terminal) break;
          if ((events ?? []).length) continue;
          const { data: job } = await supabaseAdmin.from("chat_jobs").select("status").eq("id", jobId).single();
          if (!job || (job.status !== "queued" && job.status !== "running")) {
            const { data: rest } = await supabaseAdmin.from("chat_job_events").select("id,payload").eq("job_id", jobId).gt("id", cursor).order("id", { ascending: true }).limit(200);
            for (const row of rest ?? []) {
              cursor = Math.max(cursor, row.id);
              push(`id: ${row.id}\ndata: ${JSON.stringify(row.payload)}\n\n`);
            }
            break;
          }
          if (Date.now() - lastRevive >= FOLLOW_REVIVE_MS) {
            lastRevive = Date.now();
            await reviveStaleChatJob(jobId, requestUrl).catch(() => undefined);
          }
        } catch (error) {
          push(`data: ${JSON.stringify({ type: "error", task_id: jobId, code: "FOLLOW_FAILURE", message: error instanceof Error ? error.message : "Az eseményfolyam megszakadt." })}\n\n`);
          break;
        }
        const now = Date.now();
        if (now - lastHeartbeat >= FOLLOW_HEARTBEAT_MS) {
          lastHeartbeat = now;
          push(`: heartbeat\n\n`);
        }
        await new Promise((resolve) => setTimeout(resolve, FOLLOW_POLL_MS));
      }
      close();
    },
    cancel() {},
  });
}
