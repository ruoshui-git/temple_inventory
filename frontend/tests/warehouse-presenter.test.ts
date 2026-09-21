import { describe, expect, it } from 'vitest'
import { presentWarehouse, presentWarehouses } from '../src/lib/warehousePresenter'

const rows = [
  { name: 'root', warehouse_name: '第2寺院', is_group: 1, semantic_type: 'group' },
  { name: 'room', warehouse_name: 'A02', parent: 'root', is_group: 1, semantic_type: 'room', filter_value: 'room', operation_value: 'fallback', logical_room: 'room', default_leaf: 'fallback', can_operate: true },
  { name: 'fallback', warehouse_name: '未指定', parent: 'room', is_group: 0, fallback_role: 'room_default' },
  { name: 'loc', warehouse_name: 'A02', parent: 'room', is_group: 0, semantic_type: 'location', filter_value: 'loc', operation_value: 'loc', can_operate: true },
  { name: 'group-fallback', warehouse_name: '未指定', parent: 'root', is_group: 0, fallback_role: 'group_default' },
]

describe('warehouse presenter', () => {
  it('uses local labels while retaining breadcrumbs and structured values', () => {
    const row = presentWarehouse(rows[1], rows)
    expect(row.localLabel).toBe('A02')
    expect(row.breadcrumb).toBe('第2寺院 / A02')
    expect(row.filterValue).toBe('room')
    expect(row.operationValue).toBe('fallback')
  })

  it('collapses both structured fallback roles from logical browse', () => {
    const visible = presentWarehouses(rows)
    expect(visible.map(row => row.name)).toEqual(['root', 'room', 'loc'])
    expect(presentWarehouse(rows[2], rows).localLabel).toBe('无货位')
    expect(presentWarehouse(rows[4], rows).localLabel).toBe('无房间')
    expect(presentWarehouse(rows[1], rows).operationValue).toBe('fallback')
  })

  it('does not let missing or inaccessible operation leaves become actions', () => {
    const row = presentWarehouse({ ...rows[1], operation_value: null, can_operate: false }, rows)
    expect(row.filterValue).toBe('room')
    expect(row.operationValue).toBeNull()
    expect(row.canOperate).toBe(false)
  })
})
