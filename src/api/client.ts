import type {
  AggregatesResponse,
  AggregateWindow,
  ApiError,
  AuthExchangeRequest,
  AuthExchangeResponse,
  CatalogueResponse,
  ContributionResponse,
  ContributionSummary,
  ProfileGetResponse,
  ProfileRequest,
  ProfileResponse,
  PullNightsResponse,
  RemedyDetailResponse,
  SubscriptionResponse,
  SyncNightsRequest,
  SyncNightsResponse,
} from '../../shared/api';

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * The /v1 client. Backend-agnostic: it only knows the base URL (VPS or Supabase function).
 */
export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => string | null,
    private readonly fetchFn: Fetch = (i, init) => fetch(i, init),
    private readonly onUnauthorized: () => void = () => undefined,
  ) {}

  get configured(): boolean {
    return this.baseUrl.length > 0;
  }

  private async request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: T | null; etag: string | null }> {
    if (!this.configured) throw new ApiFailure(0, 'not_configured', 'No server is configured for this build.');
    const token = this.getToken();
    const res = await this.fetchFn(`${this.baseUrl}/v1${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) this.onUnauthorized();
    if (res.status === 204 || res.status === 304 || res.status === 202) return { status: res.status, body: null, etag: res.headers.get('etag') };
    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
      const err = (json as ApiError | null)?.error;
      throw new ApiFailure(res.status, err?.code ?? 'http_error', err?.message ?? `Request failed (${res.status})`);
    }
    return { status: res.status, body: json as T, etag: res.headers.get('etag') };
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await this.request<T>(method, path, body);
    return r.body as T;
  }

  requestMagicLink(email: string): Promise<void> {
    return this.request('POST', '/auth/magic-link', { email }).then(() => undefined);
  }
  exchange(req: AuthExchangeRequest) {
    return this.json<AuthExchangeResponse>('POST', '/auth/exchange', req);
  }
  deleteAccount(): Promise<void> {
    return this.request('DELETE', '/account').then(() => undefined);
  }
  catalogue(since: number) {
    return this.json<CatalogueResponse>('GET', `/catalogue?since=${since}`);
  }
  suggest(text: string): Promise<void> {
    return this.request('POST', '/catalogue/suggest', { text }).then(() => undefined);
  }
  pushNights(req: SyncNightsRequest) {
    return this.json<SyncNightsResponse>('POST', '/sync/nights', req);
  }
  pullNights(since: string | null) {
    return this.json<PullNightsResponse>('GET', `/sync/nights${since ? `?since=${encodeURIComponent(since)}` : ''}`);
  }
  deleteNight(id: string): Promise<void> {
    return this.request('DELETE', `/sync/nights/${encodeURIComponent(id)}`).then(() => undefined);
  }
  getProfile() {
    return this.json<ProfileGetResponse>('GET', '/profile');
  }
  putProfile(p: ProfileRequest) {
    return this.json<ProfileResponse>('PUT', '/profile', p);
  }
  setContribution(optedIn: boolean) {
    return this.json<ContributionResponse>('PUT', '/contribution', { opted_in: optedIn });
  }
  contributionSummary() {
    return this.json<ContributionSummary>('GET', '/contribution/summary');
  }
  /** Returns null body on 304 (the cached copy is current). */
  aggregates(segment: string, window: AggregateWindow, etag: string | null) {
    return this.request<AggregatesResponse>(
      'GET',
      `/aggregates?segment=${encodeURIComponent(segment)}&window=${window}`,
      undefined,
      etag ? { 'If-None-Match': etag } : {},
    );
  }
  remedyDetail(remedyId: string) {
    return this.json<RemedyDetailResponse>('GET', `/aggregates/${encodeURIComponent(remedyId)}`);
  }
  subscription() {
    return this.json<SubscriptionResponse>('GET', '/subscription');
  }
}
