import { onBeforeUnmount, ref, watch } from "vue";

export interface LogoutHost {
  logout(): Promise<void>;
  afterLogout(): void;
}

export function useLogoutController(
  host: LogoutHost,
  currentAccount: () => string,
) {
  const account = currentAccount();
  const open = ref(false);
  const busy = ref(false);
  const error = ref("");
  let disposed = false;
  const active = () => !disposed && currentAccount() === account;

  function show() {
    if (!active()) return;
    error.value = "";
    open.value = true;
  }
  function close() {
    if (busy.value) return;
    open.value = false;
    error.value = "";
  }
  async function logout() {
    if (busy.value || !active()) return;
    busy.value = true;
    error.value = "";
    try {
      await host.logout();
      if (active()) host.afterLogout();
    } catch (reason) {
      if (active())
        error.value =
          reason instanceof Error ? reason.message : "退出失败，请重试";
    } finally {
      if (active()) busy.value = false;
    }
  }
  watch(currentAccount, () => {
    open.value = false;
    error.value = "";
  });
  onBeforeUnmount(() => {
    disposed = true;
  });
  return { open, busy, error, show, close, logout };
}
