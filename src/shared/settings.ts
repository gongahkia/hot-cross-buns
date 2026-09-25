import { z } from "zod";
import { hcbResultSchema } from "./result";

export const colorSchemePreferenceSchema = z.enum(["system", "dark", "light"]);
export type ColorSchemePreference = z.infer<typeof colorSchemePreferenceSchema>;

export const settingsStartPageSchema = z.enum(["today", "tasks", "calendar", "notes"]);
export type SettingsStartPage = z.infer<typeof settingsStartPageSchema>;

export const appSettingsSchema = z
  .object({
    colorScheme: colorSchemePreferenceSchema,
    startPage: settingsStartPageSchema
  })
  .strict();

export type AppSettings = z.infer<typeof appSettingsSchema>;

export const defaultAppSettings: AppSettings = {
  colorScheme: "system",
  startPage: "today"
};

export const persistedAppSettingsSchema = appSettingsSchema
  .extend({
    schemaVersion: z.literal(1)
  })
  .strict();

export type PersistedAppSettings = z.infer<typeof persistedAppSettingsSchema>;

export const settingsDataInfoSchema = z
  .object({
    settingsFile: z.string().min(1),
    plannerFile: z.string().min(1)
  })
  .strict();

export type SettingsDataInfo = z.infer<typeof settingsDataInfoSchema>;

export const settingsGetRequestSchema = z.object({}).strict();
export const settingsSaveRequestSchema = appSettingsSchema;
export const settingsDataInfoRequestSchema = z.object({}).strict();

export const settingsGetResultSchema = hcbResultSchema(appSettingsSchema);
export const settingsSaveResultSchema = hcbResultSchema(appSettingsSchema);
export const settingsDataInfoResultSchema = hcbResultSchema(settingsDataInfoSchema);
