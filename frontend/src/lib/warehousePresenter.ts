export type WarehouseSemanticType = 'room' | 'location' | 'group' | 'unknown'
export type WarehouseFallbackRole = 'room_default' | 'group_default' | null
export type WarehouseRecord = {
  name: string; warehouse_name?: string; stored_label?: string; parent?: string; parent_warehouse?: string
  is_group?: boolean | number; semantic_type?: string | null; warehouse_type?: string | null
  fallback_role?: string | null; local_label?: string | null; breadcrumb?: string | null
  display_depth?: number | null; filter_value?: string | null; operation_value?: string | null
  logical_room?: string | null; default_leaf?: string | null; can_filter?: boolean | null
  can_operate?: boolean | null; permitted?: boolean | null; accessible?: boolean | null; [key: string]: unknown
}
export type PresentedWarehouse = {
  name: string; storedLabel: string; localLabel: string; breadcrumb: string
  semanticType: WarehouseSemanticType; fallbackRole: WarehouseFallbackRole; displayDepth: number
  filterValue: string; operationValue: string | null; logicalRoom: string | null; defaultLeaf: string | null
  canFilter: boolean; canOperate: boolean; parentName: string | null; isGroup: boolean; raw: WarehouseRecord
}
const text = (value: unknown) => String(value ?? '').trim()
const clean = (value: string, row: WarehouseRecord) => { const company = text(row.company); return company ? value.replace(new RegExp(`\\s-\\s${company.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}$`), '').trim() : value }
function typeOf(row: WarehouseRecord): WarehouseSemanticType { const value = text(row.semantic_type || row.warehouse_type).toLowerCase(); if (value === 'room' || value === '房间') return 'room'; if (value === 'location' || value === '库位' || value === '地点' || value === 'shelf') return 'location'; if (value === 'group' || value === '分组' || row.is_group) return 'group'; return 'unknown' }
function fallbackOf(row: WarehouseRecord, parent?: WarehouseRecord): WarehouseFallbackRole { if (row.fallback_role === 'room_default' || row.fallback_role === 'group_default') return row.fallback_role; const label = text(row.local_label || row.stored_label || row.warehouse_name || row.name); if (!label.includes('未指定')) return null; return typeOf(parent || { name: '' }) === 'room' ? 'room_default' : 'group_default' }
function ancestors(row: WarehouseRecord, byName: Map<string, WarehouseRecord>) { const result: WarehouseRecord[] = []; const seen = new Set<string>(); let parent = byName.get(text(row.parent || row.parent_warehouse)); while (parent && !seen.has(parent.name)) { result.unshift(parent); seen.add(parent.name); parent = byName.get(text(parent.parent || parent.parent_warehouse)) } return result }
export function presentWarehouse(row: WarehouseRecord, rows: WarehouseRecord[] = []): PresentedWarehouse {
  const byName = new Map(rows.map(item => [item.name, item])), parentName = text(row.parent || row.parent_warehouse) || null, parent = parentName ? byName.get(parentName) : undefined
  const semanticType = typeOf(row), fallbackRole = fallbackOf(row, parent), storedLabel = clean(text(row.stored_label || row.warehouse_name || row.name), row)
  const localLabel = text(row.local_label) || (fallbackRole === 'room_default' ? '无货位' : fallbackRole === 'group_default' ? '无房间' : storedLabel)
  const chain = [...ancestors(row, byName), row].map(item => {
    const itemParent = byName.get(text(item.parent || item.parent_warehouse))
    const role = fallbackOf(item, itemParent)
    return role === 'room_default' ? '无货位' : role === 'group_default' ? '无房间' : clean(text(item.local_label || item.stored_label || item.warehouse_name || item.name), item)
  }).filter(Boolean)
  const breadcrumb = text(row.breadcrumb) || chain.filter(label => !['实体库房', '寺院仓库'].includes(label)).join(' / ') || localLabel
  const depth = Number.isFinite(Number(row.display_depth)) ? Number(row.display_depth) : Math.max(0, ancestors(row, byName).length - 1)
  const operationValue = text(row.operation_value) || null
  return { name: row.name, storedLabel, localLabel, breadcrumb, semanticType, fallbackRole, displayDepth: depth, filterValue: text(row.filter_value) || row.name, operationValue, logicalRoom: text(row.logical_room) || (semanticType === 'room' ? row.name : null), defaultLeaf: text(row.default_leaf) || null, canFilter: row.can_filter !== false && row.accessible !== false && row.permitted !== false, canOperate: row.can_operate === true && Boolean(operationValue), parentName, isGroup: Boolean(row.is_group), raw: row }
}
export function presentWarehouses(rows: WarehouseRecord[]): PresentedWarehouse[] { return rows.map(row => presentWarehouse(row, rows)).filter(row => row.fallbackRole === null && row.canFilter) }
export function descendantsOf(name: string, rows: PresentedWarehouse[]): PresentedWarehouse[] { const result: PresentedWarehouse[] = []; const visit = (parent: string) => rows.filter(row => row.parentName === parent).forEach(row => { result.push(row); visit(row.name) }); visit(name); return result }
