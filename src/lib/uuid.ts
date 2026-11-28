/**
 * UUID shape check for deep-link ids.
 *
 * Watch / session / playlist deep links carry a Supabase row id. A
 * malformed id (short prefix, garbage string) makes PostgREST reject
 * the query with a raw "invalid input syntax for type uuid" error —
 * and the callers surface `error.message` verbatim, so that database
 * text would reach the user. The fetchers below return `null` for a
 * non-UUID id instead, and their screens already translate `null`
 * into a friendly "could not be found" message.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
