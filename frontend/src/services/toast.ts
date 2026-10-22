export type ToastTone = "success" | "danger" | "warning";
export interface ToastAction {
  label: string;
  action: () => void;
}
export interface ToastMessage {
  id: string;
  message: string;
  tone: ToastTone;
  dedupeKey?: string;
  action?: ToastAction;
}

export function showToast(
  message: string,
  tone: ToastTone = "success",
  action?: ToastAction,
  dedupeKey?: string,
) {
  if (!message || typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ToastMessage>("temple-inventory-toast", {
      detail: {
        id: crypto.randomUUID(),
        message,
        tone,
        action,
        dedupeKey,
      },
    }),
  );
}
