import {
  browseRouteTarget,
  type AppRouteTarget,
} from "../../lib/routeRegistry";
import { newReportQuery } from "../../lib/reportContract";

export function activityMovementTarget(
  activity: string,
  kind?: string,
): AppRouteTarget {
  const query = newReportQuery("movements");
  query.view = "records";
  query.scope.activity = activity;
  query.scope.kinds = kind ? [kind] : [];
  return browseRouteTarget(query);
}

export function activityLoansTarget(activity: string): AppRouteTarget {
  const query = newReportQuery("loans");
  query.scope.activity = activity;
  query.outstandingOnly = true;
  return browseRouteTarget(query);
}
