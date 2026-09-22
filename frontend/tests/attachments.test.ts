import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AttachmentList from '../src/components/AttachmentList.vue'

describe('AttachmentList', () => {
  it('uses the shared upload contract without forcing camera capture', async () => {
    const wrapper = mount(AttachmentList, { props: { editable: true } })
    const input = wrapper.find('input[type="file"]')
    expect(input.attributes('capture')).toBeUndefined()
    expect(input.attributes('multiple')).toBeDefined()
    expect(input.attributes('accept')).toContain('image/*')
    const file = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    expect(wrapper.emitted('upload')?.[0]).toEqual([[file]])
  })

  it('renders file type/size and emits removal without deciding authorization', async () => {
    const file = { name: 'f1', file_name: 'receipt.pdf', file_type: 'application/pdf', file_size: 42, file_url: '/private/receipt.pdf' }
    const wrapper = mount(AttachmentList, { props: { attachments: [file], editable: true } })
    expect(wrapper.text()).toContain('application/pdf')
    expect(wrapper.text()).toContain('42 bytes')
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('remove')?.[0]).toEqual([file])
  })

  it('offers primary-image selection for editable image attachments', async () => {
    const file = { name: 'f2', file_name: 'photo.jpg', file_type: 'image/jpeg', file_url: '/private/photo.jpg' }
    const wrapper = mount(AttachmentList, { props: { attachments: [file], editable: true, allowPrimaryImage: true } })
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('set-primary')?.[0]).toEqual([file])
  })

  it('does not offer primary-image selection without Item capability', () => {
    const file = { name: 'f3', file_name: 'photo.jpg', file_type: 'image/jpeg', file_url: '/private/photo.jpg' }
    const wrapper = mount(AttachmentList, { props: { attachments: [file], editable: true } })
    expect(wrapper.text()).not.toContain('设为主图')
  })
})
