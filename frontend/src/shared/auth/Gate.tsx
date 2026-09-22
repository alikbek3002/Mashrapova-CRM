import type { ReactNode } from "react";
import { usePerm, type Permission } from "./rbac";

export const Gate = ({ perm, fallback = null, children }: {
  perm: Permission;
  fallback?: ReactNode;
  children: ReactNode;
}) => {
  return usePerm(perm) ? <>{children}</> : <>{fallback}</>;
};
