import {
  BatteryCharging, Bell, Compass, Footprints, MapPin, MessageSquare, Monitor, MousePointerClick,
  Phone, Smartphone, Sun, type LucideIcon,
} from 'lucide-react'

// One catalogue of sensors, their data tables and their defaults. Used by the
// new-study wizard, Settings → Sensors, Data → Raw and the overview.

export type SensorKey =
  | 'app_usage' | 'notifications' | 'calls' | 'sms' | 'screen_state' | 'gestures'
  | 'location' | 'battery' | 'light' | 'steps' | 'proximity'

export interface SensorInfo {
  key: SensorKey
  label: string
  description: string
  icon: LucideIcon
  /** Sampled on a timer (true) or recorded when something happens (false) */
  hasInterval: boolean
  category: 'phone use' | 'environment'
  /** Default interval in seconds for timed sensors */
  defaultInterval?: number
  table: string
  /** Column holding the event time in the data table */
  timeCol: string
}

export const SENSORS: SensorInfo[] = [
  { key: 'app_usage', label: 'App usage', description: 'Which apps are used, with start and end times.', icon: Smartphone, hasInterval: false, category: 'phone use', table: 'data_app_usage', timeCol: 'start_time' },
  { key: 'notifications', label: 'Notifications', description: 'Which app posted a notification and when it was opened or dismissed. Titles and content are never stored.', icon: Bell, hasInterval: false, category: 'phone use', table: 'data_notifications', timeCol: 'posted_at' },
  { key: 'calls', label: 'Calls', description: 'Incoming, outgoing and missed calls with duration, from the phone and optionally other apps. Phone numbers are hashed.', icon: Phone, hasInterval: false, category: 'phone use', table: 'data_calls', timeCol: 'event_time' },
  { key: 'sms', label: 'SMS', description: 'Sent and received messages with time. Numbers are hashed; message text is never read.', icon: MessageSquare, hasInterval: false, category: 'phone use', table: 'data_sms', timeCol: 'event_time' },
  { key: 'screen_state', label: 'Screen state', description: 'Screen on, off, locked and unlocked.', icon: Monitor, hasInterval: false, category: 'phone use', table: 'data_screen_state', timeCol: 'recorded_at' },
  { key: 'gestures', label: 'Gestures', description: 'Taps, scrolls and swipes between posts or videos. Reads screen layout only, never text.', icon: MousePointerClick, hasInterval: false, category: 'phone use', table: 'data_gestures', timeCol: 'recorded_at' },
  { key: 'location', label: 'Location', description: 'GPS position on a timer, plus extra fixes when the participant moves.', icon: MapPin, hasInterval: true, category: 'environment', defaultInterval: 600, table: 'data_location', timeCol: 'recorded_at' },
  { key: 'battery', label: 'Battery', description: 'Battery level, charging state, temperature and voltage.', icon: BatteryCharging, hasInterval: true, category: 'environment', defaultInterval: 600, table: 'data_battery', timeCol: 'recorded_at' },
  { key: 'light', label: 'Ambient light', description: 'Light level in lux.', icon: Sun, hasInterval: true, category: 'environment', defaultInterval: 600, table: 'data_light', timeCol: 'recorded_at' },
  { key: 'steps', label: 'Steps', description: 'Steps taken since the last reading. Needs a phone with a step sensor.', icon: Footprints, hasInterval: true, category: 'environment', defaultInterval: 600, table: 'data_steps', timeCol: 'recorded_at' },
  { key: 'proximity', label: 'Proximity and orientation', description: 'Near/far distance and whether the phone is face up, face down or upright.', icon: Compass, hasInterval: true, category: 'environment', defaultInterval: 600, table: 'data_proximity', timeCol: 'recorded_at' },
]

export const SENSOR_BY_KEY: Record<SensorKey, SensorInfo> = Object.fromEntries(SENSORS.map(s => [s.key, s])) as Record<SensorKey, SensorInfo>

/** Every data table a researcher can browse, in display order, with labels. */
export const DATA_TABLES: { table: string; label: string; timeCol: string; sensor?: SensorKey }[] = [
  ...SENSORS.map(s => ({ table: s.table, label: s.label, timeCol: s.timeCol, sensor: s.key })),
  { table: 'data_esm_responses', label: 'Survey responses', timeCol: 'triggered_at' },
]

/** Sensor tables only (Data → Raw data). Survey responses have their own Surveys section. */
export const SENSOR_TABLES = DATA_TABLES.filter(t => t.sensor)

export function sensorLabel(key: string): string {
  return (SENSOR_BY_KEY as Record<string, SensorInfo>)[key]?.label ?? key.replace(/_/g, ' ')
}

export function tableLabel(table: string): string {
  return DATA_TABLES.find(t => t.table === table)?.label ?? table.replace(/^data_/, '').replace(/_/g, ' ')
}

// ── Gestures ─────────────────────────────────────────────────────────────────

