import { createApp } from "vue";

import "frappe-ui/style.css";
import "./styles/tokens.css";
import "./style.css";
import "./styles/primitives.css";
import "./loading.css";
import App from "./App.vue";
import { router } from "./router";
import { refreshSession, sessionExpired } from "./lib/api";

refreshSession()
  .catch(() => {
    sessionExpired.value = true;
  })
  .finally(() => {
    createApp(App).use(router).mount("#app");
  });
