import { reactive } from "vue";
import {
  activities,
  activityTypes,
  type PreviewActivity,
} from "./activityData";
import {
  reviewSession,
  reviewMovementRows,
  type ReviewSession,
} from "./reviewModel";

const activityPermissions = reactive({
  write: true,
  delete: true,
  hiddenReferences: [] as string[],
});
type ActivityInput = Pick<
  PreviewActivity,
  "title" | "typeId" | "start" | "end" | "description" | "notes"
>;
function validateActivity(input: ActivityInput, current?: PreviewActivity) {
  if (!input.title.trim()) return "请填写活动名称";
  if (
    activities.some(
      (row) =>
        row.id !== current?.id &&
        row.title.trim().toLocaleLowerCase() ===
          input.title.trim().toLocaleLowerCase(),
    )
  )
    return "活动名称已存在";
  const type = activityTypes.find((row) => row.id === input.typeId);
  if (!type || (!type.enabled && current?.typeId !== type.id))
    return "请选择启用的活动类型";
  if (input.start && input.end && input.end < input.start)
    return "结束日期不能早于开始日期";
  return "";
}
export function saveActivity(
  input: ActivityInput,
  id?: string,
  version?: number,
) {
  if (!activityPermissions.write) return { error: "没有编辑权限，输入已保留" };
  const current = activities.find((row) => row.id === id);
  if (id && (!current || current.version !== version))
    return { error: "活动已更改，请重新打开编辑；输入已保留" };
  const error = validateActivity(input, current);
  if (error) return { error };
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  if (current) {
    Object.assign(current, input, {
      title: input.title.trim(),
      modified: now,
      modifiedBy: "预览管理员",
      version: current.version + 1,
    });
    return { activity: current };
  }
  let number = activities.length + 1;
  while (
    activities.some(
      (row) => row.id === `ACT-${String(number).padStart(4, "0")}`,
    )
  )
    number++;
  const activity: PreviewActivity = {
    ...input,
    title: input.title.trim(),
    id: `ACT-${String(number).padStart(4, "0")}`,
    status: "active",
    created: now,
    modified: now,
    owner: "预览管理员",
    modifiedBy: "预览管理员",
    version: 1,
  };
  activities.push(activity);
  return { activity };
}
export function relatedActivityRecords(
  id: string,
  session: ReviewSession = reviewSession,
) {
  const loans = new Set(
    session.loans
      .filter((loan) => loan.activity === id)
      .map((loan) => loan.name),
  );
  for (const row of session.movements)
    if (row.kind === "Loan" && row.activity === id) loans.add(row.name);
  for (const row of session.drafts)
    if (row.kind === "Loan" && row.activity === id) loans.add(row.name);
  const seen = new Set<string>();
  return reviewMovementRows(session)
    .filter((row) => row.activity === id || loans.has(row.loanName || ""))
    .map((row) => ({
      ...row,
      relationship: row.activity === id ? "直接关联" : "经原借用关联",
    }))
    .filter((row) => {
      const key = `${row.documentType || "Stock Entry"}/${row.name}/${row.lineId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
export function activityMovementCounts(
  id: string,
  session: ReviewSession = reviewSession,
) {
  const counts = new Map<string, Set<string>>();
  for (const row of relatedActivityRecords(id, session)) {
    if (row.activity !== id || row.docstatus !== 1) continue;
    const ids = counts.get(row.kind) || new Set<string>();
    ids.add(`${row.documentType || "Stock Entry"}/${row.name}`);
    counts.set(row.kind, ids);
  }
  return [...counts].map(([kind, ids]) => ({ kind, count: ids.size }));
}
export function activityLoanLines(
  id: string,
  session: ReviewSession = reviewSession,
) {
  return session.loans
    .filter((loan) => loan.activity === id && loan.status !== "draft")
    .flatMap((loan) =>
      loan.lines.map((line, index) => ({
        ...line,
        loanName: loan.name,
        lineId: `${loan.name}/${index}`,
        uom:
          session.stock.find((item) => item.code === line.code)?.uom || "Nos",
        outstanding: line.qty - line.returned - line.damaged - line.lost,
      })),
    );
}
function activityDeleteError(
  id: string,
  session: ReviewSession = reviewSession,
) {
  if (!activityPermissions.delete) return "没有删除权限";
  if (activityPermissions.hiddenReferences.includes(id))
    return "此活动仍有关联记录，不能删除。可改为归档。";
  if (
    relatedActivityRecords(id, session).length ||
    session.drafts.some((row) => row.activity === id) ||
    session.loans.some((row) => row.activity === id)
  )
    return "有关联记录（含草稿或取消记录），不能删除。可改为归档。";
  return "";
}
export function deleteActivity(id: string) {
  const error = activityDeleteError(id);
  if (error) return error;
  const index = activities.findIndex((row) => row.id === id);
  if (index >= 0) activities.splice(index, 1);
  return "";
}
export function setActivityArchived(id: string, archived: boolean) {
  if (!activityPermissions.write) return "没有编辑权限";
  const activity = activities.find((row) => row.id === id);
  if (activity) {
    activity.status = archived ? "archived" : "active";
    activity.version++;
    activity.modified = new Date().toISOString().replace("T", " ").slice(0, 19);
    activity.modifiedBy = "预览管理员";
  }
  return "";
}
function retireActivityType(id: string) {
  const type = activityTypes.find((row) => row.id === id);
  if (type) type.enabled = false;
}
function deleteActivityType(id: string) {
  if (activities.some((row) => row.typeId === id))
    return "活动类型已被引用，不能删除";
  const index = activityTypes.findIndex((row) => row.id === id);
  if (index >= 0) activityTypes.splice(index, 1);
  return "";
}
