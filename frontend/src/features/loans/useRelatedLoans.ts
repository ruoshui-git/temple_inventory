import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import {
  useInventoryServices,
  useReferenceData,
} from "../../services/contracts";
import { loadLoanDocument, type LoanDocument } from "./useLoanDetail";
export function useRelatedLoans() {
  const services = useInventoryServices(),
    reference = useReferenceData(),
    account = reference.user;
  const open = ref(false),
    names = ref<string[]>([]),
    selected = ref("");
  const records = reactive<
    Record<string, { loading: boolean; loan?: LoanDocument; error: string }>
  >({});
  let generation = 0,
    request: AbortController | undefined;
  const current = computed(() => records[selected.value]);
  async function load(name: string, token = generation) {
    records[name] = { loading: true, error: "" };
    try {
      const loan = await loadLoanDocument(services, name, request?.signal);
      if (token === generation && reference.user === account)
        records[name] = { loading: false, loan, error: "" };
    } catch {
      if (token === generation && reference.user === account)
        records[name] = { loading: false, error: "借出记录暂不可用或无权访问" };
    }
  }
  function close() {
    open.value = false;
    generation++;
    request?.abort();
  }
  function show(values: string[]) {
    close();
    for (const key of Object.keys(records)) delete records[key];
    names.value = [...new Set(values)];
    selected.value = names.value.length === 1 ? names.value[0]! : "";
    request = new AbortController();
    open.value = true;
    for (const name of names.value) void load(name);
  }
  watch(
    () => reference.user,
    () => {
      close();
      for (const key of Object.keys(records)) delete records[key];
    },
  );
  onBeforeUnmount(close);
  return { open, names, selected, records, current, show, close, retry: load };
}
