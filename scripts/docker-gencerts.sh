#!/bin/sh
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CERT_DIR="$ROOT/docker/nginx/certs"
mkdir -p "$CERT_DIR"

if command -v mkcert >/dev/null 2>&1; then
  mkcert -install
  mkcert -cert-file "$CERT_DIR/server.crt" -key-file "$CERT_DIR/server.key" localhost 127.0.0.1 ::1
  echo "Wrote trusted certs via mkcert: $CERT_DIR/server.key and $CERT_DIR/server.crt"
  exit 0
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "Neither mkcert nor openssl found. Install mkcert (recommended) or openssl." >&2
  exit 1
fi

cat >"$CERT_DIR/openssl-localhost.cnf" <<'EOF'
[req]
default_bits = 2048
prompt = no
default_md = sha256
x509_extensions = v3_req
distinguished_name = dn

[dn]
CN = localhost

[v3_req]
subjectAltName = @alt_names
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
IP.2 = ::1
EOF

openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
  -keyout "$CERT_DIR/server.key" \
  -out "$CERT_DIR/server.crt" \
  -config "$CERT_DIR/openssl-localhost.cnf" -extensions v3_req

rm -f "$CERT_DIR/openssl-localhost.cnf"
echo "Wrote certs via openssl: $CERT_DIR/server.key and $CERT_DIR/server.crt"
echo "Warning: openssl cert can be untrusted in browser. Prefer mkcert for secure HTTPS."
