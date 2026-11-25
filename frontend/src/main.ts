import { createApp } from "vue";

import "./styles/app.css";
import App from "./App.vue";
import { router } from "./router";
import { applyEnvironmentDocument } from "./lib/environment";
import { vTip } from "./directives/tip";
import { dismissTooltip } from "./lib/tooltip";
applyEnvironmentDocument();
router.afterEach(() => dismissTooltip());
createApp(App).directive("tip", vTip).use(router).mount("#app");
