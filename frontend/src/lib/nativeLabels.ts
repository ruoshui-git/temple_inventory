/** Native lifecycle values are unchanged; only their human-readable presentation lives here. */
export function nativeStatusLabel(value: unknown): string {
  return (
    ({ 0: "草稿", 1: "已提交", 2: "已取消" } as Record<string, string>)[
      String(value)
    ] || "状态未知"
  );
}
