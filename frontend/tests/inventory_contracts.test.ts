import { describe, expect, it } from 'vitest'
import { labels, warehouseLabel, warehouseLabelContract } from '../src/lib/api'

describe('inventory browse contracts', () => {
  const tree = [
    { name: 'root', warehouse_name: '寺院仓库', warehouse_type: 'Physical', is_group: 1, lft: 1, rgt: 8, company: 'Temple' },
    { name: 'room', warehouse_name: 'A02', warehouse_type: 'Room', is_group: 1, parent_warehouse: 'root', lft: 2, rgt: 7, company: 'Temple' },
    { name: 'unspecified', warehouse_name: 'A02 / 未指定', warehouse_type: 'Location', parent_warehouse: 'room', is_group: 0, lft: 3, rgt: 4, company: 'Temple' },
    { name: 'shelf', warehouse_name: '东架', warehouse_type: 'Location', parent_warehouse: 'room', is_group: 0, lft: 5, rgt: 6, company: 'Temple' },
  ]

  it('uses friendly unspecified labels without duplicating the room or company suffix', () => {
    expect(warehouseLabel('unspecified', tree)).toBe('A02 / 房间内，未细分到货架')
    expect(warehouseLabel('shelf', tree)).toBe('A02 / 东架')
    expect(warehouseLabel('root', tree)).toBe('寺院仓库')
  })

  it('keeps reconciliation and movement labels in the shared contract', () => {
    expect(labels.Reconcile).toBe('盘点')
    expect(labels['盘点调整']).toBe('盘点调整')
    expect(labels.Receive).toBe('入库')
  })

  it('exposes structured warehouse labels for display, search, and selection roles', () => {
    expect(warehouseLabelContract('unspecified', tree)).toMatchObject({
      local_label: 'A02 / 未指定', full_label: 'A02 / 房间内，未细分到货架', role: 'leaf', warehouse_type: 'Location',
    })
    expect(warehouseLabelContract('unspecified', tree).search_text).toContain('a02')
    expect(warehouseLabelContract('room', tree).role).toBe('group')
  })
})