/** Friendly names for the Android accessibility event types the gestures sensor can record. */
export const GESTURE_EVENT_LABELS: Record<string, { label: string; description: string }> = {
  TYPE_VIEW_CLICKED: { label: 'Taps', description: 'A tap on a button or item.' },
  touches: { label: 'All touches', description: "Every touch on the screen, including apps that don't report taps. No positions; nothing while the keyboard is open." },
  TYPE_VIEW_LONG_CLICKED: { label: 'Long presses', description: 'Press and hold.' },
  TYPE_VIEW_SCROLLED: { label: 'Scrolls', description: 'Scroll events from apps that report them.' },
  TYPE_WINDOW_CONTENT_CHANGED: { label: 'Screen changes', description: 'Content on screen changed. Very frequent; usually off.' },
}

/** Display names for data_gestures.interaction_type values the app itself defines. */
export const GESTURE_INTERACTION_LABELS: Record<string, string> = {
  touch: 'Touch',
  scroll: 'Feed scroll',
  page_swipe: 'Page swipe',
}

export const GESTURE_SKIP_LABELS: Record<string, string> = {
  skip_system_ui: 'Ignore system UI (status bar, navigation)',
  skip_launchers: 'Ignore the home screen launcher',
  skip_keyboards: 'Ignore keyboards',
  skip_system_settings: 'Ignore the Settings app',
}

export const GESTURE_DEFAULTS = {
  interaction_types: {
    TYPE_VIEW_SCROLLED: true,
    TYPE_VIEW_CLICKED: true,
    // Not an accessibility event type: one row (interaction_type 'touch') per
    // touch-down. When the key is absent the app follows TYPE_VIEW_CLICKED.
    touches: true,
    TYPE_VIEW_LONG_CLICKED: true,
    TYPE_WINDOW_CONTENT_CHANGED: false,
  },
  skip_rules: {
    skip_system_ui: true,
    skip_launchers: true,
    skip_keyboards: true,
    skip_system_settings: true,
  },
}

/** Apps where feed scrolling and reel swipes are tracked by default ("*" = every app). */
export const DEFAULT_SCROLL_APPS = [
  'com.instagram.android',
  'com.instagram.barcelona',
  'com.facebook.katana',
  'com.facebook.lite',
  'com.google.android.youtube',
  'com.zhiliaoapp.musically',
  'com.ss.android.ugc.trill',
  'com.snapchat.android',
  'com.twitter.android',
  'com.reddit.frontpage',
  'com.pinterest',
  'com.linkedin.android',
  'com.whatsapp',
]

// ── Calls ────────────────────────────────────────────────────────────────────

/** sensor_configs.config options for calls. Missing keys mean "on" (the app's default). */
export const CALL_OPTION_LABELS: Record<'include_app_calls' | 'detect_video', { label: string; description?: string }> = {
  include_app_calls: {
    label: 'Calls in other apps',
    description: 'WhatsApp, Botim, Instagram, Zoom and any other app. App, direction, answered or not, audio or video, times. Never who or what is said.',
  },
  detect_video: { label: 'Detect video calls' },
}

export const CALL_DEFAULTS = {
  include_app_calls: true,
  detect_video: true,
}

/** Friendly names for data_calls.source (the phone, or the package of the calling app). */
export const CALL_SOURCE_LABELS: Record<string, string> = {
  phone: 'Phone',
  'com.whatsapp': 'WhatsApp',
  'com.whatsapp.w4b': 'WhatsApp Business',
  'im.thebot.messenger': 'Botim',
  'com.instagram.android': 'Instagram',
  'com.facebook.orca': 'Messenger',
  'org.telegram.messenger': 'Telegram',
  'org.thoughtcrime.securesms': 'Signal',
  'us.zoom.videomeetings': 'Zoom',
  'com.google.android.apps.tachyon': 'Meet',
  'com.microsoft.teams': 'Teams',
  'com.skype.raider': 'Skype',
  'com.viber.voip': 'Viber',
  'com.snapchat.android': 'Snapchat',
}

/** Display name for a call source; unknown packages are shown as-is. Null = an older row from the phone dialler. */
export function callSourceLabel(source: string | null | undefined): string {
  if (source == null || source === '') return 'Phone'
  return CALL_SOURCE_LABELS[source] ?? source
}

/** Banking apps where gesture collection pauses by default. */
export const DEFAULT_BANKING_APPS = [
  'uk.co.hsbc.hsbcukmobilebanking',
  'com.barclays.android.barclaysmobilebanking',
  'com.htsu.hsbcpersonalbanking',
  'com.monzo.android',
  'com.starlingbank.android',
  'com.revolut.app',
]

export const DEFAULT_MOVEMENT_THRESHOLD = 50

// ── Permissions reported by the app ─────────────────────────────────────────

const PERMISSION_LABELS: Record<string, string> = {
  accessibility: 'Gestures (accessibility)',
  accessibility_running: 'Gestures running',
  accessibility_window_content: 'Gestures layout access',
  usage_access: 'Usage access',
  usage_stats: 'Usage access',
  notification_listener: 'Notification access',
  location: 'Location',
  location_fine: 'Location (precise)',
  location_background: 'Location (all the time)',
  activity_recognition: 'Physical activity',
  post_notifications: 'Notifications',
  exact_alarm: 'Exact survey timing',
  battery_optimization_exempt: 'Battery optimisation off',
  call_log: 'Call log',
  sms: 'SMS',
}

export function permissionLabel(key: string): string {
  return PERMISSION_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
