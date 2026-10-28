// MCP-сервер CRM: POST /mcp (Streamable HTTP, без сессий).
// На каждый запрос — свой McpServer от имени вошедшего человека: так
// инструменты всегда видят ровно его права, и нечего делить между запросами.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { env } from "../lib/env.js";
import { supabaseAdmin } from "../lib/supabase.js";
import { fail, makeCtx, ToolError } from "./context.js";
import { baseUrl, mcpOAuthRoutes, SCOPE } from "./oauth.js";
import { loginPage } from "./page.js";
import { resolveBearer, type McpUser } from "./session.js";
import { readTools } from "./tools/read.js";
import type { ToolDef } from "./tools/types.js";
import { writeTools } from "./tools/write.js";

const INSTRUCTIONS = `CRM «Академии Машрапова» — клуб единоборств и фитнеса в Оше (бокс, ММА, вольная борьба, дзюдо, кикбоксинг, тхэквондо, фитнес-зона).
Валюта — сом (KGS), часовой пояс — Бишкек (UTC+6). Отвечай по-русски, коротко, с цифрами.
С чего начинать: «как дела» → dashboard; продажи и менеджеры → managers_kpi и leads_report; конкретный человек → clients_search, затем client_card; id секций, групп, тарифов и менеджеров → reference_data.
Заявки из Instagram и WhatsApp приходят из Kommo каждые 5 минут; их этап меняется в Kommo, а не здесь.
Любое изменение данных (новый клиент, оплата, продажа абонемента, заморозка, депозит) сначала опиши человеку одной строкой — кто, что, сколько — и выполняй только после явного «да». Данные не удаляются: в CRM всё только архивируется.`;

const toolList: ToolDef[] = [...readTools, ...writeTools];

const audit = (user: McpUser, tool: string, args: unknown, okFlag: boolean, error: string | null, ms: number) =>
  supabaseAdmin.from("mcp_audit").insert({
    profile_id: user.id, session_id: user.sessionId, tool, args, ok: okFlag, error, ms,
  }).then(({ error: e }) => { if (e) console.warn("mcp_audit_failed", e.message); });

const buildServer = (app: FastifyInstance, user: McpUser) => {
  const server = new McpServer(
    { name: "mashrapova-crm", title: "CRM Академии Машрапова", version: "1.0.0" },
    { instructions: INSTRUCTIONS },
  );
  const ctx = makeCtx(app, user);
  for (const t of toolList) {
    server.registerTool(
      t.name,
      {
        title: t.title,
        description: t.description,
        inputSchema: t.input,
        annotations: {
          title: t.title,
          readOnlyHint: !t.write,
          destructiveHint: false,
          idempotentHint: !t.write,
          openWorldHint: false,
          ...t.annotations,
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (args: any) => {
        const started = Date.now();
        try {
          const res = await t.run(ctx, args);
          if (t.write) void audit(user, t.name, args, !res.isError, null, Date.now() - started);
          return res;
        } catch (e) {
          const msg = e instanceof ToolError ? e.message : `Ошибка CRM: ${(e as Error).message}`;
          if (!(e instanceof ToolError)) app.log.error({ err: e, tool: t.name }, "mcp_tool_failed");
          void audit(user, t.name, args, false, msg, Date.now() - started);
          return fail(msg);
        }
      },
    );
  }
  return server;
};

const unauthorized = (req: FastifyRequest, reply: FastifyReply, error = "invalid_token") =>
  reply
    .code(401)
    .header(
      "www-authenticate",
      `Bearer error="${error}", scope="${SCOPE}", resource_metadata="${baseUrl(req)}/.well-known/oauth-protected-resource"`,
    )
    .send({ error, error_description: "Подключите CRM заново: войдите телефоном и паролем" });

export const mcpRoutes = async (app: FastifyInstance) => {
  await app.register(mcpOAuthRoutes);

  app.post("/mcp", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!env.MCP_SECRET) return reply.code(503).send({ error: "mcp_disabled" });
    const h = req.headers.authorization;
    if (!h?.startsWith("Bearer ")) return unauthorized(req, reply, "invalid_request");
    const user = await resolveBearer(h.slice(7));
    if (!user) return unauthorized(req, reply);

    const server = buildServer(app, user);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    reply.hijack();
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });

  // Без сессий: серверных уведомлений по GET и закрытия сессии нет.
  const notAllowed = async (_req: FastifyRequest, reply: FastifyReply) =>
    reply.code(405).header("allow", "POST").send({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
  // Человек открыл адрес в браузере — объясняем, куда его вставлять.
  app.get("/mcp", async (req, reply) => {
    if (String(req.headers.accept ?? "").includes("text/html")) {
      return reply.header("content-type", "text/html; charset=utf-8").send(loginPage({ step: "info" }));
    }
    return notAllowed(req, reply);
  });
  app.delete("/mcp", notAllowed);
};

// Пути MCP открыты для любых Origin: их вызывают Claude, ChatGPT и
// MCP Inspector, а не наш фронтенд. Защита — токен, а не CORS.
export const isMcpPath = (url: string) =>
  url === "/mcp" || url.startsWith("/mcp?") || url.startsWith("/oauth/") || url.startsWith("/.well-known/");
