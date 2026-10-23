import type { Router } from "vue-router";

export function registerRouteProgress(
  router: Router,
  setVisible: (visible: boolean) => void,
) {
  let start: ReturnType<typeof setTimeout> | undefined;
  let finish: ReturnType<typeof setTimeout> | undefined;
  let visible = false;
  const removeBefore = router.beforeEach(() => {
    clearTimeout(start);
    clearTimeout(finish);
    visible = false;
    setVisible(false);
    start = setTimeout(() => {
      visible = true;
      setVisible(true);
    }, 150);
  });
  const end = () => {
    clearTimeout(start);
    if (!visible) return;
    finish = setTimeout(() => {
      visible = false;
      setVisible(false);
    }, 180);
  };
  const removeAfter = router.afterEach(end);
  const removeError = router.onError(end);
  return () => {
    clearTimeout(start);
    clearTimeout(finish);
    removeBefore();
    removeAfter();
    removeError();
  };
}
