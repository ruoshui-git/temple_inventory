"""Serve the generated site-wide PWA service worker."""

from pathlib import Path

from werkzeug.wrappers import Response

import frappe
from frappe.website.page_renderers.base_renderer import BaseRenderer


class ServiceWorkerPage(BaseRenderer):
	"""Expose the build artifact at a root URL with service-worker headers."""

	path_name = "temple-inventory-sw.js"

	def can_render(self):
		return self.path == self.path_name

	def render(self):
		worker_path = Path(frappe.get_app_path("temple_inventory", "public", "frontend", "sw.js"))
		if not worker_path.is_file():
			return Response("Service worker has not been built", status=404, mimetype="text/plain")
		response = Response(worker_path.read_bytes(), mimetype="application/javascript")
		response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
		response.headers["Pragma"] = "no-cache"
		response.headers["X-Content-Type-Options"] = "nosniff"
		return response
