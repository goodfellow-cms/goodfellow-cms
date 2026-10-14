import { PROVIDER_IDS, PROVIDERS, type ProviderId, type ProviderSettings } from "@goodfellow-cms/ai";
import { credentialStorage, type StorageLike } from "@goodfellow-cms/core";
import { useCallback, useState } from "react";

const PREFERENCES_KEY = "goodfellow.ai";
const keyStorage = (provider: ProviderId) => credentialStorage(`goodfellow.ai.key.${provider}`);

/** What an editor chose, saved in their browser. Keys are saved separately, only where the editor chose. */
interface Preferences {
  provider?: ProviderId;
  models?: Partial<Record<ProviderId, string>>;
  baseUrl?: string;
  /** Whether the AI may find photos on Openverse; on unless turned off. */
  stockPhotos?: boolean;
}

function localStorageOrNull(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function loadPreferences(): Preferences {
  try {
    const saved = localStorageOrNull()?.getItem(PREFERENCES_KEY);
    return saved ? (JSON.parse(saved) as Preferences) : {};
  } catch {
    return {};
  }
}

function savePreferences(preferences: Preferences): void {
  try {
    localStorageOrNull()?.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Storage can be full or blocked; the choice just won't be remembered.
  }
}

/** Removes every saved AI key from this browser, such as when the editor signs out. */
export function forgetAiKeys(): void {
  for (const provider of PROVIDER_IDS) keyStorage(provider).clear();
}

/** The services a site offers, in the order they're listed, with Claude first by default. */
export function allowedProviders(ids: string[] | undefined): ProviderId[] {
  const allowed = PROVIDER_IDS.filter((id) => !ids || ids.includes(id));
  return allowed.length > 0 ? allowed : ["manual"];
}

export interface AiSettingsState extends ProviderSettings {
  remember: boolean;
}

/** The editor's AI service, model and key, remembered between visits as they chose. */
export function useAiSettings(providers: ProviderId[]) {
  const [state, setState] = useState<AiSettingsState>(() => {
    const preferences = loadPreferences();
    const provider =
      preferences.provider && providers.includes(preferences.provider)
        ? preferences.provider
        : (providers[0] as ProviderId);
    const storage = keyStorage(provider);
    return {
      provider,
      model: preferences.models?.[provider] ?? PROVIDERS[provider].models?.[0] ?? "",
      apiKey: storage.load() ?? undefined,
      baseUrl: preferences.baseUrl,
      remember: storage.remembered(),
    };
  });

  const update = useCallback((changes: Partial<AiSettingsState>) => {
    setState((current) => {
      const switching = changes.provider !== undefined && changes.provider !== current.provider;
      const provider = changes.provider ?? current.provider;
      const preferences = loadPreferences();
      let next: AiSettingsState = { ...current, ...changes };

      if (switching) {
        const storage = keyStorage(provider);
        next = {
          ...next,
          apiKey: storage.load() ?? undefined,
          remember: storage.remembered(),
          model: changes.model ?? preferences.models?.[provider] ?? PROVIDERS[provider].models?.[0] ?? "",
        };
      } else if ("apiKey" in changes || "remember" in changes) {
        const storage = keyStorage(provider);
        if (next.apiKey) storage.save(next.apiKey, next.remember);
        else storage.clear();
      }

      savePreferences({
        ...preferences,
        provider,
        models: { ...preferences.models, [provider]: next.model },
        baseUrl: next.baseUrl,
      });
      return next;
    });
  }, []);

  return [state, update] as const;
}

/** Whether the editor lets the AI find openly licensed photos, remembered in this browser. On at first. */
export function useStockPhotoChoice() {
  const [on, setOn] = useState(() => loadPreferences().stockPhotos !== false);
  const update = useCallback((next: boolean) => {
    setOn(next);
    savePreferences({ ...loadPreferences(), stockPhotos: next });
  }, []);
  return [on, update] as const;
}
