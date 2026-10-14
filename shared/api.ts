/**
 * The /v1 API contract shared by the app and the server. The server can run on a VPS
 * (Node) or on Supabase (Edge Functions + Postgres); this contract does not change.
 * All timestamps are ISO 8601 UTC. Errors: { error: { code, message } }.
 */
import type { AmazonProduct, AmazonTags } from './amazon';
import type { ProfileBands } from './profile';
import type { AggregateStatus } from './remedyEffect';

export interface ApiError {
  error: { code: string; message: string };
}

// ---- Auth (an account is always required) ----

export type AuthProvider = 'apple' | 'google' | 'email';

/** POST /v1/auth/magic-link: emails a one-time sign-in link. */
export interface MagicLinkRequest {
  email: string;
}

/** POST /v1/auth/exchange: provider ID token (or magic-link token) for an app session. */
export interface AuthExchangeRequest {
  provider: AuthProvider;
  token: string;
  /** Apple only: the user's name on first sign-in (Apple sends it once). */
  name?: string | null;
}

export interface AuthExchangeResponse {
  session_token: string;
  user_id: string;
  expires_at: string;
}

// ---- Catalogue ----

export interface CatalogueItemDto {
  id: string;
  type: 'remedy' | 'factor';
  kind: 'device' | 'habit' | 'factor';
  category: string;
  name: string;
  article_md: string;
  /** Kept for API compatibility; null now that links are built from `amazon`. */
  link_url: string | null;
  amazon: AmazonProduct | null;
  value_options?: string[];
  active: boolean;
}

/** GET /v1/catalogue?since=<version> */
export interface CatalogueResponse {
  version: number;
  items: CatalogueItemDto[];
  amazon_tags: AmazonTags;
}

/** POST /v1/catalogue/suggest → 202 */
export interface CatalogueSuggestRequest {
  text: string;
}

// ---- Sync ----

export interface HealthSummaryDto {
  sleep_efficiency: number | null;
  spo2_min: number | null;
  spo2_dips: number | null;
  hr_mean: number | null;
  hr_max: number | null;
  hrv_mean: number | null;
  resp_mean: number | null;
}

export interface NightDto {
  id: string;
  date: string;
  duration_s: number;
  /** Time in bed after subtracting interruptions. */
  time_in_bed_s: number;
  score: number;
  score_version: number;
  pct_snoring: number;
  event_count: number;
  max_db: number;
  partial: boolean;
  typical: boolean | null;
  health: HealthSummaryDto | null;
  remedies: string[];
  factors: { id: string; value: string | null }[];
  updated_at: string;
}

/** POST /v1/sync/nights */
export interface SyncNightsRequest {
  device_id: string;
  nights: NightDto[];
}

export interface SyncNightsResponse {
  accepted: string[];
  rejected: { id: string; reason: string }[];
}

/** GET /v1/sync/nights?since=<iso> */
export interface PullNightsResponse {
  nights: NightDto[];
  /** Pass back as `since` next time. */
  cursor: string;
}

/** DELETE /v1/sync/nights/:id → 204 (the user deleted a night on the phone). */

// ---- Profile and contribution ----

/** PUT /v1/profile */
export interface ProfileRequest extends ProfileBands {
  version: number;
}

export interface ProfileResponse {
  version: number;
}

/** GET /v1/profile */
export type ProfileGetResponse = ProfileRequest;

/** PUT /v1/contribution */
export interface ContributionRequest {
  opted_in: boolean;
}

export interface ContributionResponse {
  opted_in: boolean;
  contributor_id_exists: boolean;
}

/** GET /v1/contribution/summary */
export interface ContributionSummary {
  opted_in: boolean;
  nights: number;
  remedies_logged: number;
  since: string | null;
}

// ---- Community dashboard ----

export type AggregateWindow = 'all' | '90d';

export interface AggregateRowDto {
  remedy_id: string;
  status: AggregateStatus;
  users: number;
  /** Null when status is 'hidden'. */
  nights: number | null;
  median_delta: number | null;
  p25: number | null;
  p75: number | null;
  median_delta_pct: number | null;
  holds_without_alcohol: boolean | null;
  /** Compared with the all-time figure: is the last 90 days better, worse or the same? */
  trend: 'better' | 'worse' | 'steady' | null;
}

export interface StackRowDto {
  remedy_ids: [string, string];
  users: number;
  nights: number;
  median_delta: number;
  p25: number;
  p75: number;
}

/** GET /v1/aggregates?segment=<key>&window=<all|90d>; supports If-None-Match. */
export interface AggregatesResponse {
  segment: string;
  window: AggregateWindow;
  /** 'hidden' when the segment has fewer than 10 contributors: no rows are returned. */
  segment_status: 'ok' | 'hidden';
  computed_at: string | null;
  remedies: AggregateRowDto[];
  stacks: StackRowDto[];
  /** For the "early days" state: how many people are testing how many remedies. */
  testing: { people: number; remedies: number };
}

/** GET /v1/aggregates/:remedy_id */
export interface RemedyDetailResponse {
  remedy_id: string;
  all: AggregateRowDto | null;
  distribution: { bucket: number; count: number }[];
  by_segment: (AggregateRowDto & { segment: string })[];
  /** True for the free tier: profile breakdowns are a paid feature, so by_segment is empty. */
  by_segment_locked: boolean;
  article_md: string;
  amazon: AmazonProduct | null;
}

// ---- Reports and subscriptions ----

/** GET /v1/subscription: mirrored from RevenueCat webhooks. */
export interface SubscriptionResponse {
  active: boolean;
  plan: 'yearly' | 'monthly' | null;
  expires_at: string | null;
}

export const PAID_ENTITLEMENT = 'insight';
