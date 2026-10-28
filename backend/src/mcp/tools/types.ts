import type { ZodRawShape, z } from "zod";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { Ctx } from "../context.js";

// Один инструмент MCP. write=true — меняет данные: пишется в журнал
// mcp_audit с аргументами и помечается для клиента как не read-only.
export type ToolDef<S extends ZodRawShape = ZodRawShape> = {
  name: string;
  title: string;
  description: string;
  input: S;
  write?: boolean;
  annotations?: ToolAnnotations;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: (ctx: Ctx, args: z.objectOutputType<S, z.ZodTypeAny> & Record<string, any>) => Promise<CallToolResult>;
};
