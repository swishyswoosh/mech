import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
export type TokenGrant = { id: string; sha256: string; scopes: string[]; droids: string[]; revoked?: boolean };
export class HttpError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message = code) {
        super(message);
        this.status = status;
        this.code = code;
    }
}
export class Authentication {
    private sessions = new Map<string, { grant: TokenGrant; csrf: string; expires: number }>();
    tokens: TokenGrant[];
    origins: Set<string>;
    prefix: string;
    constructor(tokens: TokenGrant[], origins: string[], prefix: string) {
        if (
            tokens.some(
                (t) =>
                    !t.id ||
                    !/^[0-9a-f]{64}$/.test(t.sha256) ||
                    ((t.scopes.includes('operate') || t.scopes.includes('power')) && !t.scopes.includes('stop')),
            )
        )
            throw Error('Invalid token configuration; operators require STOP scope');
        if (origins.some((o) => new URL(o).origin !== o)) throw Error('Origins must be exact HTTP(S) origins');
        this.tokens = tokens;
        this.origins = new Set(origins);
        this.prefix = prefix;
    }
    origin(req: IncomingMessage, required = false) {
        const origin = req.headers.origin;
        if ((required && !origin) || (origin && !this.origins.has(origin))) throw new HttpError(403, 'origin_denied');
    }
    token(value: string) {
        const hash = createHash('sha256').update(value).digest();
        return this.tokens.find((t) => !t.revoked && timingSafeEqual(hash, Buffer.from(t.sha256, 'hex')));
    }
    login(req: IncomingMessage, token: string) {
        this.origin(req, true);
        const grant = this.token(token);
        if (!grant) throw new HttpError(401, 'unauthenticated');
        if (this.sessions.size >= 1000) for (const [key, s] of this.sessions) if (s.expires < Date.now()) this.sessions.delete(key);
        if (this.sessions.size >= 1000) throw new HttpError(429, 'session_limit');
        const id = randomBytes(32).toString('hex'),
            csrf = randomBytes(24).toString('hex');
        this.sessions.set(id, { grant, csrf, expires: Date.now() + 900000 });
        return { id, csrf, grant };
    }
    private session(req: IncomingMessage) {
        const id = req.headers.cookie
            ?.split(';')
            .map((s) => s.trim())
            .find((s) => s.startsWith('mech_session='))
            ?.slice(13);
        return { id, value: id ? this.sessions.get(id) : undefined };
    }
    authenticate(req: IncomingMessage, mutating = false) {
        this.origin(req);
        const bearer = req.headers.authorization;
        if (bearer?.startsWith('Bearer ')) {
            const grant = this.token(bearer.slice(7));
            if (!grant) throw new HttpError(401, 'unauthenticated');
            return { grant, csrf: undefined, valid: () => !grant.revoked };
        }
        const { value } = this.session(req);
        if (!value || value.expires <= Date.now() || value.grant.revoked) throw new HttpError(401, 'unauthenticated');
        if (mutating) {
            this.origin(req, true);
            if (req.headers['x-csrf-token'] !== value.csrf) throw new HttpError(403, 'csrf_required');
        }
        return {
            grant: value.grant,
            csrf: value.csrf,
            valid: () => !value.grant.revoked && value.expires > Date.now() && this.session(req).value === value,
        };
    }
    logout(req: IncomingMessage) {
        this.authenticate(req, true);
        const { id } = this.session(req);
        if (id) this.sessions.delete(id);
    }
    allowed(grant: TokenGrant, droid: string) {
        return !grant.revoked && (grant.droids.includes('*') || grant.droids.includes(droid));
    }
    require(grant: TokenGrant, scope: string, droid?: string) {
        if (droid && !this.allowed(grant, droid)) throw new HttpError(404, 'not_found');
        if (!grant.scopes.includes(scope)) throw new HttpError(403, 'scope_denied');
    }
    cookie(id: string, secure: boolean, crossSite = false) {
        return `mech_session=${id}; Path=${this.prefix || '/'}; HttpOnly; SameSite=${crossSite ? 'None' : 'Strict'}; Max-Age=${id ? 900 : 0}${secure ? '; Secure' : ''}`;
    }
}
