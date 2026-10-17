export type InstallPlatform = "ios" | "android" | "other";

export function detectInstallPlatform(
  userAgent: string,
  platform: string,
  maxTouchPoints: number,
): InstallPlatform {
  if (
    /iPad|iPhone|iPod/.test(userAgent) ||
    (platform === "MacIntel" && maxTouchPoints > 1)
  )
    return "ios";
  if (/Android/i.test(userAgent)) return "android";
  return "other";
}

export function installInstructions(platform: InstallPlatform) {
  if (platform === "ios")
    return "请在 Safari 中点击分享按钮，再选择「添加到主屏幕」，然后点击「添加」。";
  if (platform === "android")
    return "请在 Chrome 中打开右上角菜单，选择「安装应用」或「添加到主屏幕」。";
  return "请打开浏览器菜单，寻找「安装应用」或「添加到主屏幕」。";
}
