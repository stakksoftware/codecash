// Storage backend selector. Every server module imports the store from here so
// the same code runs on either backend:
//   - Supabase Postgres (production)  when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set
//   - file-backed JSON store (local/tests) otherwise
//
// Both backends expose the identical function surface. The Postgres backend is
// async; the file backend is sync. Callers always `await`, which works for both.

// Static imports so bundlers (Vercel/nft) include both backends; we pick one at
// load time. store-pg only touches env when its functions are called.
import * as fileBackend from './store.js';
import * as pgBackend from './store-pg.js';

const usePg = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const backend = usePg ? pgBackend : fileBackend;

export const backendName = usePg ? 'supabase-postgres' : 'file';

export const init = backend.init;
export const flush = backend.flush;
export const upsertAccount = backend.upsertAccount;
export const getAccount = backend.getAccount;
export const setIdentityVerified = backend.setIdentityVerified;
export const registerDevice = backend.registerDevice;
export const getDevice = backend.getDevice;
export const createSession = backend.createSession;
export const resolveAccessToken = backend.resolveAccessToken;
export const resolveRefreshToken = backend.resolveRefreshToken;
export const appendLedger = backend.appendLedger;
export const ledgerForAccount = backend.ledgerForAccount;
export const ledgerForCampaigns = backend.ledgerForCampaigns;
export const balanceMicros = backend.balanceMicros;
export const creditedTodayMicros = backend.creditedTodayMicros;
export const recordTransfer = backend.recordTransfer;
export const nonceSeen = backend.nonceSeen;
export const rememberNonce = backend.rememberNonce;
export const recordCounterSubmission = backend.recordCounterSubmission;
export const recentCounterCount = backend.recentCounterCount;
export const createAdvertiser = backend.createAdvertiser;
export const resolveApiKey = backend.resolveApiKey;
export const getAdvertiser = backend.getAdvertiser;
export const fundAdvertiser = backend.fundAdvertiser;
export const createCampaign = backend.createCampaign;
export const getCampaign = backend.getCampaign;
export const setCampaignStatus = backend.setCampaignStatus;
export const updateCampaign = backend.updateCampaign;
export const deleteCampaign = backend.deleteCampaign;
export const campaignsForAdvertiser = backend.campaignsForAdvertiser;
export const activeCampaigns = backend.activeCampaigns;
export const campaignRemainingBudget = backend.campaignRemainingBudget;
export const recordSpend = backend.recordSpend;
export const recordCampaignEvent = backend.recordCampaignEvent;
export const campaignStats = backend.campaignStats;
export const _reset = backend._reset;
export const _all = backend._all;
