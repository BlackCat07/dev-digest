/**
 * Last line of defence for AC-40: no secret value reaches standard output,
 * standard error, the written result or the posted review.
 *
 * The runner never prints a secret deliberately — the token lives in one HTTP
 * header and the model key inside the provider. What this guards is the
 * accident: an upstream error message that quotes the request it failed on, a
 * provider that echoes a header back. Everything the runner emits goes through
 * here, so the accident has to get past a string replacement rather than past
 * somebody's care.
 */

/** Shortest value worth redacting — below this the replacement mangles ordinary text. */
const MIN_SECRET_LENGTH = 8;

export type Redactor = (text: string) => string;

export function makeRedactor(secrets: (string | undefined)[]): Redactor {
  const values = [...new Set(secrets.filter((s): s is string => !!s && s.length >= MIN_SECRET_LENGTH))]
    // Longest first: a secret that contains another must be masked whole.
    .sort((a, b) => b.length - a.length);
  if (values.length === 0) return (text) => text;
  return (text) => {
    let out = text;
    for (const v of values) out = out.split(v).join('***');
    return out;
  };
}
