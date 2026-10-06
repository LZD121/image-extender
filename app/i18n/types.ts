// app/i18n/types.ts
/**
 * Types shared by the registry and the message modules.
 *
 * Kept out of `./index.ts` because the message modules annotate themselves with
 * `Namespace`: with the type living in the registry, every message module
 * imported the registry that imports it — a type-only cycle in the component
 * graph (harmless at runtime, erased by the compiler, but the app's only one).
 */

/** One message module: the same keys in every locale. */
export type Namespace = {
  en: Record<string, string>
  zh: Record<string, string>
}
