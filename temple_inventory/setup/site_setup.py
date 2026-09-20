"""Idempotent post-reinstall bootstrap for a Temple Inventory ERPNext site.

Run with:

    bench --site <site-name> execute temple_inventory.setup.site_setup.run

On a blank site, this creates an ERPNext Company, its currency, chart of
accounts, defaults, and the current fiscal year before configuring inventory.
The default Company is ``Org`` / ``O`` in the United States with
USD and ERPNext's Standard chart of accounts. Supply kwargs to change those
defaults.

When the site already has more than one Company, select the intended one
explicitly:

    bench --site <site-name> execute temple_inventory.setup.site_setup.run \\
      --kwargs "{'company': 'My Company'}"

On an already configured site, it reuses the selected Company setup. It never
creates items or stock. Every run creates any missing canonical example
warehouses and enables ERPNext's global batch-item setting.
"""

from __future__ import annotations

from datetime import timedelta

import frappe
from frappe.utils import getdate, nowdate


def _get_company(company: str | None = None) -> str:
	"""Resolve an existing Company without guessing on multi-company sites."""
	if company:
		if not frappe.db.exists("Company", company):
			frappe.throw(f"Company does not exist: {company}")
		return company

	settings_company = frappe.db.get_single_value("Temple Inventory Settings", "company")
	if settings_company and frappe.db.exists("Company", settings_company):
		return settings_company

	companies = frappe.get_all("Company", pluck="name", limit_page_length=0)
	if len(companies) == 1:
		return companies[0]
	frappe.throw(
		"More than one Company exists. Run this command with a company argument, for example: "
		"--kwargs \"{'company': 'My Company'}\""
	)


def _bootstrap_erpnext(
	company: str | None,
	abbr: str | None,
	country: str,
	currency: str,
	chart_of_accounts: str,
	fiscal_year_start: str | None,
	fiscal_year_end: str | None,
) -> str:
	"""Complete ERPNext's supported setup-wizard flow on a site with no Company."""
	from erpnext.setup.setup_wizard.setup_wizard import setup_complete

	company = company or "Org"
	abbr = abbr or "O"
	start = getdate(fiscal_year_start or f"{getdate(nowdate()).year}-01-01")
	end = (
		getdate(fiscal_year_end)
		if fiscal_year_end
		else start.replace(year=start.year + 1) - timedelta(days=1)
	)
	args = frappe._dict(
		{
			"company_name": company,
			"company_abbr": abbr,
			"country": country,
			"currency": currency,
			"chart_of_accounts": chart_of_accounts,
			"domain": None,
			"fy_start_date": str(start),
			"fy_end_date": str(end),
		}
	)

	original_user = frappe.session.user
	try:
		frappe.set_user("Administrator")
		setup_complete(args)
	finally:
		frappe.set_user(original_user)
	return company


def run(
	company: str | None = None,
	abbr: str | None = None,
	country: str = "United States",
	currency: str = "USD",
	chart_of_accounts: str = "Standard",
	fiscal_year_start: str | None = None,
	fiscal_year_end: str | None = None,
) -> dict:
	"""Bootstrap a blank site, then create sample warehouses and enable batch tracking."""
	companies = frappe.get_all("Company", pluck="name", limit_page_length=0)
	bootstrapped = not companies
	if bootstrapped:
		company = _bootstrap_erpnext(
			company,
			abbr,
			country,
			currency,
			chart_of_accounts,
			fiscal_year_start,
			fiscal_year_end,
		)
	else:
		company = _get_company(company)

	from temple_inventory.inventory_api import _create_structure

	structure = _create_structure(company, include_examples=True)
	stock_settings = frappe.get_single("Stock Settings")
	batch_tracking_was_enabled = bool(stock_settings.enable_serial_and_batch_no_for_item)
	if not batch_tracking_was_enabled:
		stock_settings.enable_serial_and_batch_no_for_item = 1
		stock_settings.save(ignore_permissions=True)

	frappe.db.commit()
	return {
		"company": company,
		"erpnext_bootstrapped": bootstrapped,
		"warehouse_structure": structure,
		"batch_tracking_enabled": True,
		"batch_tracking_changed": not batch_tracking_was_enabled,
	}
