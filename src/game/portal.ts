export type PortalId = 'none' | 'crazygames' | 'poki';
export type AdBreakType = 'midgame' | 'rewarded';
export type AdBreakStatus = 'completed' | 'skipped' | 'failed';

export interface AdBreakResult {
  status: AdBreakStatus;
  type: AdBreakType;
  adStarted: boolean;
  error?: string;
}

export interface PortalAdapter {
  readonly isPortal: boolean;
  readonly portalId: PortalId;
  init(): Promise<void>;
  loadingStart(): void;
  loadingFinished(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  requestAdBreak(type: AdBreakType): Promise<AdBreakResult>;
  happyTime(): void;
}

export const PORTAL_SDK_URLS = {
  crazygames: 'https://sdk.crazygames.com/crazygames-sdk-v3.js',
  poki: 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js',
} as const;

export const PORTAL_DOC_URLS = {
  crazygames: 'https://docs.crazygames.com/sdk/intro/',
  poki: 'https://sdk.poki.com/html5',
} as const;

const requestedPortal = import.meta.env.VITE_PORTAL;
export const PORTAL_ID: PortalId = requestedPortal === 'crazygames' || requestedPortal === 'poki'
  ? requestedPortal
  : 'none';
export const IS_PORTAL_BUILD = PORTAL_ID !== 'none';

type MaybePromise<T = void> = T | Promise<T>;

interface CrazyGamesSdk {
  init?: () => MaybePromise;
  game?: {
    loadingStart?: () => MaybePromise;
    loadingStop?: () => MaybePromise;
    gameplayStart?: () => MaybePromise;
    gameplayStop?: () => MaybePromise;
    happytime?: () => MaybePromise;
  };
  ad?: {
    requestAd?: (type: AdBreakType, callbacks?: {
      adStarted?: () => void;
      adFinished?: () => void;
      adError?: (error: unknown) => void;
    }) => MaybePromise;
  };
}

interface PokiSdk {
  init?: () => MaybePromise;
  gameLoadingFinished?: () => MaybePromise;
  gameplayStart?: () => MaybePromise;
  gameplayStop?: () => MaybePromise;
  commercialBreak?: (onStart?: () => void) => Promise<void>;
  rewardedBreak?: (options?: { size?: 'small' | 'medium' | 'large'; onStart?: () => void }) => Promise<boolean>;
}

declare global {
  interface Window {
    CrazyGames?: { SDK?: CrazyGamesSdk };
    PokiSDK?: PokiSdk;
    __NVD_PORTAL_TRACE__?: (event: string, payload?: Record<string, unknown>) => void;
    __NVD_PORTAL_AD_START__?: (type: AdBreakType, portalId: PortalId) => void;
    __NVD_PORTAL_AD_END__?: (result: AdBreakResult, portalId: PortalId) => void;
  }
}

class NoopPortal implements PortalAdapter {
  readonly isPortal = false;
  readonly portalId = 'none' as const;

  async init(): Promise<void> {}
  loadingStart(): void {}
  loadingFinished(): void {}
  gameplayStart(): void {}
  gameplayStop(): void {}
  async requestAdBreak(type: AdBreakType): Promise<AdBreakResult> {
    return { status: 'skipped', type, adStarted: false, error: 'no_portal' };
  }
  happyTime(): void {}
}

abstract class ScriptPortal implements PortalAdapter {
  readonly isPortal = true;
  private initPromise: Promise<void> | null = null;
  private ready = false;
  private disabled = false;
  private loadingStarted = false;
  private loadingStartSent = false;
  private loadingFinishedCalled = false;
  private loadingFinishedSent = false;
  private gameplayDesired = false;
  private gameplaySent = false;
  readonly portalId: Exclude<PortalId, 'none'>;
  private readonly sdkUrl: string;

