import type { ZodRawShape, z } from "zod";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { Ctx } from "../context.js";
import type { AppRole } from "../../middleware/auth.js";

// Один инструмент MCP. write=true — меняет данные: пишется в журнал
// mcp_audit с аргументами и помечается для клиента как не read-only.
export type ToolDef<S extends ZodRawShape = ZodRawShape> = {
  name: string;
  title: string;
  description: string;
  input: S;
  write?: boolean;
  // Кому доступен. Пусто — всем ролям MCP. Зеркало frontend/src/shared/auth/rbac.ts.
  roles?: AppRole[];
  annotations?: ToolAnnotations;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: (ctx: Ctx, args: z.objectOutputType<S, z.ZodTypeAny> & Record<string, any>) => Promise<CallToolResult>;
};
