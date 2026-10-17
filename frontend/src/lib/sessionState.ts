import { ref } from "vue";
/** Transport-independent state lets shared editors stop cameras on session expiry. */
export const sessionExpired = ref(false);
