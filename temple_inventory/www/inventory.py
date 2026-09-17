"""Context for the /inventory Vue single page app.

`inventory.html` next to this file is *generated* by `yarn build` inside
`apps/temple_inventory/frontend` (the frappe-ui Vite plugin copies the built
index.html here). In a production build that HTML ends with a Jinja block that
copies every key of `boot` onto `window`:

    {% for key in boot %} window["{{ key }}"] = {{ boot[key] | tojson }}; {% endfor %}

so this module is what puts `csrf_token` (and friends) on the page for
frappe-ui's request layer to pick up.
"""

import frappe

# Never cache the SPA shell: it references hashed asset filenames, so a cached
# shell would pin the browser to a bundle that no longer exists after a rebuild.
no_cache = 1


def get_context(context):
	context.boot = {
		"csrf_token": frappe.sessions.get_csrf_token(),
		"user": frappe.session.user,
		"site_name": frappe.local.site,
		"lang": frappe.local.lang or "en",
	}

	return context