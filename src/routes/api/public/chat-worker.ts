import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/chat-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { job_id?: unknown };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Érvénytelen kérés." }, { status: 400 });
        }
        const jobId = typeof body.job_id === "string" ? body.job_id : "";
        if (!/^[0-9a-fA-F-]{36}$/.test(jobId)) return Response.json({ error: "Érvénytelen munkaazonosító." }, { status: 400 });
        const { executeChatJob } = await import("@/lib/chat-jobs.server");
        const result = await executeChatJob(jobId);
        return Response.json(result);
      },
    },
  },
});
