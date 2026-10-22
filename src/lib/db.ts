import Database from "@tauri-apps/plugin-sql";
import { LazyStore } from "@tauri-apps/plugin-store";
import { nextRecurrenceAfter, toLocalIso } from "./recurrence";
import type {
  Capture,
  CaptureDestinations,
  CaptureLane,
  CaptureTag,
  RoutingRule,
  RoutingRuleField,
  CaptureLink,
  LinkDestination,
} from "../types";
import type { SyncDestination } from "./sync/destinations";

const DB_URL = "sqlite:chute.db";
const SECURE_STORE_PATH = "secure-settings.json";
const DEFAULT_LIST_NAME = "Inbox";
const DISTRACTION_LIST_NAME = "Parking Lot";
let dbPromise: Promise<Database> | null = null;
const secureStore = new LazyStore(SECURE_STORE_PATH, {
  autoSave: 100,
  defaults: {},
});

const SENSITIVE_SETTING_KEYS = new Set([
  "openai_api_key",
  "slack_webhook_url",
  "discord_webhook_url",
  "notion_token",
  "notion_page_id",
  "google_tasks_access_token",
  "google_tasks_refresh_token",
  "google_tasks_list_id",
  "google_calendar_id",
]);
const CAPTURE_SELECT_FIELDS = `
  captures.id,
  captures.content,
  captures.tag,
  captures.capture_lane,
  captures.list_name,
  captures.created_at,
  captures.synced_slack,
  captures.synced_discord,
  captures.synced_google_tasks,
  captures.synced_google_calendar,
  captures.synced_notion,
  captures.synced_apple_reminders,
  captures.synced_reminders,
  captures.synced_apple_calendar,
  captures.target_slack,
  captures.target_discord,
  captures.target_notion,
  captures.target_google_tasks,
  captures.target_google_calendar,
  captures.target_apple_reminders,
  captures.target_reminders,
  captures.target_apple_calendar,
  captures.reminder_time,
  captures.recurrence_rule,
  captures.recurrence_next_at,
  captures.routing_source,
  captures.routing_reason,
  captures.last_sync_error,
  agent_jobs.status AS agent_status,
  agent_jobs.attempts AS agent_attempts,
  agent_jobs.intent AS agent_intent,
  agent_jobs.confidence AS agent_confidence,
  agent_jobs.action_json AS agent_action_json,
  agent_jobs.needs_review AS agent_needs_review,
  agent_jobs.error AS agent_error
`;

function getDatabase(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load(DB_URL);
  }
  return dbPromise;
}

function isSensitiveSettingKey(key: string): boolean {
  return SENSITIVE_SETTING_KEYS.has(key);
}

async function getSecureSettingValue(key: string): Promise<string | null> {
  const value = await secureStore.get<unknown>(key);
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return null;
  }
  return String(value);
}

async function setSecureSettingValue(key: string, value: string): Promise<void> {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    await secureStore.delete(key);
    await secureStore.save();
    return;
  }

  await secureStore.set(key, value);
  await secureStore.save();
}

async function getSqliteSettingValue(key: string): Promise<string | null> {
  const db = await getDatabase();
  const rows = await db.select<Array<{ value: string }>>(
    `
      SELECT value
      FROM settings
      WHERE key = $1
      LIMIT 1;
    `,
    [key],
  );
  return rows[0]?.value ?? null;
}

async function deleteSqliteSettingValue(key: string): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `
      DELETE FROM settings
      WHERE key = $1;
    `,
    [key],
  );
}

async function migrateSensitiveSettingsFromSqlite(): Promise<void> {
  for (const key of SENSITIVE_SETTING_KEYS) {
    const sqliteValue = await getSqliteSettingValue(key);
    if (sqliteValue === null) {
      continue;
    }

    const secureValue = await getSecureSettingValue(key);
    if (!secureValue) {
      await setSecureSettingValue(key, sqliteValue);
    }

    await deleteSqliteSettingValue(key);
  }
}

async function ensureCaptureColumn(
  db: Database,
  columnName: string,
  definition: string,
): Promise<void> {
  const columns = await db.select<Array<{ name: string }>>("PRAGMA table_info(captures);");
  const hasColumn = columns.some((column) => column.name === columnName);

  if (hasColumn) {
    return;
  }

  try {
    await db.execute(`ALTER TABLE captures ADD COLUMN ${columnName} ${definition};`);
  } catch (error) {
    // Tolerate a concurrent bootstrap that added the same column first.
    const message = error instanceof Error ? error.message : String(error);
    if (!/duplicate column name/i.test(message)) {
      throw error;
    }
  }
}

function normalizeListName(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_LIST_NAME;
}

function normalizeLane(value: CaptureLane | string | null | undefined): CaptureLane {
  return value === "distraction" ? "distraction" : "focus";
}

function resolveListForLane(listName: string, lane: CaptureLane): string {
  const normalizedList = normalizeListName(listName);
  if (lane === "distraction" && normalizedList.toLowerCase() === DEFAULT_LIST_NAME.toLowerCase()) {
    return DISTRACTION_LIST_NAME;
  }
  return normalizedList;
}

