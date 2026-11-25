import { config } from "@vue/test-utils";
import { vTip } from "../src/directives/tip";

config.global.directives.tip = vTip;
