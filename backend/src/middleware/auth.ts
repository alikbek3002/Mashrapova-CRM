import type { FastifyRequest, FastifyReply } from "fastify";
import { supabaseAdmin } from "../lib/supabase.js";

export type AppRole =
  | "director"
  | "fitness_director"
  | "senior_manager"
  | "manager"
  | "cashier"
  | "coach"
  | "parent";

export type AuthUser = {
  id: string;
  email: string | null;
  role: AppRole;
  organization_id: string;
};

// Convenience role groups matching ТЗ permission tiers.
export const OFFICE_ROLES: AppRole[] = [
  "director", "fitness_director", "senior_manager", "manager", "cashier",
];
export const SCHEDULE_ROLES: AppRole[] = [
  "director", "fitness_director", "senior_manager",
];
export const SALES_ROLES: AppRole[] = [
  "director", "fitness_director", "senior_manager", "manager",
];
export const PAYMENT_ROLES: AppRole[] = [
  "director", "fitness_director", "senior_manager", "manager", "cashier",
];
export const COACH_MGMT_ROLES: AppRole[] = ["director", "fitness_director"];

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export const authenticate = async (req: FastifyRequest, reply: FastifyReply) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "missing_token" });
  }
  const token = header.slice(7);
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData.user) {
    return reply.code(401).send({ error: "invalid_token" });
  }
  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id, email, role, organization_id, is_active, deleted_at")
    .eq("id", userData.user.id)
    .single();
  if (profileError || !profile || !profile.is_active || profile.deleted_at) {
    return reply.code(403).send({ error: "profile_inactive" });
  }
  req.user = {
    id: profile.id,
    email: profile.email,
    role: profile.role,
    organization_id: profile.organization_id,
  };
};

export const requireRole =
  (...allowed: AuthUser["role"][]) =>
  async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ error: "not_authenticated" });
    if (!allowed.includes(req.user.role)) {
      return reply.code(403).send({ error: "forbidden" });
    }
  };
