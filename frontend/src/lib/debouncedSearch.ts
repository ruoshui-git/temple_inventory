export function createDebouncedSearch(
  onValue: (value: string) => void,
  delay = 220,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let composing = false;
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  const schedule = (value: string) => {
    cancel();
    timer = setTimeout(() => {
      timer = undefined;
      onValue(value);
    }, delay);
  };
  return {
    input(event: Event) {
      if (!composing) schedule((event.target as HTMLInputElement).value);
    },
    compositionStart() {
      composing = true;
      cancel();
    },
    compositionEnd(event: CompositionEvent) {
      composing = false;
      schedule((event.target as HTMLInputElement).value);
    },
    cancel,
  };
}
