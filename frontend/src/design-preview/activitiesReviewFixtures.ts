import { activities } from "./activityData";
import { reviewSession } from "./reviewModel";
import { movementLabels } from "./browseModel";
/** Opt-in stress fixture. Opening ordinary routes never installs it. */
export function installActivitiesReviewFixtures() {
  if (activities.some((row) => row.id === "ACT-AUDIT")) return;
  const base = activities[0]!;
  const longPath =
    "斋堂 / 东侧物资储备区与义工交接区域 / 最里面的米粮货架第一层";
  reviewSession.warehouses.push({
    name: longPath,
    label: longPath,
    parent: "斋堂",
    is_group: false,
    warehouse_type: "Location",
    status: "active",
  });
  for (let index = 0; index < 48; index++)
    activities.push({
      ...base,
      id: index === 0 ? "ACT-AUDIT" : `ACT-AUDIT-${index}`,
      title: `大型活动 ${index + 1} · 社区秋季物资分发与义工节目筹备及长期投入使用登记${index === 0 ? " · 超长名称用来检查换行与阅读" : ""}`,
      typeId: `AT-${(index % 6) + 1}`,
      notes:
        "第一段详细安排，保留换行。\n请核对各个位置，勿重复计算转移。\n\n<b>这仍是纯文本备注</b>\n".repeat(
          18,
        ),
      description: "供大结果集、长标题、混合单位与多种流动标签评审。",
    });
  Object.keys(movementLabels).forEach((kind, index) => {
    const item = reviewSession.stock[index % reviewSession.stock.length]!;
    reviewSession.movements.push({
      lineId: `AUDIT-LINE-${index}`,
      documentType:
        kind === "Reconcile" ? "Stock Reconciliation" : "Stock Entry",
      name: `AUDIT-${kind}`,
      kind,
      docstatus: 1,
      date: "2026-10-11",
      code: item.code,
      itemName: item.name,
      qty: 10 + index,
      uom: item.uom,
      from: longPath,
      to: "斋堂 / A-01",
      activity: "ACT-AUDIT",
      batch: index % 2 ? "AUDIT-BATCH" : "",
      entryQty: 1,
      entryUom: "箱",
      conversionFactor: 10 + index,
    });
  });
  reviewSession.loans.push({
    name: "AUDIT-LOAN",
    borrower: "社区义工联合节目筹备与物资接收工作组",
    activity: "ACT-AUDIT",
    loanDate: "2026-10-11",
    status: "outstanding",
    lines: [
      {
        code: reviewSession.stock[0]!.code,
        qty: 12,
        returned: 3,
        damaged: 2,
        lost: 1,
        location: longPath,
        batch: "AUDIT-BATCH",
      },
    ],
  });
  reviewSession.movements.push({
    lineId: "AUDIT-SETTLEMENT-1",
    name: "AUDIT-SETTLEMENT",
    kind: "Return",
    docstatus: 1,
    date: "2026-10-11",
    code: reviewSession.stock[0]!.code,
    itemName: reviewSession.stock[0]!.name,
    qty: 3,
    uom: reviewSession.stock[0]!.uom,
    from: longPath,
    to: "斋堂 / A-01",
    loanName: "AUDIT-LOAN",
    loanLineIndex: 0,
    activity: "",
  });
}
