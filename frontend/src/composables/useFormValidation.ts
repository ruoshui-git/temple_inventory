import { reactive, readonly, watch } from "vue";

type ValidationRule<T = unknown> = (
  value: T,
) => string | undefined | null | true;
type Field = {
  value: () => unknown;
  rules: ValidationRule<any>[];
  focus?: () => void;
};
export function useFormValidation() {
  const errors = reactive<Record<string, string>>({});
  const fields = new Map<string, Field>();
  function register(
    name: string,
    value: () => unknown,
    rules: ValidationRule<any>[],
    focus?: () => void,
  ) {
    fields.set(name, { value, rules, focus });
    const stop = watch(value, () => {
      delete errors[name];
    });
    return {
      validate: () => validateField(name),
      clear: () => {
        delete errors[name];
      },
      unregister: () => {
        stop();
        fields.delete(name);
        delete errors[name];
      },
    };
  }
  function validateField(name: string) {
    const field = fields.get(name);
    if (!field) return true;
    for (const rule of field.rules) {
      const result = rule(field.value());
      if (typeof result === "string" && result) {
        errors[name] = result;
        return false;
      }
    }
    delete errors[name];
    return true;
  }
  function validate() {
    let firstInvalid: string | undefined;
    for (const name of fields.keys())
      if (!validateField(name) && !firstInvalid) firstInvalid = name;
    if (firstInvalid) {
      const field = fields.get(firstInvalid);
      if (field?.focus) field.focus();
      else if (typeof document !== "undefined") {
        const control =
          document.getElementById(firstInvalid) ||
          Array.from(document.querySelectorAll<HTMLElement>("[name]")).find(
            (element) => element.getAttribute("name") === firstInvalid,
          );
        control?.focus({ preventScroll: true });
      }
    }
    return { ok: !firstInvalid, firstInvalid, errors: { ...errors } };
  }
  return {
    errors: readonly(errors),
    register,
    validate,
    validateField,
    clear: (name: string) => delete errors[name],
    summary: () =>
      Object.entries(errors).map(([field, message]) => ({ field, message })),
  };
}
