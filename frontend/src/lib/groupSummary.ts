function compactGroupSummaryParts(summary: string, visibleValues = 2) {
  const values = summary.split(" · ").filter(Boolean);
  return [
    ...values.slice(0, visibleValues),
    ...(values.length > visibleValues
      ? [`+${values.length - visibleValues} 项`]
      : []),
  ];
}

// Lines may break only between entries, never between a value and its unit.
export function compactGroupSummary(summary: string, visibleValues = 2) {
  return compactGroupSummaryParts(summary, visibleValues)
    .map((part) => part.replace(/ /g, "\u00a0"))
    .join(" · ");
}
