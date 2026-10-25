import { createApp } from "vue";

import "./styles/app.css";
import App from "./App.vue";
import { router } from "./router";
import { applyEnvironmentDocument } from "./lib/environment";
applyEnvironmentDocument();
createApp(App).use(router).mount("#app");
