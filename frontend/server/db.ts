/**
 * How the website's functions (netlify/functions/*.mts) connect to Supabase.
 *
 * TLS is always verified, like libpq's sslmode=verify-full: the server's
 * certificate must chain to DATABASE_CA_CERT when that is set, otherwise to
 * Supabase's own root CA, bundled below. Supabase signs its database and
 * pooler certificates with that CA, which no system trust store holds.
 */
import type { PoolConfig } from "pg";

/**
 * Supabase's root CA, "Supabase Root 2021 CA": the prod-ca-2021.crt file from
 * Supabase → Database settings → SSL configuration → Download certificate
 * (the same public file for every project). Valid until 26 April 2031.
 * SHA-256 fingerprint
 * 80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA.
 */
export const SUPABASE_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----
`;

export interface DbEnv {
  DATABASE_URL?: string;
  DATABASE_CA_CERT?: string;
}

/**
 * Connection-string parameters that node-postgres lets override the `ssl`
 * option (e.g. `?sslmode=require` would drop the CA, `sslmode=disable` TLS).
 */
const TLS_PARAMS = ["ssl", "sslmode", "sslrootcert", "sslcert", "sslkey", "sslnegotiation", "uselibpqcompat"];

/** A database on this machine (`netlify dev` with a local Postgres) needs no TLS. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Pool settings for one website function, or null when DATABASE_URL is
 * missing or isn't a Postgres URL (the function then answers 503).
 */
export function websitePoolConfig(env: DbEnv, max: number): PoolConfig | null {
  const raw = env.DATABASE_URL?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") return null;
  // TLS is decided here only; leave the URL as pasted unless it tries to change it.
  let connectionString = raw;
  if (TLS_PARAMS.some((name) => url.searchParams.has(name))) {
    for (const name of TLS_PARAMS) url.searchParams.delete(name);
    connectionString = url.toString();
  }
  return {
    connectionString,
    max,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
    ssl: LOCAL_HOSTS.has(url.hostname)
      ? false
      : { ca: env.DATABASE_CA_CERT?.trim() || SUPABASE_ROOT_CA, rejectUnauthorized: true },
  };
}
