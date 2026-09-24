"""Append a content hash to the site's own stylesheet and script URLs.

Cloudflare caches static files for hours (max-age=14400) but serves the HTML
fresh, and MkDocs links extra_css / extra_javascript by bare filename. So a
deploy that changes both pairs the new markup with yesterday's extra.css —
the homepage carousel shipped as a bulleted list of black logos that way.
A URL that changes whenever the file does makes that mismatch impossible,
and leaves the long cache lifetime intact for files that didn't change.

Material links these outside any template block, so this can't be done in
overrides/main.html.
"""
import hashlib
import os

from mkdocs.config.config_options import ExtraScriptValue


def _busted(path, docs_dir):
    full = os.path.join(docs_dir, path)
    if "://" in path or "?" in path or not os.path.isfile(full):
        return path
    with open(full, "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()[:10]
    return f"{path}?v={digest}"


def on_config(config):
    docs_dir = config["docs_dir"]
    config["extra_css"] = [_busted(p, docs_dir) for p in config["extra_css"]]
    for i, script in enumerate(config["extra_javascript"]):
        if isinstance(script, ExtraScriptValue):
            script.path = _busted(script.path, docs_dir)
        else:
            config["extra_javascript"][i] = _busted(script, docs_dir)
    return config
