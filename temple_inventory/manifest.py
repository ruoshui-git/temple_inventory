"""Serve the per-site PWA manifest without requiring a logged-in session."""

import json

from frappe.website.page_renderers.base_renderer import BaseRenderer
from werkzeug.wrappers import Response

from temple_inventory.environment import manifest


class ManifestPage(BaseRenderer):
	"""Expose an installable manifest at a stable root URL."""

	path_name = "temple-inventory.webmanifest"

	def can_render(self):
		return self.path == self.path_name

	def render(self):
		response = Response(json.dumps(manifest(), ensure_ascii=False), mimetype="application/manifest+json")
		response.headers["Cache-Control"] = "no-cache"
		response.headers["X-Content-Type-Options"] = "nosniff"
		return response
