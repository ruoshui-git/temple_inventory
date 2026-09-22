import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ItemImagePreview from '../src/components/ItemImagePreview.vue'
import SignaturePad from '../src/components/SignaturePad.vue'

describe('ItemImagePreview', () => {
  it('toggles a clicked preview and dismisses it outside or with Escape without a close glyph', async () => {
    const wrapper = mount(ItemImagePreview, { props: { src: '/photo.jpg', alt: '物品' } })
    const button = wrapper.get('button.image-thumb-button')
    await button.trigger('click')
    expect(button.attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('.image-preview-close').exists()).toBe(false)
    await wrapper.get('.image-preview-backdrop').trigger('click.self')
    expect(button.attributes('aria-expanded')).toBe('false')
    await button.trigger('click')
    await wrapper.get('.image-preview').trigger('keydown', { key: 'Escape' })
    expect(button.attributes('aria-expanded')).toBe('false')
  })

  it('dismisses an unpinned hover preview after leaving the thumbnail and preview', async () => {
    vi.useFakeTimers()
    const wrapper = mount(ItemImagePreview, { props: { src: '/photo.jpg', alt: '物品' } })
    const button = wrapper.get('button.image-thumb-button')
    await button.trigger('mouseenter')
    await vi.advanceTimersByTimeAsync(280)
    expect(button.attributes('aria-expanded')).toBe('true')
    await button.trigger('mouseleave')
    await vi.advanceTimersByTimeAsync(160)
    expect(button.attributes('aria-expanded')).toBe('false')
    vi.useRealTimers()
  })
})

describe('SignaturePad', () => {
  it('uses a required validity control only for required signatures', () => {
    const required = mount(SignaturePad, { props: { modelValue: '', required: true } })
    const optional = mount(SignaturePad, { props: { modelValue: '', required: false } })
    expect(required.get('input[type="text"]').attributes('required')).toBeDefined()
    expect(optional.get('input[type="text"]').attributes('required')).toBeUndefined()
    expect(optional.text()).not.toContain('*')
  })
})
