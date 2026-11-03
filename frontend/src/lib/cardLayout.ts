import type { DataColumn } from "./dataTable";

export const CARD_FIELD_LIMIT = 8;
export const ROW_FIELD_LIMIT = 6;

/** Column ids that a card or row layout places by role instead of as plain fields. */
export interface CardRoles {
  media?: string;
  title: string;
  eyebrow?: string[];
  hero?: string;
  status?: string;
  omit?: string[];
}

export interface CardPartition {
  media?: DataColumn;
  title?: DataColumn;
  eyebrow: DataColumn[];
  hero?: DataColumn;
  status?: DataColumn;
  fields: DataColumn[];
  /** Every visible non-media column that is not omitted, in order and uncapped. */
  all: DataColumn[];
  overflow: number;
}

/**
 * Splits the ordered visible columns into card slots. Role columns appear only when visible;
 * every other visible column not omitted becomes a field, capped at `limit` with the rest
 * counted in `overflow`.
 */
export function partitionCardColumns(
  visible: DataColumn[],
  roles: CardRoles,
  limit = CARD_FIELD_LIMIT,
): CardPartition {
  const byId = new Map(visible.map((column) => [String(column.id), column]));
  const pick = (id: string | undefined) =>
    id === undefined ? undefined : byId.get(id);
  const eyebrow = (roles.eyebrow ?? [])
    .map((id) => pick(id))
    .filter((column): column is DataColumn => column !== undefined);
  const reserved = new Set<string>([
    ...(roles.media === undefined ? [] : [roles.media]),
    roles.title,
    ...(roles.eyebrow ?? []),
    ...(roles.hero === undefined ? [] : [roles.hero]),
    ...(roles.status === undefined ? [] : [roles.status]),
    ...(roles.omit ?? []),
  ]);
  const rest = visible.filter((column) => !reserved.has(String(column.id)));
  const omitted = new Set(roles.omit ?? []);
  const all = visible.filter(
    (column) => column.id !== roles.media && !omitted.has(String(column.id)),
  );
  const fields = rest.slice(0, Math.max(0, limit));
  return {
    media: pick(roles.media),
    title: pick(roles.title),
    eyebrow,
    hero: pick(roles.hero),
    status: pick(roles.status),
    fields,
    all,
    overflow: rest.length - fields.length,
  };
}
