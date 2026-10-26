export type ToastTone = "success" | "danger" | "warning";
export interface ToastAction {
  label: string;
  action: () => void;
  disabled?: boolean;
}
export interface ToastMessage {
  id: string;
  message: string;
  tone: ToastTone;
  dedupeKey?: string;
  action?: ToastAction;
  persistent?: boolean;
  onDismiss?: () => void;
}

export function toastPlacementClass(phone: boolean) {
	return phone ? "preview-toast--phone" : "preview-toast--desktop";
}

export function showToast(
  message: string,
  tone: ToastTone = "success",
  action?: ToastAction,
  dedupeKey?: string,
  persistent = false,
  onDismiss?: () => void,
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
        persistent,
        onDismiss,
      },
    }),
  );
}
