import { request, refreshSession } from "../lib/api";
import { sessionExpired } from "../lib/sessionState";
import { detectInstallPlatform, installPwa, isStandalone } from "../lib/pwa";
import type { MoreHost } from "../features/more/useMoreController";
export function frappePlatform(account: () => string): MoreHost {
  return {
    platform: () =>
      detectInstallPlatform(
        navigator.userAgent,
        navigator.platform,
        navigator.maxTouchPoints,
      ),
    standalone: () => isStandalone.value,
    install: installPwa,
    async logout() {
      const expected = account(),
        session = await refreshSession();
      if (!session || session.user !== expected) {
        sessionExpired.value = true;
        throw new Error("登录账户已变化，请先验证当前账户后再退出");
      }
      await request("logout");
    },
    afterLogout: () =>
      window.location.assign("/login?redirect-to=%2Finventory"),
  };
}
