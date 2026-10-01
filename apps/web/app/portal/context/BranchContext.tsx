"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

interface Branch {
  id: string;
  name: string;
  code: string;
  etimsBranchId: string | null;
  walletId: string | null;
  approvalPolicyId: string | null;
  isDefault: boolean;
}

interface BranchContextValue {
  branches: Branch[];
  selectedBranchId: string | null;
  selectedBranch: Branch | null;
  setSelectedBranchId: (id: string | null) => void;
  refreshBranches: () => Promise<void>;
}

const BranchContext = createContext<BranchContextValue | null>(null);

export function BranchProvider({ children }: { children: ReactNode }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);

  const refreshBranches = async () => {
    try {
      const res = await fetch("/api/branches");
      const data = await res.json();
      const list = data?.data ?? [];
      setBranches(list);
      if (!selectedBranchId) {
        const defaultBranch = list.find((b: Branch) => b.isDefault) ?? list[0];
        if (defaultBranch) setSelectedBranchId(defaultBranch.id);
      }
    } catch {
      setBranches([]);
    }
  };

  useEffect(() => {
    refreshBranches();
  }, []);

  const selectedBranch = branches.find((b) => b.id === selectedBranchId) ?? null;

  return (
    <BranchContext.Provider
      value={{ branches, selectedBranchId, selectedBranch, setSelectedBranchId, refreshBranches }}
    >
      {children}
    </BranchContext.Provider>
  );
}

export function useBranch() {
  const ctx = useContext(BranchContext);
  if (!ctx) throw new Error("useBranch must be used within BranchProvider");
  return ctx;
}