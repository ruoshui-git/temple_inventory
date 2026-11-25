"""Search the visible codes and names of a single location."""

import re
from unicodedata import normalize as unicode_normalize

_SLASH_SPACES = re.compile(r"\s*/\s*")


def normalize(value):
	return _SLASH_SPACES.sub("/", unicode_normalize("NFKC", str(value or ""))).casefold()


def location_terms(path_segments, path_names):
	"""Return searchable text from presenter segments and names only."""
	parts = dict.fromkeys((*path_segments, *path_names, "/".join(path_segments)))
	return normalize(" ".join(filter(None, parts)))


def matches(term, terms):
	"""Match normalized text contiguously or by words within one location."""
	return bool(terms) and (term in terms or all(word in terms for word in term.split()))


def matching_locations(term, locations):
	"""Resolve the native IDs of readable physical locations once per search."""
	if not term:
		return set()
	return {
		row["name"]
		for row in locations
		if matches(
			term,
			# 借出 and 损坏待处理 show only their label; native root names stay unsearchable.
			normalize(row["label"])
			if row["kind"] == "system"
			else location_terms(row["path_segments"], row["path_names"]),
		)
	}
