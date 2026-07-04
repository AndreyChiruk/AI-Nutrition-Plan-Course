$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$certDir = Join-Path $root "docker/nginx/certs"
New-Item -ItemType Directory -Force -Path $certDir | Out-Null
$key = Join-Path $certDir "server.key"
$crt = Join-Path $certDir "server.crt"

$mkcert = Get-Command mkcert -ErrorAction SilentlyContinue
if ($mkcert) {
    & mkcert -install
    & mkcert -cert-file $crt -key-file $key localhost 127.0.0.1 ::1
    Write-Host "Созданы доверенные сертификаты через mkcert: $key и $crt"
    exit 0
}

$openssl = Get-Command openssl -ErrorAction SilentlyContinue
if (-not $openssl) {
    Write-Error "Не найден mkcert/OpenSSL. Установите mkcert (рекомендуется) или OpenSSL."
}

$cfg = Join-Path $certDir "openssl-localhost.cnf"
@"
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
"@ | Set-Content -Path $cfg -Encoding ascii

& openssl req -x509 -nodes -days 825 -newkey rsa:2048 `
    -keyout $key -out $crt -config $cfg -extensions v3_req

Remove-Item -Force $cfg -ErrorAction SilentlyContinue
Write-Host "Созданы сертификаты через OpenSSL: $key и $crt"
Write-Warning "OpenSSL-сертификат может быть недоверенным в браузере. Для безопасного HTTPS используйте mkcert."