  protected constructor(portalId: Exclude<PortalId, 'none'>, sdkUrl: string) {
    this.portalId = portalId;
    this.sdkUrl = sdkUrl;
  }

  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      try {
        await loadScript(this.sdkUrl);
        await this.initSdk();
        this.ready = true;
        this.trace('init');
        this.flushLifecycle();
      } catch (error) {
        this.disabled = true;
        console.warn(`[portal:${this.portalId}] SDK unavailable; continuing without portal services.`, error);
      }
    })();
    return this.initPromise;
  }

  loadingStart(): void {
    this.loadingStarted = true;
    this.trace('loadingStart');
    this.flushLifecycle();
  }

  loadingFinished(): void {
    this.loadingFinishedCalled = true;
    this.trace('loadingFinished');
    this.flushLifecycle();
  }

  gameplayStart(): void {
    this.gameplayDesired = true;
    this.trace('gameplayStart');
    this.flushLifecycle();
  }

  gameplayStop(): void {
    this.gameplayDesired = false;
    this.trace('gameplayStop');
    this.flushLifecycle();
  }

  async requestAdBreak(type: AdBreakType): Promise<AdBreakResult> {
    await this.init();
    if (!this.ready || this.disabled) return { status: 'skipped', type, adStarted: false, error: 'sdk_unavailable' };
    this.trace('adBreakRequest', { type });
    const result = await this.requestAdBreakSdk(type);
    this.trace('adBreakResult', { type, status: result.status, adStarted: result.adStarted, error: result.error ?? '' });
    window.__NVD_PORTAL_AD_END__?.(result, this.portalId);
    return result;
  }

  happyTime(): void {
    this.trace('happyTime');
    if (!this.ready || this.disabled) return;
    void this.safeCall('happyTime', () => this.callHappyTime());
  }

  protected trace(event: string, payload: Record<string, unknown> = {}): void {
    window.__NVD_PORTAL_TRACE__?.(event, { portal: this.portalId, ...payload });
  }

  protected adStarted(type: AdBreakType): void {
    this.trace('adStarted', { type });
    window.__NVD_PORTAL_AD_START__?.(type, this.portalId);
  }

  protected abstract initSdk(): MaybePromise;
  protected abstract callLoadingStart(): MaybePromise;
  protected abstract callLoadingFinished(): MaybePromise;
  protected abstract callGameplayStart(): MaybePromise;
  protected abstract callGameplayStop(): MaybePromise;
  protected abstract callHappyTime(): MaybePromise;
  protected abstract requestAdBreakSdk(type: AdBreakType): Promise<AdBreakResult>;

  private flushLifecycle(): void {
    if (!this.ready || this.disabled) return;
    if (this.loadingStarted && !this.loadingStartSent) {
      this.loadingStartSent = true;
      void this.safeCall('loadingStart', () => this.callLoadingStart());
    }
    if (this.loadingFinishedCalled && !this.loadingFinishedSent) {
      this.loadingFinishedSent = true;
      void this.safeCall('loadingFinished', () => this.callLoadingFinished());
    }
    if (this.gameplayDesired && !this.gameplaySent) {
      this.gameplaySent = true;
      void this.safeCall('gameplayStart', () => this.callGameplayStart());
    } else if (!this.gameplayDesired && this.gameplaySent) {
      this.gameplaySent = false;
      void this.safeCall('gameplayStop', () => this.callGameplayStop());
    }
  }

  private async safeCall(label: string, fn: () => MaybePromise): Promise<void> {
    try {
      const result = fn();
      if (isPromiseLike(result)) await result;
    } catch (error) {
      console.warn(`[portal:${this.portalId}] ${label} failed`, error);
    }
  }
}

class CrazyGamesPortal extends ScriptPortal {
  constructor() {
    super('crazygames', PORTAL_SDK_URLS.crazygames);
  }

  protected initSdk(): MaybePromise {
    return window.CrazyGames?.SDK?.init?.();
  }

  protected callLoadingStart(): MaybePromise {
    return window.CrazyGames?.SDK?.game?.loadingStart?.();
  }

  protected callLoadingFinished(): MaybePromise {
    return window.CrazyGames?.SDK?.game?.loadingStop?.();
  }

  protected callGameplayStart(): MaybePromise {
    return window.CrazyGames?.SDK?.game?.gameplayStart?.();
  }

  protected callGameplayStop(): MaybePromise {
    return window.CrazyGames?.SDK?.game?.gameplayStop?.();
  }

  protected callHappyTime(): MaybePromise {
    return window.CrazyGames?.SDK?.game?.happytime?.();
  }

  protected requestAdBreakSdk(type: AdBreakType): Promise<AdBreakResult> {
    return new Promise((resolve) => {
      let adStarted = false;
      try {
        window.CrazyGames?.SDK?.ad?.requestAd?.(type, {
          adStarted: () => {
            adStarted = true;
            this.adStarted(type);
          },
          adFinished: () => resolve({ status: 'completed', type, adStarted }),
          adError: (error) => resolve({ status: 'skipped', type, adStarted, error: errorMessage(error) }),
        });
      } catch (error) {
        resolve({ status: 'failed', type, adStarted, error: errorMessage(error) });
      }
    });
  }
}

class PokiPortal extends ScriptPortal {
  constructor() {
    super('poki', PORTAL_SDK_URLS.poki);
  }

  protected initSdk(): MaybePromise {
    return window.PokiSDK?.init?.();
  }

  protected callLoadingStart(): MaybePromise {}

  protected callLoadingFinished(): MaybePromise {
    return window.PokiSDK?.gameLoadingFinished?.();
  }

  protected callGameplayStart(): MaybePromise {
    return window.PokiSDK?.gameplayStart?.();
  }

  protected callGameplayStop(): MaybePromise {
    return window.PokiSDK?.gameplayStop?.();
  }

  protected callHappyTime(): MaybePromise {}

  async requestAdBreakSdk(type: AdBreakType): Promise<AdBreakResult> {
    let adStarted = false;
    const onStart = () => {
      adStarted = true;
      this.adStarted(type);
    };
    try {
      if (type === 'rewarded') {
        const success = await window.PokiSDK?.rewardedBreak?.({ size: 'medium', onStart });
        return { status: success ? 'completed' : 'skipped', type, adStarted };
      }
      await window.PokiSDK?.commercialBreak?.(onStart);
      return { status: adStarted ? 'completed' : 'skipped', type, adStarted };
    } catch (error) {
      return { status: 'failed', type, adStarted, error: errorMessage(error) };
    }
  }
}

function loadScript(src: string): Promise<void> {
  if (typeof document === 'undefined') return Promise.reject(new Error('document unavailable'));
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
  if (existing?.dataset.loaded === 'true') return Promise.resolve();
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`failed to load ${src}`)), { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return !!value && typeof (value as Promise<unknown>).then === 'function';
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const maybe = error as { message?: unknown; code?: unknown };
    if (typeof maybe.message === 'string') return maybe.message;
    if (typeof maybe.code === 'string') return maybe.code;
  }
  return 'unknown_error';
}

export const portal: PortalAdapter = import.meta.env.VITE_PORTAL === 'crazygames'
  ? new CrazyGamesPortal()
  : import.meta.env.VITE_PORTAL === 'poki'
    ? new PokiPortal()
    : new NoopPortal();
