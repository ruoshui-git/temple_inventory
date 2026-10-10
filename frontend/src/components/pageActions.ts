/** A page-level action shared by desktop action groups and mobile FAB menus. */
export interface PageAction {
  kind: string;
  label: string;
  mobileLabel?: string;
  icon?: string;
  tone?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  loading?: boolean;
}
