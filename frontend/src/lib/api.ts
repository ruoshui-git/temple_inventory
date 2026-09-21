import { ref } from 'vue'
import { presentWarehouse } from './warehousePresenter'
export const sessionExpired = ref(false)
export class ApiError extends Error { constructor(message: string, public status: number, public kind = '') { super(message) } }
export async function request(path: string, args: Record<string, unknown> = {}, form?: FormData, signal?: AbortSignal): Promise<any> {
  const r = await fetch(`/api/method/${path}`, { method: 'POST', credentials: 'same-origin', headers: {
    ...(!form ? { 'Content-Type': 'application/json' } : {}), 'X-Frappe-CSRF-Token': (window as any).csrf_token || ''
  }, body: form || JSON.stringify(args), signal })
  let body: any
  try { body = await r.json() } catch { throw new ApiError(r.status ? `请求失败（${r.status}）` : '网络连接失败', r.status, 'NetworkError') }
  if (!r.ok || body.exc) {
    if (r.status === 401 || body.exc_type === 'AuthenticationError' || body.exc_type === 'CSRFTokenError') sessionExpired.value = true
    let message = body.message || '操作失败'
    try { const messages = JSON.parse(body._server_messages || '[]'); message = messages.map((m: any) => typeof m === 'string' ? JSON.parse(m).message : m.message).join('\n') || message } catch { /* use server message */ }
    const clean = String(message).replace(/<[^>]*>/g, '')
    const translated = body.exc_type === 'MandatoryError' || clean.includes('MandatoryError') ? '请填写所有必填字段' : clean.includes('Permission') || /Not permitted|permission denied/i.test(clean) ? '您没有执行此操作的权限' : clean || '操作失败'
    throw new ApiError(translated, r.status, body.exc_type)
  }
  return body.message
}
export const api = (method: string, args: Record<string, unknown> = {}, signal?: AbortSignal) => request(`temple_inventory.inventory_api.${method}`, args, undefined, signal)
export const workspaceApi = (method: string, args: Record<string, unknown> = {}, signal?: AbortSignal) => request(`temple_inventory.workspace_api.${method}`, args, undefined, signal)
export async function refreshSession() {
  const r = await fetch('/api/method/temple_inventory.inventory_api.session_info', { credentials: 'same-origin' })
  if (!r.ok) throw new Error('请先完成登录')
  const { message: d } = await r.json()
  ;(window as any).csrf_token = d.csrf_token
  sessionExpired.value = false
}
export async function upload(file: File, doctype: string, docname: string) {
  const form = new FormData()
  form.append('file', file); form.append('doctype', doctype); form.append('docname', docname); form.append('is_private', '1')
  return request('upload_file', {}, form)
}
export const labels: Record<string, string> = { Receive: '入库', Issue: '出库', Transfer: '转移', Reconcile: '盘点', Loan: '借出', Return: '归还', Damage: '标记损坏', Loss: '记录遗失', Repair: '修复归库', Disposal: '正式报废', '盘点调整': '盘点调整', '期初库存': '期初库存' }
export function warehouseLabel(name: string, tree: any[]): string {
  const node = tree.find(w => w.name === name)
  if (!node) return name || '未选择位置'
  return presentWarehouse(node, tree).breadcrumb
}
export type WarehouseLabelContract = {
  local_label: string
  full_label: string
  search_text: string
  role: 'group' | 'leaf'
  warehouse_type: string
}
/** Structured warehouse display/search contract shared by new picker surfaces. */
export function warehouseLabelContract(name: string, tree: any[]): WarehouseLabelContract {
  const node = tree.find(row => row.name === name)
  const presented = node ? presentWarehouse(node, tree) : undefined
  const full_label = warehouseLabel(name, tree)
  const local_label = presented?.localLabel || String(node?.warehouse_name || node?.name || name || '未选择位置').trim()
  return {
    local_label,
    full_label,
    search_text: `${name} ${node?.warehouse_name || ''} ${local_label} ${full_label}`.toLowerCase(),
    role: presented?.isGroup ? 'group' : 'leaf',
    warehouse_type: String(node?.warehouse_type || node?.semantic_type || ''),
  }
}
export function roomFor(name: string, tree: any[]): string {
  let node = tree.find(w => w.name === name)
  const seen = new Set()
  while (node && !seen.has(node.name)) {
    if (presentWarehouse(node, tree).semanticType === 'room') return node.name
    seen.add(node.name)
    node = tree.find(w => w.name === node.parent_warehouse)
  }
  return name || ''
}
