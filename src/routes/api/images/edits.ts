import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/images/edits")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env["FLYMYAI_API_KEY"];
        if (!apiKey) return Response.json({ message: "A FlyMyAI kulcs nincs beállítva." }, { status: 503 });
        let form: FormData;
        try { form = await request.formData(); }
        catch { return Response.json({ message: "A képfeltöltés nem olvasható." }, { status: 400 }); }
        const image = form.get("image");
        const prompt = form.get("prompt");
        if (!(image instanceof File) || !image.size || typeof prompt !== "string" || !prompt.trim()) {
          return Response.json({ message: "Adj meg egy kiinduló képet és képleírást." }, { status: 400 });
        }
        const payload = new FormData();
        payload.append("image", image, image.name);
        payload.append("prompt", prompt);
        payload.append("quality", String(form.get("quality") || "medium"));
        payload.append("size", String(form.get("size") || "1024x1024"));
        try {
          const upstream = await fetch("https://api.flymy.ai/api/v1/flymyai/gpt-image-2-5-sunburst_edit/predict", {
            method: "POST",
            headers: { "X-API-KEY": apiKey },
            body: payload,
          });
          return new Response(upstream.body, {
            status: upstream.status,
            headers: {
              "Content-Type": upstream.headers.get("Content-Type") || "application/json",
              "Cache-Control": "no-store",
            },
          });
        } catch {
          return Response.json({ message: "A FlyMyAI nem érhető el; próbáld újra később." }, { status: 502 });
        }
      },
    },
  },
});