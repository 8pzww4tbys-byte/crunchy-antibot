#!/bin/sh
set -eu

# Reload Nginx only after a successful configuration test. Certbot calls this
# hook when a certificate is actually renewed.
nginx -t
systemctl reload nginx
