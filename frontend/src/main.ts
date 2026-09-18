import { createApp } from 'vue'

import App from './App.vue'
import { router } from './router'
import './style.css'
import './loading.css'
import { refreshSession, sessionExpired } from './lib/api'

refreshSession().catch(() => { sessionExpired.value = true }).finally(() => {
  createApp(App).use(router).mount('#app')
})
