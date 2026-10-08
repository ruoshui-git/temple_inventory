import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../../lib/api";
import { returnToOpener } from "../../lib/navigation";

export function useLoanDetailController() {
  const route = useRoute(),
    router = useRouter(),
    loan = ref<any>(),
    selected = ref<string[]>([]),
    error = ref("");
  onMounted(async () => {
    try {
      loan.value = await api("loan_detail", { name: route.params.name });
    } catch (e: any) {
      error.value = e.message;
    }
  });
  function begin(kind: string) {
    const items = (loan.value?.items || []).filter(
      (row: any) =>
        selected.value.includes(row.loan_item) && Number(row.outstanding) > 0,
    );
    if (!items.length) return;
    sessionStorage.setItem(
      `ti-seed:${kind}`,
      JSON.stringify({ loan: loan.value.name, items }),
    );
    void router.push(`/new/${kind}`);
  }
  function close() {
    void returnToOpener(router, "/loans");
  }
  function retry() {
    router.go(0);
  }

  return {
    route,
    router,
    loan,
    selected,
    error,
    begin,
    close,
    retry,
  };
}

export type LoanDetailController = ReturnType<typeof useLoanDetailController>;
