import type { BranchContext, TenantRole } from "@infinityfood/contracts";

export type AuthContext = {
  sessionId: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    platformRole: "USER" | "SUPERADMIN";
    emailVerified: boolean;
  };
  tenant: {
    id: string;
    slug: string;
    name: string;
  };
  branch: BranchContext;
  role: TenantRole;
  supportAccess: {
    originTenantId: string;
    startedAt: string;
  } | null;
};

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      requestId?: string;
    }
  }
}
