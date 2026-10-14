import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/jobs/$jobId/redirect")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const jobId = params.jobId;
        if (!/^[0-9a-fA-F-]{36}$/.test(jobId)) {
          return Response.json({ error: "Érvénytelen munkaazonosító." }, { status: 400 });
        }
        let body: { message?: unknown };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Érvénytelen kérés." }, { status: 400 });
        }
        const message = typeof body.message === "string" ? body.message.trim() : "";
        if (!message) return Response.json({ error: "Üres üzenet nem küldhető." }, { status: 400 });
        if (message.length > 32000) return Response.json({ error: "Az üzenet túl hosszú." }, { status: 400 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: job } = await supabaseAdmin.from("chat_jobs").select("id,status").eq("id", jobId).maybeSingle();
        if (!job) return Response.json({ error: "A munka nem található." }, { status: 404 });
        if (job.status !== "running" && job.status !== "queued") {
          return Response.json({ error: "A munka már lezárult, új irányt nem kaphat." }, { status: 409 });
        }
        const { postOperatorMessage } = await import("@/lib/cognitive.server");
        await postOperatorMessage(jobId, message);
        return Response.json({ ok: true });
      },
    },
  },
});
