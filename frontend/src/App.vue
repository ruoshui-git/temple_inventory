<script setup lang="ts">
import { FrappeUIProvider } from 'frappe-ui'
</script>

<template>
  <!-- Renders the dialog.* and toast.* portals. Mount exactly one. -->
  <FrappeUIProvider>
    <RouterView />
  </FrappeUIProvider>
</template>
