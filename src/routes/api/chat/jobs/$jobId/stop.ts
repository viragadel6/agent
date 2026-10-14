import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/chat/jobs/$jobId/stop")({
  server: {
    handlers: {
      POST: async ({ params }) => {
        const jobId = params.jobId;
        if (!/^[0-9a-fA-F-]{36}$/.test(jobId)) {
          return Response.json({ error: "Érvénytelen munkaazonosító." }, { status: 400 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: job } = await supabaseAdmin.from("chat_jobs").select("id,status").eq("id", jobId).maybeSingle();
        if (!job) return Response.json({ error: "A munka nem található." }, { status: 404 });
        if (job.status === "queued") {
          await supabaseAdmin.from("chat_jobs").update({ status: "cancelled", stop_requested: true, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", jobId);
        } else if (job.status === "running") {
          await supabaseAdmin.from("chat_jobs").update({ stop_requested: true, updated_at: new Date().toISOString() }).eq("id", jobId);
        }
        return Response.json({ ok: true });
      },
    },
  },
});
