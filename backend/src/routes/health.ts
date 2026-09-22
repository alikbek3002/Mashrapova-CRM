import type { FastifyInstance } from "fastify";
import { supabaseAdmin } from "../lib/supabase.js";

export const healthRoute = async (app: FastifyInstance) => {
  app.get("/health", async () => {
    const start = Date.now();
    const { error } = await supabaseAdmin.from("organizations").select("id").limit(1);
    return {
      status: error ? "degraded" : "ok",
      supabase: error ? "error" : "connected",
      latency_ms: Date.now() - start,
      timestamp: new Date().toISOString(),
    };
  });
};