function isDefaultListName(value: string): boolean {
  return normalizeListName(value).toLowerCase() === DEFAULT_LIST_NAME.toLowerCase();
}

function computeRecurrenceNextAt(
  reminderTime: string | null | undefined,
  recurrenceRule: string | null | undefined,
): string | null {
  if (!reminderTime || !recurrenceRule) {
    return null;
  }

  const parsedReminder = new Date(reminderTime);
  if (Number.isNaN(parsedReminder.getTime())) {
    return null;
  }

  const next = nextRecurrenceAfter(parsedReminder, recurrenceRule, parsedReminder);
  return next ? toLocalIso(next) : null;
}

async function ensureManagedList(db: Database, listName: string): Promise<string> {
  const normalized = normalizeListName(listName);
  await db.execute(
    `
      INSERT OR IGNORE INTO lists (name)
      VALUES ($1);
    `,
    [normalized],
  );

  const rows = await db.select<Array<{ name: string }>>(
    `
      SELECT name
      FROM lists
      WHERE LOWER(name) = LOWER($1)
      LIMIT 1;
    `,
    [normalized],
  );

  return normalizeListName(rows[0]?.name ?? normalized);
}

let bootstrapPromise: Promise<void> | null = null;

export async function bootstrapDatabase(): Promise<void> {
  // Serialize bootstrap so concurrent callers (React StrictMode double-invoke,
  // multiple windows) cannot race the schema migrations.
  if (!bootstrapPromise) {
    bootstrapPromise = runBootstrap().catch((error) => {
      bootstrapPromise = null;
      throw error;
    });
  }
  return bootstrapPromise;
}

/** Open the DB connection without running migrations (settings webview). */
export async function ensureDatabaseReady(): Promise<void> {
  const db = await getDatabase();
  await db.execute("PRAGMA journal_mode = WAL;");
  await db.execute("PRAGMA busy_timeout = 10000;");
}

