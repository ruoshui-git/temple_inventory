app_name = "temple_inventory"
app_title = "物资管理"
app_publisher = "Ruoshui"
app_description = "Custom Inventory Frontend For ERPNext"
app_email = "ruoshuim@gmail.com"
app_license = "mit"

# Website Route Rules
# -------------------
# Send every /inventory/* path to the Vue single page app entry point
# (temple_inventory/www/inventory.html, produced by `yarn build` in frontend/).
# Without this, a refresh on a client side route inside the SPA would 404.
website_route_rules = [
	{"from_route": "/inventory/<path:app_path>", "to_route": "inventory"},
]

fixtures = [
	{"dt": "Custom Field", "filters": [["module", "=", "Temple Inventory"]]},
]

doc_events = {
	"Stock Entry": {
		"before_submit": "temple_inventory.stock.validate_stock_entry_submission",
		"before_validate": "temple_inventory.stock.protect_workspace_entry",
	}
}

# Apps
# ------------------

required_apps = ["erpnext"]

# Each item in the list will be shown as an app in the apps page
add_to_apps_screen = [
	{
		"name": "temple_inventory",
		"logo": "/assets/temple_inventory/logo.png",
		"title": "物资管理",
		"route": "/inventory",
		"has_permission": "temple_inventory.api.has_app_permission"
	}
]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/temple_inventory/css/temple_inventory.css"
# app_include_js = "/assets/temple_inventory/js/temple_inventory.js"

# include js, css files in header of web template
# web_include_css = "/assets/temple_inventory/css/temple_inventory.css"
# web_include_js = "/assets/temple_inventory/js/temple_inventory.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "temple_inventory/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
# doctype_js = {"doctype" : "public/js/doctype.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}


# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "temple_inventory/public/logo.png"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# automatically load and sync documents of this doctype from downstream apps
# importable_doctypes = [doctype_1]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "temple_inventory.utils.jinja_methods",
# 	"filters": "temple_inventory.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "temple_inventory.install.before_install"
# after_install = "temple_inventory.install.after_install"

# Uninstallation
# ------------

# before_uninstall = "temple_inventory.uninstall.before_uninstall"
# after_uninstall = "temple_inventory.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "temple_inventory.utils.before_app_install"
# after_app_install = "temple_inventory.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "temple_inventory.utils.before_app_uninstall"
# after_app_uninstall = "temple_inventory.utils.after_app_uninstall"

# Build
# ------------------
# To hook into the build process

# after_build = "temple_inventory.build.after_build"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "temple_inventory.notifications.get_notification_config"

# Awesome Bar
# -----------
# Extra search results: list of dicts with label, description, route, index.
# route: ["List", "ToDo"], "/desk/docs/some/page", or "https://example.com"
# awesomebar_search = ["temple_inventory.search.awesomebar_results"]

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# Document Events
# ---------------
# Hook on document methods and events

# doc_events = {
# 	"*": {
# 		"on_update": "method",
# 		"on_cancel": "method",
# 		"on_trash": "method"
# 	}
# }

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"temple_inventory.tasks.all"
# 	],
# 	"daily": [
# 		"temple_inventory.tasks.daily"
# 	],
# 	"hourly": [
# 		"temple_inventory.tasks.hourly"
# 	],
# 	"weekly": [
# 		"temple_inventory.tasks.weekly"
# 	],
# 	"monthly": [
# 		"temple_inventory.tasks.monthly"
# 	],
# }

# Testing
# -------

# before_tests = "temple_inventory.install.before_tests"

# Extend DocType Class
# ------------------------------
#
# Specify custom mixins to extend the standard doctype controller.
# extend_doctype_class = {
# 	"Task": "temple_inventory.custom.task.CustomTaskMixin"
# }

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "temple_inventory.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "temple_inventory.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["temple_inventory.utils.before_request"]
# after_request = ["temple_inventory.utils.after_request"]

# Job Events
# ----------
# before_job = ["temple_inventory.utils.before_job"]
# after_job = ["temple_inventory.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"temple_inventory.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

# Translation
# ------------
# List of apps whose translatable strings should be excluded from this app's translations.
# ignore_translatable_strings_from = []


has_permission = {"Inventory Workspace": "temple_inventory.workspace_permissions.has_permission"}
permission_query_conditions = {"Inventory Workspace": "temple_inventory.workspace_permissions.query_conditions"}

extend_doctype_class = {"File": ["temple_inventory.file.InventoryFileMixin"]}
