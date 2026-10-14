import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/conversations")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const ids = (url.searchParams.get("ids") ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter((value) => /^[0-9a-fA-F-]{36}$/.test(value))
          .slice(0, 100);
        if (!ids.length) return Response.json({ conversations: [] });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: conversations } = await supabaseAdmin
          .from("chat_conversations")
          .select("id,title,messages,created_at,updated_at")
          .in("id", ids);
        const { data: jobs } = await supabaseAdmin
          .from("chat_jobs")
          .select("id,conversation_id,status,response_content,response_reasoning,error,created_at,updated_at")
          .in("conversation_id", ids)
          .order("created_at", { ascending: false });
        const latestByConversation = new Map<string, NonNullable<typeof jobs>[number]>();
        for (const job of jobs ?? []) {
          if (!latestByConversation.has(job.conversation_id)) latestByConversation.set(job.conversation_id, job);
        }
        const jobIds = (jobs ?? []).map((job) => job.id);
        const lastEventByJob = new Map<string, number>();
        if (jobIds.length) {
          const { data: eventRows } = await supabaseAdmin
            .from("chat_job_events")
            .select("job_id,id")
            .in("job_id", jobIds)
            .order("id", { ascending: false })
            .limit(1000);
          for (const row of eventRows ?? []) {
            if (!lastEventByJob.has(row.job_id)) lastEventByJob.set(row.job_id, row.id);
          }
        }
        const result = (conversations ?? []).map((conversation) => {
          const job = latestByConversation.get(conversation.id);
          return {
            conversation_id: conversation.id,
            title: conversation.title,
            messages: conversation.messages,
            created_at: conversation.created_at,
            updated_at: conversation.updated_at,
            latest_job: job
              ? {
                  job_id: job.id,
                  conversation_id: job.conversation_id,
                  status: job.status,
                  response_content: job.response_content,
                  response_reasoning: job.response_reasoning,
                  error: job.error,
                  last_event_id: lastEventByJob.get(job.id) ?? 0,
                }
              : null,
          };
        });
        return Response.json({ conversations: result });
      },
    },
  },
});