async function runBootstrap(): Promise<void> {
  const db = await getDatabase();

  // Multiple webviews (capture + settings) open separate connections to the same file.
  // WAL + busy_timeout reduce lock errors and native crashes on Windows.
  await db.execute("PRAGMA journal_mode = WAL;");
  await db.execute("PRAGMA busy_timeout = 10000;");

  await db.execute(`
    CREATE TABLE IF NOT EXISTS captures (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      tag TEXT DEFAULT 'untagged',
      capture_lane TEXT DEFAULT 'focus',
      list_name TEXT DEFAULT 'Inbox',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      synced_slack INTEGER DEFAULT 0,
      synced_discord INTEGER DEFAULT 0,
      synced_google_tasks INTEGER DEFAULT 0,
      synced_google_calendar INTEGER DEFAULT 0,
      synced_notion INTEGER DEFAULT 0,
      synced_apple_reminders INTEGER DEFAULT 0,
      synced_reminders INTEGER DEFAULT 0,
      synced_apple_calendar INTEGER DEFAULT 0,
      target_slack INTEGER DEFAULT 1,
      target_discord INTEGER DEFAULT 1,
      target_notion INTEGER DEFAULT 1,
      target_google_tasks INTEGER DEFAULT 1,
      target_google_calendar INTEGER DEFAULT 0,
      target_apple_reminders INTEGER DEFAULT 0,
      target_reminders INTEGER DEFAULT 0,
      target_apple_calendar INTEGER DEFAULT 0,
      reminder_time DATETIME NULL,
      recurrence_rule TEXT NULL,
      recurrence_next_at DATETIME NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS lists (
      name TEXT PRIMARY KEY COLLATE NOCASE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS routing_rules (
      id TEXT PRIMARY KEY,
      field TEXT NOT NULL,
      match_value TEXT NOT NULL,
      destinations TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      hit_count INTEGER NOT NULL DEFAULT 0
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS agent_jobs (
      capture_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      intent TEXT NULL,
      confidence REAL NULL,
      action_json TEXT NULL,
      needs_review INTEGER NOT NULL DEFAULT 0,
      error TEXT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(capture_id) REFERENCES captures(id) ON DELETE CASCADE
    );
  `);

  // Where each capture landed in each app (that app's id for the item), so Chute
  // can find it again to open it or add to it. One row per capture per app.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS capture_links (
      capture_id TEXT NOT NULL,
      destination TEXT NOT NULL,
      external_id TEXT NOT NULL,
      kind TEXT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (capture_id, destination)
    );
  `);

  // Additions to a capture that already reached an app ("Add to"): one row per
  // addition per app, sent by the sync pass. Gives up after a few attempts
  // until the user retries from Landed.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS capture_appends (
      id TEXT PRIMARY KEY,
      capture_id TEXT NOT NULL,
      destination TEXT NOT NULL,
      content TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await ensureCaptureColumn(db, "synced_notion", "INTEGER DEFAULT 0");
  await ensureCaptureColumn(db, "capture_lane", "TEXT DEFAULT 'focus'");
  await ensureCaptureColumn(db, "list_name", "TEXT DEFAULT 'Inbox'");
  await ensureCaptureColumn(db, "target_slack", "INTEGER DEFAULT 1");
  await ensureCaptureColumn(db, "target_discord", "INTEGER DEFAULT 1");
  await ensureCaptureColumn(db, "target_notion", "INTEGER DEFAULT 1");
  await ensureCaptureColumn(db, "target_google_tasks", "INTEGER DEFAULT 1");
  await ensureCaptureColumn(db, "synced_google_calendar", "INTEGER DEFAULT 0");
  await ensureCaptureColumn(db, "target_google_calendar", "INTEGER DEFAULT 0");
  await ensureCaptureColumn(db, "synced_apple_reminders", "INTEGER DEFAULT 0");
  await ensureCaptureColumn(db, "target_apple_reminders", "INTEGER DEFAULT 0");
  await ensureCaptureColumn(db, "synced_reminders", "INTEGER DEFAULT 0");
  await ensureCaptureColumn(db, "target_reminders", "INTEGER DEFAULT 0");
  await ensureCaptureColumn(db, "synced_apple_calendar", "INTEGER DEFAULT 0");
  await ensureCaptureColumn(db, "target_apple_calendar", "INTEGER DEFAULT 0");
  await ensureCaptureColumn(db, "last_sync_error", "TEXT NULL");
  await ensureCaptureColumn(db, "recurrence_rule", "TEXT NULL");
  await ensureCaptureColumn(db, "recurrence_next_at", "DATETIME NULL");
  await ensureCaptureColumn(db, "routing_source", "TEXT NULL");
  await ensureCaptureColumn(db, "routing_reason", "TEXT NULL");

  await db.execute(
    `
      INSERT OR IGNORE INTO lists (name)
      VALUES ($1);
    `,
    [DEFAULT_LIST_NAME],
  );
  await db.execute(
    `
      INSERT OR IGNORE INTO lists (name)
      VALUES ($1);
    `,
    [DISTRACTION_LIST_NAME],
  );

  await db.execute(`
    INSERT OR IGNORE INTO lists (name)
    SELECT DISTINCT COALESCE(NULLIF(TRIM(list_name), ''), '${DEFAULT_LIST_NAME}')
    FROM captures;
  `);

  await db.execute(`
    INSERT OR IGNORE INTO agent_jobs (capture_id)
    SELECT id
    FROM captures;
  `);

  await migrateSensitiveSettingsFromSqlite();
}

export async function insertCapture(params: {
  id: string;
  content: string;
  tag?: CaptureTag;
  lane?: CaptureLane;
  listName?: string;
  destinations?: CaptureDestinations;
  reminderTime?: string | null;
  recurrenceRule?: string | null;
  routingSource?: string | null;
  routingReason?: string | null;
}): Promise<void> {
  const db = await getDatabase();
  const lane = normalizeLane(params.lane);
  const normalizedListName = await ensureManagedList(
    db,
    resolveListForLane(params.listName ?? DEFAULT_LIST_NAME, lane),
  );
  const destinations = params.destinations ?? {
    slack: false,
    discord: false,
    notion: false,
    googleTasks: false,
    googleCalendar: false,
    appleReminders: false,
    reminders: false,
    appleCalendar: false,
  };
  await db.execute(
    `
      INSERT INTO captures (
        id,
        content,
        tag,
        capture_lane,
        list_name,
        target_slack,
        target_discord,
        target_notion,
        target_google_tasks,
        target_google_calendar,
        target_apple_reminders,
        target_reminders,
        reminder_time,
        recurrence_rule,
        recurrence_next_at,
        routing_source,
        routing_reason,
        target_apple_calendar
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18);
    `,
    [
      params.id,
      params.content,
      params.tag ?? "untagged",
      lane,
      normalizedListName,
      Number(destinations.slack),
      Number(destinations.discord),
      Number(destinations.notion),
      Number(destinations.googleTasks),
      Number(destinations.googleCalendar),
      Number(destinations.appleReminders),
      Number(destinations.reminders),
      params.reminderTime ?? null,
      params.recurrenceRule ?? null,
      computeRecurrenceNextAt(params.reminderTime, params.recurrenceRule),
      params.routingSource ?? null,
      params.routingReason ?? null,
      Number(destinations.appleCalendar),
    ],
  );

  await enqueueAgentJob(params.id);
}

export async function listCaptures(limit = 100): Promise<Capture[]> {
  const db = await getDatabase();
  const rows = await db.select<Capture[]>(
    `
      SELECT
        ${CAPTURE_SELECT_FIELDS}
      FROM captures
      LEFT JOIN agent_jobs ON agent_jobs.capture_id = captures.id
      ORDER BY captures.created_at DESC
      LIMIT $1;
    `,
    [limit],
  );
  return rows;
}

/** SQLite date modifier for a local day relative to today, e.g. "-1 days". */
function dayModifier(dayOffset: number): string {
  return `${dayOffset >= 0 ? "+" : ""}${Math.trunc(dayOffset)} days`;
}

/** Captures made on a local day (0 today, -1 yesterday), newest first. `created_at` is stored in UTC. */
export async function listCapturesCreatedOn(dayOffset: number, limit = 50): Promise<Capture[]> {
  const db = await getDatabase();
  return db.select<Capture[]>(
    `
      SELECT
        ${CAPTURE_SELECT_FIELDS}
      FROM captures
      LEFT JOIN agent_jobs ON agent_jobs.capture_id = captures.id
      WHERE DATE(captures.created_at, 'localtime') = DATE('now', 'localtime', $1)
      ORDER BY captures.created_at DESC
      LIMIT $2;
    `,
    [dayModifier(dayOffset), limit],
  );
}

/** Today's captures (local day), newest first. */
export function listCapturesToday(limit = 50): Promise<Capture[]> {
  return listCapturesCreatedOn(0, limit);
}

/**
 * Captures that may be due on a local day: a reminder_time on that day
 * (stored as a local ISO string, so no zone conversion), plus every repeating
 * reminder, whose occurrences the caller works out.
 */
export async function listDueCandidatesOn(dayOffset: number, limit = 100): Promise<Capture[]> {
  const db = await getDatabase();
  return db.select<Capture[]>(
    `
      SELECT
        ${CAPTURE_SELECT_FIELDS}
      FROM captures
      LEFT JOIN agent_jobs ON agent_jobs.capture_id = captures.id
      WHERE (reminder_time IS NOT NULL AND DATE(reminder_time) = DATE('now', 'localtime', $1))
        OR (recurrence_rule IS NOT NULL AND recurrence_next_at IS NOT NULL)
      ORDER BY reminder_time ASC
      LIMIT $2;
    `,
    [dayModifier(dayOffset), limit],
  );
}

export async function getCaptureById(id: string): Promise<Capture | null> {
  const db = await getDatabase();
  const rows = await db.select<Capture[]>(
    `
      SELECT
        ${CAPTURE_SELECT_FIELDS}
      FROM captures
      LEFT JOIN agent_jobs ON agent_jobs.capture_id = captures.id
      WHERE captures.id = $1
      LIMIT 1;
    `,
    [id],
  );
  return rows[0] ?? null;
}

export async function getCapturesTodayCount(): Promise<number> {
  const db = await getDatabase();
  const rows = await db.select<Array<{ count: number | string }>>(
    `
      SELECT COUNT(*) as count
      FROM captures
      WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime');
    `,
  );
  const value = rows[0]?.count ?? 0;
  return typeof value === "string" ? Number(value) : value;
}

export async function getSetting(key: string): Promise<string | null> {
  if (!isSensitiveSettingKey(key)) {
    return getSqliteSettingValue(key);
  }

  const secureValue = await getSecureSettingValue(key);
  if (secureValue !== null) {
    return secureValue;
  }

  // Backward-compatible migration path for users who had sensitive keys in SQLite.
  const sqliteValue = await getSqliteSettingValue(key);
  if (sqliteValue !== null) {
    await setSecureSettingValue(key, sqliteValue);
    await deleteSqliteSettingValue(key);
  }
  return sqliteValue;
}

export async function getSettings(keys: string[]): Promise<Record<string, string | null>> {
  if (keys.length === 0) {
    return {};
  }

  const entries = await Promise.all(
    keys.map(async (key) => {
      const value = await getSetting(key);
      return [key, value] as const;
    }),
  );

  return Object.fromEntries(entries);
}

export async function setSetting(key: string, value: string): Promise<void> {
  if (isSensitiveSettingKey(key)) {
    await setSecureSettingValue(key, value);
    await deleteSqliteSettingValue(key);
    return;
  }

  const db = await getDatabase();
  await db.execute(
    `
      INSERT INTO settings (key, value)
      VALUES ($1, $2)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value;
    `,
    [key, value],
  );
}

export async function updateCaptureSyncStatus(
  id: string,
  updates: Partial<{
    synced_slack: number;
    synced_discord: number;
    synced_google_tasks: number;
    synced_google_calendar: number;
    synced_notion: number;
    synced_apple_reminders: number;
    synced_reminders: number;
    synced_apple_calendar: number;
  }>,
): Promise<void> {
  const entries = Object.entries(updates).filter(([, value]) => typeof value === "number");
  if (entries.length === 0) {
    return;
  }

  const db = await getDatabase();
  const assignments = entries.map(([key], index) => `${key} = $${index + 1}`).join(", ");

  await db.execute(
    `
      UPDATE captures
      SET ${assignments}
      WHERE id = $${entries.length + 1};
    `,
    [...entries.map(([, value]) => value), id],
  );
}

export async function setCaptureSyncError(id: string, error: string | null): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `
      UPDATE captures
      SET last_sync_error = $1
      WHERE id = $2;
    `,
    [error, id],
  );
}

export async function getTotalCaptureCount(): Promise<number> {
  const db = await getDatabase();
  const rows = await db.select<Array<{ total: number }>>(
    `SELECT COUNT(*) AS total FROM captures;`,
  );
  return rows[0]?.total ?? 0;
}

/** Remember where a capture landed. A later sync to the same app replaces the old link. */
export async function saveCaptureLinks(captureId: string, links: CaptureLink[]): Promise<void> {
  if (links.length === 0) return;
  const db = await getDatabase();
  for (const link of links) {
    await db.execute(
      `
        INSERT OR REPLACE INTO capture_links (capture_id, destination, external_id, kind)
        VALUES ($1, $2, $3, $4);
      `,
      [captureId, link.destination, link.externalId, link.kind ?? null],
    );
  }
}

export async function getCaptureLinks(captureId: string): Promise<CaptureLink[]> {
  const db = await getDatabase();
  const rows = await db.select<Array<{ destination: LinkDestination; external_id: string; kind: string | null }>>(
    `
      SELECT destination, external_id, kind
      FROM capture_links
      WHERE capture_id = $1;
    `,
    [captureId],
  );
  return rows.map((row) => ({ destination: row.destination, externalId: row.external_id, kind: row.kind }));
}

/** Links for many captures at once, keyed by capture id. */
export async function getCaptureLinksFor(captureIds: string[]): Promise<Map<string, CaptureLink[]>> {
  const byCapture = new Map<string, CaptureLink[]>();
  if (captureIds.length === 0) return byCapture;
  const db = await getDatabase();
  const placeholders = captureIds.map((_, index) => `$${index + 1}`).join(", ");
  const rows = await db.select<
    Array<{ capture_id: string; destination: LinkDestination; external_id: string; kind: string | null }>
  >(
    `
      SELECT capture_id, destination, external_id, kind
      FROM capture_links
      WHERE capture_id IN (${placeholders});
    `,
    captureIds,
  );
  for (const row of rows) {
    const links = byCapture.get(row.capture_id) ?? [];
    links.push({ destination: row.destination, externalId: row.external_id, kind: row.kind });
    byCapture.set(row.capture_id, links);
  }
  return byCapture;
}

/** Replace a capture's text (an addition merged in before it was sent anywhere). */
export async function setCaptureContent(id: string, content: string): Promise<void> {
  const db = await getDatabase();
  await db.execute(`UPDATE captures SET content = $1 WHERE id = $2;`, [content, id]);
}

/** Attempts before an addition stops retrying on its own. */
export const APPEND_MAX_ATTEMPTS = 3;

export interface CaptureAppend {
  id: string;
  captureId: string;
  destination: SyncDestination;
  content: string;
  attempts: number;
  error: string | null;
}

/** Queue an addition for each app the capture already landed in. */
export async function enqueueCaptureAppends(
  captureId: string,
  destinations: SyncDestination[],
  content: string,
): Promise<void> {
  const db = await getDatabase();
  for (const destination of destinations) {
    await db.execute(
      `
        INSERT INTO capture_appends (id, capture_id, destination, content)
        VALUES ($1, $2, $3, $4);
      `,
      [crypto.randomUUID(), captureId, destination, content],
    );
  }
}

/** Additions still to send, oldest first, so they land in the order typed. */
export async function listPendingAppends(limit = 50): Promise<CaptureAppend[]> {
  const db = await getDatabase();
  const rows = await db.select<
    Array<{
      id: string;
      capture_id: string;
      destination: SyncDestination;
      content: string;
      attempts: number;
      error: string | null;
    }>
  >(
    `
      SELECT id, capture_id, destination, content, attempts, error
      FROM capture_appends
      WHERE done = 0 AND attempts < $1
      ORDER BY created_at ASC, rowid ASC
      LIMIT $2;
    `,
    [APPEND_MAX_ATTEMPTS, limit],
  );
  return rows.map((row) => ({
    id: row.id,
    captureId: row.capture_id,
    destination: row.destination,
    content: row.content,
    attempts: row.attempts,
    error: row.error,
  }));
}

/** Whether this exact addition is already queued (or sent) for this app. */
export async function hasCaptureAppend(
  captureId: string,
  destination: SyncDestination,
  content: string,
): Promise<boolean> {
  const db = await getDatabase();
  const rows = await db.select<Array<{ id: string }>>(
    `
      SELECT id FROM capture_appends
      WHERE capture_id = $1 AND destination = $2 AND content = $3
      LIMIT 1;
    `,
    [captureId, destination, content],
  );
  return rows.length > 0;
}

export async function markAppendDone(id: string): Promise<void> {
  const db = await getDatabase();
  await db.execute(`UPDATE capture_appends SET done = 1, error = NULL WHERE id = $1;`, [id]);
}

export async function markAppendFailed(id: string, error: string): Promise<void> {
  const db = await getDatabase();
  await db.execute(`UPDATE capture_appends SET attempts = attempts + 1, error = $1 WHERE id = $2;`, [
    error.slice(0, 500),
    id,
  ]);
}

/** Give a capture's unsent additions a fresh set of attempts (Landed's Retry). */
export async function retryCaptureAppends(captureId: string): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `UPDATE capture_appends SET attempts = 0, error = NULL WHERE capture_id = $1 AND done = 0;`,
    [captureId],
  );
}

export interface AppendState {
  /** Additions not sent yet. */
  pending: number;
  /** The latest error among them, if any ("<Label>: <error>"). */
  error: string | null;
}

/** Unsent additions for many captures at once, keyed by capture id. */
export async function getAppendStatesFor(captureIds: string[]): Promise<Map<string, AppendState>> {
  const states = new Map<string, AppendState>();
  if (captureIds.length === 0) return states;
  const db = await getDatabase();
  const placeholders = captureIds.map((_, index) => `$${index + 1}`).join(", ");
  const rows = await db.select<Array<{ capture_id: string; error: string | null }>>(
    `
      SELECT capture_id, error
      FROM capture_appends
      WHERE done = 0 AND capture_id IN (${placeholders})
      ORDER BY created_at ASC, rowid ASC;
    `,
    captureIds,
  );
  for (const row of rows) {
    const state = states.get(row.capture_id) ?? { pending: 0, error: null };
    state.pending += 1;
    state.error = row.error ?? state.error;
    states.set(row.capture_id, state);
  }
  return states;
}

/** Hard-delete a capture (used by undo). SQLite FK cascade is off by default,
 * so the agent job, link and addition rows are removed explicitly. */
export async function deleteCapture(id: string): Promise<void> {
  const db = await getDatabase();
  await db.execute(`DELETE FROM agent_jobs WHERE capture_id = $1;`, [id]);
  await db.execute(`DELETE FROM capture_links WHERE capture_id = $1;`, [id]);
  await db.execute(`DELETE FROM capture_appends WHERE capture_id = $1;`, [id]);
  await db.execute(`DELETE FROM captures WHERE id = $1;`, [id]);
}

export interface DailyRecapStats {
  yesterdayCount: number;
  dueTodayCount: number;
}

/**
 * Stats for the once-a-day recap strip in the capture window.
 * created_at is stored in UTC (CURRENT_TIMESTAMP); reminder_time is stored
 * as a local ISO string, so only created_at needs the localtime conversion.
 */
export async function getDailyRecapStats(): Promise<DailyRecapStats> {
  const db = await getDatabase();
  const rows = await db.select<Array<{ yesterday_count: number; due_today_count: number }>>(
    `
      SELECT
        (
          SELECT COUNT(*) FROM captures
          WHERE date(created_at, 'localtime') = date('now', 'localtime', '-1 day')
        ) AS yesterday_count,
        (
          SELECT COUNT(*) FROM captures
          WHERE reminder_time IS NOT NULL
            AND date(reminder_time) = date('now', 'localtime')
        ) AS due_today_count;
    `,
  );
  const row = rows[0];
  return {
    yesterdayCount: row?.yesterday_count ?? 0,
    dueTodayCount: row?.due_today_count ?? 0,
  };
}

interface RoutingRuleRow {
  id: string;
  field: string;
  match_value: string;
  destinations: string;
  created_at: string;
  hit_count: number;
}

const EMPTY_RULE_DESTINATIONS: CaptureDestinations = {
  slack: false,
  discord: false,
  notion: false,
  googleTasks: false,
  googleCalendar: false,
  appleReminders: false,
  reminders: false,
  appleCalendar: false,
};

function parseRuleDestinations(raw: string): CaptureDestinations {
  try {
    const parsed = JSON.parse(raw) as Partial<CaptureDestinations>;
    return { ...EMPTY_RULE_DESTINATIONS, ...parsed };
  } catch {
    return { ...EMPTY_RULE_DESTINATIONS };
  }
}

export async function listRoutingRules(): Promise<RoutingRule[]> {
  const db = await getDatabase();
  const rows = await db.select<RoutingRuleRow[]>(
    `
      SELECT id, field, match_value, destinations, created_at, hit_count
      FROM routing_rules
      ORDER BY created_at DESC;
    `,
  );
  return rows.map((row) => ({
    id: row.id,
    field: row.field as RoutingRuleField,
    match_value: row.match_value,
    destinations: parseRuleDestinations(row.destinations),
    created_at: row.created_at,
    hit_count: row.hit_count,
  }));
}

export async function createRoutingRule(params: {
  field: RoutingRuleField;
  matchValue: string;
  destinations: CaptureDestinations;
}): Promise<string> {
  const db = await getDatabase();
  const id = crypto.randomUUID();
  // One rule per condition: re-teaching the same tag/list/keyword replaces the
  // old answer instead of stacking a stale rule above the new one.
  await db.execute(
    `
      DELETE FROM routing_rules
      WHERE field = $1 AND match_value = $2 COLLATE NOCASE;
    `,
    [params.field, params.matchValue.trim()],
  );
  await db.execute(
    `
      INSERT INTO routing_rules (id, field, match_value, destinations)
      VALUES ($1, $2, $3, $4);
    `,
    [id, params.field, params.matchValue.trim(), JSON.stringify(params.destinations)],
  );
  return id;
}

export async function deleteRoutingRule(id: string): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `
      DELETE FROM routing_rules
      WHERE id = $1;
    `,
    [id],
  );
}

export async function recordRoutingRuleHit(id: string): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `
      UPDATE routing_rules
      SET hit_count = hit_count + 1
      WHERE id = $1;
    `,
    [id],
  );
}

export async function listDueRecurringReminderCaptures(nowIso: string, limit = 25): Promise<Capture[]> {
  const db = await getDatabase();
  const rows = await db.select<Capture[]>(
    `
      SELECT
        ${CAPTURE_SELECT_FIELDS}
      FROM captures
      LEFT JOIN agent_jobs ON agent_jobs.capture_id = captures.id
      WHERE recurrence_rule IS NOT NULL
        AND recurrence_next_at IS NOT NULL
        AND recurrence_next_at <= $1
        AND target_reminders = 1
        AND synced_reminders = 1
      ORDER BY recurrence_next_at ASC
      LIMIT $2;
    `,
    [nowIso, limit],
  );
  return rows;
}

export async function setCaptureRecurrenceNextAt(
  captureId: string,
  nextAt: string | null,
): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `
      UPDATE captures
      SET recurrence_next_at = $1
      WHERE id = $2;
    `,
    [nextAt, captureId],
  );
}

export async function clearCaptureRecurrence(captureId: string): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `
      UPDATE captures
      SET recurrence_rule = NULL,
          recurrence_next_at = NULL
      WHERE id = $1;
    `,
    [captureId],
  );
}

export async function updateCapture(params: {
  id: string;
  content: string;
  tag: CaptureTag;
  lane: CaptureLane;
  listName: string;
  destinations: CaptureDestinations;
  reminderTime: string | null;
  recurrenceRule?: string | null;
}): Promise<void> {
  const db = await getDatabase();
  const lane = normalizeLane(params.lane);
  const normalizedListName = await ensureManagedList(db, resolveListForLane(params.listName, lane));
  await db.execute(
    `
      UPDATE captures
      SET
        content = $1,
        tag = $2,
        capture_lane = $3,
        list_name = $4,
        target_slack = $5,
        target_discord = $6,
        target_notion = $7,
        target_google_tasks = $8,
        target_google_calendar = $9,
        target_apple_reminders = $10,
        target_reminders = $11,
        reminder_time = $12,
        recurrence_rule = $13,
        recurrence_next_at = $14,
        target_apple_calendar = $15,
        -- Preserve already-synced destinations on edit so fixing a typo does not
        -- re-post everywhere. A still-targeted destination keeps its prior synced
        -- state (unsent stays unsent and will sync; already-sent stays sent).
        -- A de-targeted destination is marked done so it is skipped.
        synced_slack = CASE WHEN $5 = 1 THEN synced_slack ELSE 1 END,
        synced_discord = CASE WHEN $6 = 1 THEN synced_discord ELSE 1 END,
        synced_notion = CASE WHEN $7 = 1 THEN synced_notion ELSE 1 END,
        synced_google_tasks = CASE WHEN $8 = 1 THEN synced_google_tasks ELSE 1 END,
        synced_google_calendar = CASE WHEN $9 = 1 THEN synced_google_calendar ELSE 1 END,
        synced_apple_reminders = CASE WHEN $10 = 1 THEN synced_apple_reminders ELSE 1 END,
        synced_reminders = CASE WHEN $11 = 1 THEN synced_reminders ELSE 1 END,
        synced_apple_calendar = CASE WHEN $15 = 1 THEN synced_apple_calendar ELSE 1 END
      WHERE id = $16;
    `,
    [
      params.content,
      params.tag,
      lane,
      normalizedListName,
      Number(params.destinations.slack),
      Number(params.destinations.discord),
      Number(params.destinations.notion),
      Number(params.destinations.googleTasks),
      Number(params.destinations.googleCalendar),
      Number(params.destinations.appleReminders),
      Number(params.destinations.reminders),
      params.reminderTime,
      params.recurrenceRule ?? null,
      computeRecurrenceNextAt(params.reminderTime, params.recurrenceRule),
      Number(params.destinations.appleCalendar),
      params.id,
    ],
  );

  await enqueueAgentJob(params.id);
}

export async function enqueueAgentJob(captureId: string): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `
      INSERT INTO agent_jobs (
        capture_id,
        status,
        attempts,
        intent,
        confidence,
        action_json,
        needs_review,
        error,
        updated_at
      )
      VALUES ($1, 'pending', 0, NULL, NULL, NULL, 0, NULL, CURRENT_TIMESTAMP)
      ON CONFLICT(capture_id) DO UPDATE SET
        status = 'pending',
        attempts = 0,
        intent = NULL,
        confidence = NULL,
        action_json = NULL,
        needs_review = 0,
        error = NULL,
        updated_at = CURRENT_TIMESTAMP;
    `,
    [captureId],
  );
}

export async function listPendingAgentCaptures(limit = 25): Promise<Capture[]> {
  const db = await getDatabase();
  const rows = await db.select<Capture[]>(
    `
      SELECT
        ${CAPTURE_SELECT_FIELDS}
      FROM captures
      INNER JOIN agent_jobs ON agent_jobs.capture_id = captures.id
      WHERE agent_jobs.status IN ('pending', 'retry')
      ORDER BY agent_jobs.updated_at ASC, captures.created_at ASC
      LIMIT $1;
    `,
    [limit],
  );
  return rows;
}

export async function updateAgentJob(
  captureId: string,
  updates: Partial<{
    status: string;
    attempts: number;
    intent: string | null;
    confidence: number | null;
    actionJson: string | null;
    needsReview: number;
    error: string | null;
  }>,
): Promise<void> {
  const db = await getDatabase();

  await db.execute(
    `
      INSERT OR IGNORE INTO agent_jobs (capture_id)
      VALUES ($1);
    `,
    [captureId],
  );

  const fields: Array<[string, unknown]> = [];
  if (updates.status !== undefined) fields.push(["status", updates.status]);
  if (updates.attempts !== undefined) fields.push(["attempts", updates.attempts]);
  if (updates.intent !== undefined) fields.push(["intent", updates.intent]);
  if (updates.confidence !== undefined) fields.push(["confidence", updates.confidence]);
  if (updates.actionJson !== undefined) fields.push(["action_json", updates.actionJson]);
  if (updates.needsReview !== undefined) fields.push(["needs_review", updates.needsReview]);
  if (updates.error !== undefined) fields.push(["error", updates.error]);

  if (fields.length === 0) {
    return;
  }

  const assignments = fields.map(([key], index) => `${key} = $${index + 1}`).join(", ");
  await db.execute(
    `
      UPDATE agent_jobs
      SET ${assignments}, updated_at = CURRENT_TIMESTAMP
      WHERE capture_id = $${fields.length + 1};
    `,
    [...fields.map(([, value]) => value), captureId],
  );
}

export async function setCaptureReminder(
  captureId: string,
  reminderTime: string | null,
): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `
      UPDATE captures
      SET reminder_time = $1
      WHERE id = $2;
    `,
    [reminderTime, captureId],
  );
}

export async function setCaptureListName(captureId: string, listName: string): Promise<void> {
  const db = await getDatabase();
  const normalizedListName = await ensureManagedList(db, normalizeListName(listName));
  await db.execute(
    `
      UPDATE captures
      SET list_name = $1
      WHERE id = $2;
    `,
    [normalizedListName, captureId],
  );
}

export async function listManagedLists(): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.select<Array<{ name: string }>>(
    `
      SELECT name
      FROM lists
      ORDER BY
        CASE WHEN LOWER(name) = LOWER($1) THEN 0 ELSE 1 END,
        name COLLATE NOCASE ASC;
    `,
    [DEFAULT_LIST_NAME],
  );
  return rows.map((row) => normalizeListName(row.name));
}

export async function createManagedList(name: string): Promise<string> {
  const db = await getDatabase();
  return ensureManagedList(db, name);
}

export async function renameManagedList(currentName: string, nextName: string): Promise<string> {
  if (isDefaultListName(currentName)) {
    throw new Error("Inbox cannot be renamed.");
  }

  const current = normalizeListName(currentName);
  const next = normalizeListName(nextName);
  const db = await getDatabase();

  await db.execute(
    `
      UPDATE captures
      SET list_name = $1
      WHERE LOWER(COALESCE(NULLIF(TRIM(list_name), ''), $2)) = LOWER($3);
    `,
    [next, DEFAULT_LIST_NAME, current],
  );

  await db.execute(
    `
      DELETE FROM lists
      WHERE LOWER(name) = LOWER($1);
    `,
    [current],
  );

  await ensureManagedList(db, next);
  await ensureManagedList(db, DEFAULT_LIST_NAME);

  return next;
}

export async function deleteManagedList(name: string): Promise<void> {
  if (isDefaultListName(name)) {
    throw new Error("Inbox cannot be deleted.");
  }

  const normalized = normalizeListName(name);
  const db = await getDatabase();

  await db.execute(
    `
      UPDATE captures
      SET list_name = $1
      WHERE LOWER(COALESCE(NULLIF(TRIM(list_name), ''), $2)) = LOWER($3);
    `,
    [DEFAULT_LIST_NAME, DEFAULT_LIST_NAME, normalized],
  );

  await db.execute(
    `
      DELETE FROM lists
      WHERE LOWER(name) = LOWER($1);
    `,
    [normalized],
  );

  await ensureManagedList(db, DEFAULT_LIST_NAME);
}
