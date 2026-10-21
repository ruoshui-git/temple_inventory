import {
  groupSequencesForView,
  groupsForView,
  type ReportDataset,
} from "./reportContract";

function isAllowed(dataset: ReportDataset, view: string, value: string[]) {
  return groupSequencesForView(dataset, view).some(
    (sequence) =>
      sequence.length === value.length &&
      sequence.every((field, index) => field === value[index]),
  );
}

export function groupByFieldOptions(dataset: ReportDataset, view: string) {
  const sequences = groupSequencesForView(dataset, view);
  return groupsForView(dataset, view).filter((field) =>
    sequences.some((sequence) => sequence[0] === field),
  );
}

export function nextGroupByField(
  dataset: ReportDataset,
  view: string,
  current: string[],
  index: number,
  field: string,
) {
  const sequences = groupSequencesForView(dataset, view);
  if (index === 0) {
    if (!field) return [];
    const candidate = current[1] ? [field, current[1]] : [field];
    if (isAllowed(dataset, view, candidate)) return candidate;
    return sequences.find((sequence) => sequence[0] === field) || [];
  }
  const candidate = field ? [current[0], field] : current.slice(0, 1);
  return isAllowed(dataset, view, candidate) ? candidate : [];
}

export function removeGroupByField(
  dataset: ReportDataset,
  view: string,
  current: string[],
  index: number,
) {
  const candidate = current.filter((_, currentIndex) => currentIndex !== index);
  return isAllowed(dataset, view, candidate) ? candidate : [];
}
