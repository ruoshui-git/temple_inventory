<script setup lang="ts">
type Attachment = {
  name: string
  file_name?: string
  file_url?: string
  file_type?: string
  file_size?: number
}

const props = withDefaults(defineProps<{
  attachments?: Attachment[]
  editable?: boolean
  allowPrimaryImage?: boolean
  accept?: string
  title?: string
  showTitle?: boolean
  primaryUrl?: string
}>(), { attachments: () => [], editable: false, allowPrimaryImage: false, accept: 'image/*,.pdf,.doc,.docx,.xls,.xlsx', title: '附件', showTitle: true, primaryUrl: '' })
const emit = defineEmits<{ upload: [files: File[]]; remove: [file: Attachment]; 'set-primary': [file: Attachment] }>()
function choose(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  if (files.length) emit('upload', files)
  input.value = ''
}
function isImage(file: Attachment) {
  return String(file.file_type || '').startsWith('image/') || /\.(png|jpe?g|webp|gif|heic)$/i.test(file.file_name || '')
}
</script>

<template>
  <section class="attachments" :aria-label="title">
    <h2 v-if="showTitle">{{ title }}<template v-if="attachments.length"> · {{ attachments.length }}</template></h2>
    <label v-if="editable" class="file-button">上传文件或拍照
      <input type="file" :accept="accept" multiple capture="environment" @change="choose">
    </label>
    <div class="attachment-grid">
      <article v-for="file in attachments" :key="file.name">
        <a :href="file.file_url" target="_blank" rel="noopener">
          <img v-if="isImage(file) && file.file_url" :src="file.file_url" :alt="file.file_name || '附件'" class="thumb">
          <span>{{ file.file_name || file.name }}</span>
          <small>{{ file.file_type || '文件' }}<template v-if="file.file_size"> · {{ file.file_size }} bytes</template></small>
        </a>
        <button v-if="editable && allowPrimaryImage && isImage(file)" type="button" @click="emit('set-primary', file)">{{ file.file_url === primaryUrl ? '当前主图' : '设为主图' }}</button>
        <button v-if="editable" type="button" @click="emit('remove', file)">移除</button>
      </article>
    </div>
  </section>
</template>
