// Use Frappe's installed Scanner implementation, not a copy or BarcodeDetector.
const scripts = new Map<string, Promise<void>>()
function load(src: string) {
  if (!scripts.has(src)) scripts.set(src, new Promise<void>((resolve, reject) => {
    const script = document.createElement('script'); script.src = src
    const timer = setTimeout(() => { scripts.delete(src); script.remove(); reject(new Error('扫码组件加载超时，请重试')) }, 15000)
    script.onload = () => { clearTimeout(timer); resolve() }
    script.onerror = () => { clearTimeout(timer); scripts.delete(src); script.remove(); reject(new Error('无法加载扫码组件，请重试')) }
    document.head.append(script)
  }))
  return scripts.get(src)!
}
let loading: Promise<any> | undefined
export function loadScanner(): Promise<any> {
  return loading ||= (async () => {
    const w = window as any
    if (!w.jQuery) await load('/assets/frappe/node_modules/jquery/dist/jquery.min.js')
    if (!w.frappe?.provide) await load('/assets/frappe/js/frappe/provide.js')
    // The scanner's container mode needs only a unique DOM id and an asset loader.
    // Keep this bridge scoped to the SPA; never load the Desk application runtime.
    w.frappe.dom ||= {}
    w.frappe.dom.set_unique_id ||= (element: any) => { if (!element.attr('id')) element.attr('id', `scan-${crypto.randomUUID()}`); return element.attr('id') }
    w.frappe.require ||= async (paths: string | string[]) => { for (const path of [paths].flat()) await load(path) }
    if (!w.frappe.ui.Scanner) await load('/assets/frappe/js/frappe/scanner/index.js')
    await load('/assets/frappe/node_modules/html5-qrcode/html5-qrcode.min.js')
    return w.frappe.ui.Scanner
  })().catch(e => { loading = undefined; throw e })
}
export function cameraError(e: any) {
  const message = String(e?.name || e?.message || e)
  if (/NotAllowed|Permission|denied/i.test(message)) return '相机权限被拒绝，请在浏览器设置中允许使用相机。也可手动输入。'
  if (/NotFound|DevicesNotFound/i.test(message)) return '未找到相机，请使用手动输入或扫码枪。'
  if (/NotReadable|TrackStart/i.test(message)) return '相机正在被其他程序使用，请关闭后重试。'
  return `无法启动相机：${message}`
}
