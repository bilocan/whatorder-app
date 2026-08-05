export const SETTINGS_TABS = ['restaurant', 'hours', 'ordering', 'payments', 'bot'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export function parseSettingsTab(raw: string | null): SettingsTab {
  if (raw && (SETTINGS_TABS as readonly string[]).includes(raw)) return raw as SettingsTab;
  return 'restaurant';
}
