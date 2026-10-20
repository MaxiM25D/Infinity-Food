"use client";

import { Building2, Check, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import type { BranchContext } from "@infinityfood/contracts";
import { ApiError, apiRequest } from "@/lib/api";

type Branch = BranchContext & { status: "ACTIVE" | "INACTIVE" };

export function BranchSwitcher({ current, onSelected }: { current: BranchContext; onSelected: (branch: BranchContext) => void }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void apiRequest<{ branches: Branch[] }>("/admin/branches")
      .then(({ branches: values }) => { if (active) setBranches(values); })
      .catch((caught) => { if (active) setError(caught instanceof ApiError ? caught.message : "No se pudieron cargar las sucursales"); });
    return () => { active = false; };
  }, [current.id]);

  async function select(branchId: string) {
    if (branchId === current.id) return;
    setBusy(true); setError("");
    try {
      const response = await apiRequest<{ branch: BranchContext }>("/auth/select-branch", { method: "POST", body: JSON.stringify({ branchId }) });
      onSelected(response.branch);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "No se pudo cambiar de sucursal");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-6 rounded-xl border border-white/10 bg-white/[0.035] p-3">
      <label className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.18em] text-white/35">
        <Building2 size={13} /> Sucursal operativa
      </label>
      <div className="relative mt-2">
        <select aria-label="Sucursal operativa" className="w-full appearance-none rounded-lg border border-white/10 bg-[#211b23] px-3 py-2 pr-8 text-xs font-semibold text-white outline-none" disabled={busy} onChange={(event) => void select(event.target.value)} value={current.id}>
          {branches.filter(({ status }) => status === "ACTIVE").map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select>
        <span className="pointer-events-none absolute right-2.5 top-2.5 text-white/50">{busy ? <LoaderCircle className="animate-spin" size={13} /> : <Check size={13} />}</span>
      </div>
      <p className="mt-2 truncate text-[10px] text-white/30">/{current.slug}{current.role ? ` · ${current.role}` : " · acceso global"}</p>
      {error && <p className="mt-2 text-[10px] text-red-300">{error}</p>}
    </div>
  );
}
