import { createFileRoute } from "@tanstack/react-router";
import { followChatJob } from "@/lib/chat-jobs.server";

export const Route = createFileRoute("/api/chat/jobs/$jobId/events")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const jobId = params.jobId;
        if (!/^[0-9a-fA-F-]{36}$/.test(jobId)) {
          return Response.json({ error: "Érvénytelen munkaazonosító." }, { status: 400 });
        }
        const url = new URL(request.url);
        const after = Math.max(0, parseInt(url.searchParams.get("after") ?? "0", 10) || 0);
        const stream = followChatJob(jobId, after, request.signal, request.url);
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "private, no-store, no-cache, no-transform",
            "X-Accel-Buffering": "no",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});
