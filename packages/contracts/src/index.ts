export const tenantRoles = ["OWNER", "ADMIN", "STAFF"] as const;
export type TenantRole = (typeof tenantRoles)[number];

export const branchRoles = ["MANAGER", "WAITER", "KITCHEN", "CASHIER", "STAFF"] as const;
export type BranchRole = (typeof branchRoles)[number];

export type BranchContext = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  role: BranchRole | null;
  stationId: string | null;
};
