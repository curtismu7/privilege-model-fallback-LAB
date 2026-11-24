// Safety rules. Pure functions plus two tiny middlewares. No I/O.
//  1. Loopback bind only unless PMF_BIND is set on purpose.
//  2. Host header must be a loopback name or on LAB_ALLOWED_HOSTS (DNS-rebinding defence): anything else is 421.
//  3. A write must be same-origin: a cross-origin Origin, or a cross-site Sec-Fetch-Site, is refused (403).
//  4. The one port is PROVISIONAL 7836 (packed range 7800-7999, owner rule 2026-11-07). NOT CLAIMED on the board yet.

export function isLoopbackHost(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(h);
}

export function bindHost(env = process.env) { return env.PMF_BIND || '127.0.0.1'; }

export function assertBindAllowed(host, env = process.env) {
  if (isLoopbackHost(host) || env.PMF_BIND) return host;
  throw new Error(`refusing to bind ${host}: loopback only. Set PMF_BIND to opt in.`);
}

export const DEFAULT_PORT = 7836; // PROVISIONAL, not claimed yet
const FORBIDDEN_PORTS = new Set([8080, 5173, 3000, 3900, 4000, 4400, 4510, 4600, 4601, 4840, 18080, 19080, 19090]);
export function portProblem(port) {
  if (!Number.isInteger(port)) return 'PORT is not an integer';
  if (FORBIDDEN_PORTS.has(port)) return `port ${port} is reserved for something else`;
  if (port < 7800 || port > 7999) return `port ${port} is outside the packed range 7800-7999`;
  return null;
}
export function resolvePort(env = process.env) {
  const port = env.PORT === undefined || env.PORT === '' ? DEFAULT_PORT : Number(env.PORT);
  const problem = portProblem(port);
  if (problem) throw new Error(problem);
  return port;
}

// Extra host names the Host check accepts (LAB_ALLOWED_HOSTS): proxy-served names that point at this Mac. Loopback always works.
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
export function allowedExtraHosts(env = process.env) {
  const extra = String(env.LAB_ALLOWED_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  for (const h of extra) if (!HOSTNAME.test(h)) throw new Error(`LAB_ALLOWED_HOSTS: not a host name: ${h.slice(0, 60)}`);
  return new Set(extra);
}

// The host part of a Host header: a bracketed IPv6 literal or a name/IPv4, with an optional :port. Anything else is null and refused.
export function hostOf(raw) {
  const m = /^(\[[0-9a-fA-F:.]+\]|[^\s:[\]]+)(?::\d{1,5})?$/.exec(String(raw));
  return m ? m[1] : null;
}

export function hostCheck(req, res, next) {
  const host = hostOf(req.headers.host || '');
  let extra;
  try { extra = allowedExtraHosts(); } catch { extra = new Set(); } // a bad setting is a start-up error (index.js, doctor); a request just never matches it
  if (host === null || (!isLoopbackHost(host) && !extra.has(host.toLowerCase()))) {
    return res.status(421).json({ error: 'bad_host', message: 'Host must be loopback or on LAB_ALLOWED_HOSTS' });
  }
  next();
}

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export function sameOriginWrites(req, res, next) {
  if (!WRITE.has(req.method)) return next();
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return res.status(403).json({ error: 'cross_origin', message: 'writes must be same-origin' });
  const origin = req.headers.origin;
  if (origin) {
    let ok = false;
    // Behind the shared lab-proxy the browser origin is the proxy's https host while the app serves plain http on loopback:
    // the proxy sets X-Forwarded-Host + X-Forwarded-Proto, so compare against that pair when present, else the raw Host over http.
    const fwdHost = String(req.headers['x-forwarded-host'] || '').toLowerCase();
    const fwdProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
    try {
      const u = new URL(origin);
      ok = fwdHost
        ? u.host.toLowerCase() === fwdHost && u.protocol === (fwdProto ? `${fwdProto}:` : 'https:')
        : u.protocol === 'http:' && u.host.toLowerCase() === String(req.headers.host || '').toLowerCase();
    } catch { /* malformed */ }
    if (!ok) return res.status(403).json({ error: 'cross_origin', message: 'writes must be same-origin' });
  }
  next();
}
