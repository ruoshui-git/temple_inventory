<script setup lang="ts">
import { Button, ErrorMessage, useCall } from 'frappe-ui'
import { computed } from 'vue'

interface HelloResponse {
  message: string
  site: string
  user: string
}

/**
 * Calls exactly the same whitelisted method the previous plain-HTML page
 * called with `fetch('/api/method/temple_inventory.api.hello')`, so the old
 * Hello World behaviour is preserved behind the new UI. It is a POST, which
 * also exercises session + CSRF handling end to end.
 *
 * `immediate: false` keeps the page a plain heading + button until it is
 * clicked.
 */
const hello = useCall<HelloResponse>({
  url: '/api/method/temple_inventory.api.hello',
  method: 'POST',
  immediate: false,
})

/**
 * `hello()` is not `allow_guest`, so an anonymous visitor gets a
 * PermissionError. Show the login link instead of the raw server message.
 */
const needsLogin = computed(
  () => (hello.error as { type?: string } | null)?.type === 'PermissionError',
)

async function testBackend() {
  try {
    // `hello()` takes no arguments, so `TParams` stays `undefined` and submit
    // is called without a payload (useCall posts `{}` for POST).
    await hello.submit()
  } catch {
    // `hello.error` is already set by useCall and rendered below; swallowing the
    // rejection here only avoids an unhandled promise rejection in the console.
  }
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-3xl flex-col items-start gap-4 p-6">
    <h1 class="text-2xl font-semibold text-ink-gray-9">Temple Inventory</h1>

    <Button
      theme="blue"
      variant="solid"
      label="Test Backend"
      :loading="hello.loading"
      @click="testBackend"
    />

    <div
      v-if="hello.data"
      class="w-full rounded border border-outline-gray-2 bg-surface-gray-2 p-3 text-sm text-ink-gray-8"
    >
      <p>{{ hello.data.message }}</p>
      <p>site: {{ hello.data.site }}</p>
      <p>user: {{ hello.data.user }}</p>
    </div>

    <div
      v-if="needsLogin"
      class="w-full rounded border border-outline-gray-2 bg-surface-gray-2 p-3 text-sm text-ink-gray-8"
    >
      <span>Log in to call the backend. </span>
      <a class="underline" href="/login?redirect-to=/inventory">Log in</a>
    </div>
    <ErrorMessage v-else-if="hello.error" :message="hello.error.message" />
  </div>
</template>
 * Calls exactly the same whitelisted method the previous plain-HTML page
 * called with `fetch('/api/method/temple_inventory.api.hello')`, so the old
 * Hello World behaviour is preserved behind the new UI. It is a POST, which
 * also exercises session + CSRF handling end to end.
 *
 * `immediate: false` keeps the page a plain heading + button until it is
 * clicked.
 */
const hello = useCall<HelloResponse>({
  url: '/api/method/temple_inventory.api.hello',
  method: 'POST',
  immediate: false,
})

async function testBackend() {
  try {
    // `hello()` takes no arguments, so `TParams` stays `undefined` and submit
    // is called without a payload (useCall posts `{}` for POST).
    await hello.submit()
  } catch {
    // `hello.error` is already set by useCall and rendered below; swallowing the
    // rejection here only avoids an unhandled promise rejection in the console.
  }
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-3xl flex-col items-start gap-4 p-6">
    <h1 class="text-2xl font-semibold text-ink-gray-9">Temple Inventory</h1>

    <Button
      theme="blue"
      variant="solid"
      label="Test Backend"
      :loading="hello.loading"
      @click="testBackend"
    />

    <pre
      v-if="hello.data"
      class="w-full rounded border border-outline-gray-2 bg-surface-gray-2 p-3 text-sm text-ink-gray-8"
    >{{ hello.data.message }}</pre>

    <ErrorMessage v-if="hello.error" :message="hello.error.message" />
  </div>
</template>
