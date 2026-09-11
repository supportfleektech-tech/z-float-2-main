"use client";
import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { playNotificationSound } from "@/lib/sounds";

export type ToastType = "success" | "error" | "warning" | "info" | "default";

export interface Toast {
  id: string;
  title: string;
  message?: string;
  type: ToastType;
  duration?: number;
}

interface ToastProps {
  toast: Toast;
  onClose: (id: string) => void;
}

const typeStyles: Record<ToastType, { bg: string; border: string; icon: string; text: string }> = {
  success: { bg: "bg-emerald-50", border: "border-emerald-200", icon: "✓", text: "text-emerald-800" },
  error: { bg: "bg-red-50", border: "border-red-200", icon: "✕", text: "text-red-800" },
  warning: { bg: "bg-amber-50", border: "border-amber-200", icon: "⚠", text: "text-amber-800" },
  info: { bg: "bg-blue-50", border: "border-blue-200", icon: "ℹ", text: "text-blue-800" },
  default: { bg: "bg-slate-50", border: "border-slate-200", icon: "•", text: "text-slate-800" },
};

export function ToastComponent({ toast, onClose }: ToastProps) {
  const [visible, setVisible] = useState(true);
  const style = typeStyles[toast.type];

  useEffect(() => {
    if (toast.duration !== 0) {
      const timer = setTimeout(() => {
        setVisible(false);
        setTimeout(() => onClose(toast.id), 300);
      }, toast.duration ?? 3000);
      return () => clearTimeout(timer);
    }
  }, [toast, onClose]);

  if (!visible) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      className={`flex items-start gap-3 rounded-lg border p-4 min-w-[300px] max-w-sm shadow-lg ${style.bg} ${style.border} ${style.text}`}
      role="alert"
      aria-live="polite"
    >
      <span className="flex-shrink-0 text-lg font-bold" aria-hidden="true">
        {style.icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-medium">{toast.title}</p>
        {toast.message && <p className="mt-1 text-sm opacity-80">{toast.message}</p>}
      </div>
      <button
        onClick={() => { setVisible(false); setTimeout(() => onClose(toast.id), 300); }}
        className="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </motion.div>
  );
}

interface ToastContainerProps {
  toasts: Toast[];
  onClose: (id: string) => void;
}

export function ToastContainer({ toasts, onClose }: ToastContainerProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    toasts.forEach((t) => {
      if (t.duration !== 0) {
        playNotificationSound(t.type);
      }
    });
  }, [toasts]);

  if (!mounted) return null;

  return (
    <AnimatePresence>
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <div key={toast.id} className="pointer-events-auto">
            <ToastComponent toast={toast} onClose={onClose} />
          </div>
        ))}
      </div>
    </AnimatePresence>
  );
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id">) => string;
  removeToast: (id: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = (toast: Omit<Toast, "id">) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const newToast = { ...toast, id };
    setToasts((prev) => [...prev, newToast]);
    return id;
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = React.useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within a ToastProvider");
  return context;
}