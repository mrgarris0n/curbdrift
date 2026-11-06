// The available themes. A theme owns every user-visible word and the look (its stylesheet
// is scoped by [data-theme="<id>"]); data and scoring never change between themes.
import { municipal } from './municipal.js';
import { field } from './field.js';

export const THEMES = Object.freeze({ municipal, field });
export const DEFAULT_THEME_ID = 'municipal';

export function pickTheme(id) {
  return Object.hasOwn(THEMES, id) ? THEMES[id] : THEMES[DEFAULT_THEME_ID];
}
