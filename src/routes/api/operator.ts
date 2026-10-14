import { createFileRoute } from "@tanstack/react-router";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/operator")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown;
        try { body = await request.json(); } catch { return Response.json({ error: "Hibás JSON." }, { status: 400 }); }
        const record = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
        const taskId = record.task_id;
        const content = record.content;
        if (typeof taskId !== "string" || !UUID.test(taskId)) return Response.json({ error: "Hibás task_id." }, { status: 400 });
        if (typeof content !== "string" || !content.trim()) return Response.json({ error: "Üres üzenet." }, { status: 400 });
        const { postOperatorMessage } = await import("@/lib/cognitive.server");
        try {
          await postOperatorMessage(taskId, content.trim());
        } catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : "Mentési hiba." }, { status: 500 });
        }
        return Response.json({ accepted: true });
      }
    }
  }
});
