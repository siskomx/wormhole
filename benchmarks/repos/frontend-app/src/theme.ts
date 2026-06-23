export const themes = ["light", "dark", "system"] as const;

export type ThemeName = (typeof themes)[number];
