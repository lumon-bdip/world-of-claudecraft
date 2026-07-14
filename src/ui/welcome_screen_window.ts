// Thin painter for the post-login Welcome Screen (news, patch notes, Join our
// Discord strip, and the desktop-web Season 1 Armory promo). Cold window: it is
// shown once per login, so this follows the store_promo_card.ts / dialog_root.ts
// cold-path convention (raw DOM writes, not the per-frame PainterHost elider).
// Pure gating/badge/intent logic lives in ./welcome_screen_view; this module
// only resolves DOM refs, paints from that view, and wires callbacks.
import { markDialogRoot } from './dialog_root';
import { discordInviteUrl } from './discord_status';
import { formatDateTime, t } from './i18n';
import { loadNewsInto, type NewsReleaseEntry } from './news_feed';
import { mountStorePromoCard, type StorePromoCardController } from './store_promo_card';
import {
  buildWelcomeScreenView,
  consumeArmoryOpenIntent,
  nextLastSeenReleaseId,
  setArmoryOpenIntent,
  type WelcomeChestInput,
  type WelcomeConnectionInput,
  type WelcomeDiscordInput,
  type WelcomeNewsInput,
  type WelcomePlatformInput,
  type WelcomeReleaseSummary,
} from './welcome_screen_view';

const LAST_SEEN_RELEASE_KEY = 'woc.welcome.lastSeenReleaseId';

export interface WelcomeScreenHeader {
  characterName: string;
  level: number;
  className: string;
  realmName: string;
  lastPlayed: string | null;
}

export interface WelcomeScreenDeps {
  platform: WelcomePlatformInput;
  fetchReleases(): Promise<NewsReleaseEntry[]>;
  fetchArmoryPromoEnabled(): Promise<boolean>;
  fetchDiscord(): Promise<WelcomeDiscordInput>;
  fetchChest(): Promise<WelcomeChestInput>;
  header(): WelcomeScreenHeader | null;
  onContinue(): void;
  /** Read/write the one-shot Armory-open intent; defaults to window.sessionStorage. */
  storage?: Storage;
}

export interface WelcomeScreenController {
  /** Shows the screen and kicks off the async news/discord/chest/flag reads. */
  show(): Promise<void>;
  hide(): void;
  /** Call when the online readiness condition changes (world.connected + player entity). */
  setConnectionReady(ready: boolean): void;
  destroy(): void;
}

function storageOrSession(storage?: Storage): Storage {
  return storage ?? window.sessionStorage;
}

/** Reads the persisted "last seen release" marker (localStorage; survives across sessions). */
function readLastSeenReleaseId(): number | null {
  const raw = window.localStorage.getItem(LAST_SEEN_RELEASE_KEY);
  const n = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}

function writeLastSeenReleaseId(id: number): void {
  window.localStorage.setItem(LAST_SEEN_RELEASE_KEY, String(id));
}

export function mountWelcomeScreen(
  root: HTMLElement,
  deps: WelcomeScreenDeps,
): WelcomeScreenController {
  const headerEl = root.querySelector<HTMLElement>('#ws-header');
  const newsEl = root.querySelector<HTMLElement>('#ws-news');
  const discordStripEl = root.querySelector<HTMLElement>('#ws-discord');
  const discordJoinBtn = root.querySelector<HTMLButtonElement>('#ws-discord-join');
  const armoryHost = root.querySelector<HTMLElement>('#ws-armory-card');
  const chestTileEl = root.querySelector<HTMLElement>('#ws-chest-tile');
  const statusEl = root.querySelector<HTMLElement>('#ws-status');
  const continueBtn = root.querySelector<HTMLButtonElement>('#ws-continue');
  const versionEl = root.querySelector<HTMLElement>('#ws-version');

  markDialogRoot(root, { label: t('welcome.continue'), modal: true });

  let armoryCard: StorePromoCardController | null = null;
  let connectionReady = deps.platform.offline;

  function paintHeader(): void {
    const h = deps.header();
    if (!headerEl) return;
    if (!h) {
      headerEl.textContent = '';
      return;
    }
    const when = h.lastPlayed
      ? formatDateTime(new Date(h.lastPlayed), { dateStyle: 'medium' })
      : '';
    headerEl.textContent = '';
    const title = document.createElement('div');
    title.className = 'ws-welcome-back';
    title.textContent = t('welcome.back', { name: h.characterName });
    const meta = document.createElement('div');
    meta.className = 'ws-header-meta';
    meta.textContent = [
      t('welcome.level', { level: h.level }),
      h.className,
      h.realmName,
      when ? t('welcome.lastPlayed', { when }) : '',
    ]
      .filter(Boolean)
      .join(' · ');
    headerEl.append(title, meta);
  }

  function paintStatus(): void {
    if (!statusEl) return;
    statusEl.textContent = connectionReady ? '' : t('loading.connectingRealm');
  }

  function refreshContinue(): void {
    if (!continueBtn) return;
    continueBtn.disabled = !connectionReady;
  }

  function setConnectionReady(ready: boolean): void {
    connectionReady = ready || deps.platform.offline;
    paintStatus();
    refreshContinue();
  }

  function paintDiscordStrip(show: boolean): void {
    if (!discordStripEl) return;
    discordStripEl.hidden = !show;
  }

  function paintChestTile(show: boolean): void {
    if (!chestTileEl) return;
    chestTileEl.hidden = !show;
  }

  function paintArmoryCard(show: boolean): void {
    if (!armoryHost) return;
    if (!show) {
      armoryCard?.dismiss();
      armoryCard = null;
      armoryHost.hidden = true;
      return;
    }
    armoryHost.hidden = false;
    if (armoryCard) return;
    armoryCard = mountStorePromoCard(armoryHost, {
      labels: {
        open: t('hudChrome.wocStore.title'),
        close: t('hudChrome.wocStore.close'),
        season: t('hudChrome.wocStore.seasonOne'),
        title: t('hudChrome.wocStore.armoryTitle'),
        cta: t('welcome.armory.cta'),
      },
      returnFocusTo: () => continueBtn,
      onOpenStore: () => setArmoryOpenIntent(storageOrSession(deps.storage)),
    });
  }

  function paintVersion(text: string): void {
    if (versionEl) versionEl.textContent = text;
  }

  discordJoinBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    window.open(discordInviteUrl(), '_blank', 'noopener,noreferrer');
  });

  continueBtn?.addEventListener('click', () => {
    if (continueBtn.disabled) return;
    deps.onContinue();
  });

  function onKeydown(e: KeyboardEvent): void {
    if (root.hidden) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      deps.onContinue();
    } else if (e.key === 'Enter' && !(continueBtn?.disabled ?? true)) {
      e.preventDefault();
      deps.onContinue();
    }
  }
  root.addEventListener('keydown', onKeydown);

  async function show(): Promise<void> {
    root.hidden = false;
    paintHeader();
    setConnectionReady(deps.platform.offline);
    continueBtn?.focus();

    const newsState: WelcomeNewsInput = { state: 'loading', releases: [] };
    let releases: WelcomeReleaseSummary[] = [];
    void loadNewsInto(newsEl, async () => {
      try {
        const fetched = await deps.fetchReleases();
        releases = fetched.map((r) => ({
          id: r.id,
          tag: r.tag,
          name: r.name,
          publishedAt: r.publishedAt,
        }));
        newsState.state = 'loaded';
        const lastSeen = readLastSeenReleaseId();
        const next = nextLastSeenReleaseId(releases, lastSeen);
        if (next !== null) writeLastSeenReleaseId(next);
        return fetched;
      } catch (err) {
        newsState.state = 'failed';
        throw err;
      }
    });

    const [armoryEnabled, discord, chest] = await Promise.all([
      deps.platform.offline
        ? Promise.resolve(false)
        : deps.fetchArmoryPromoEnabled().catch(() => false),
      deps.platform.offline
        ? Promise.resolve<WelcomeDiscordInput>({
            enabled: null,
            linked: null,
            guildMember: null,
            fetchFailed: false,
          })
        : deps.fetchDiscord().catch(
            (): WelcomeDiscordInput => ({
              enabled: null,
              linked: null,
              guildMember: null,
              fetchFailed: true,
            }),
          ),
      deps.platform.offline
        ? Promise.resolve<WelcomeChestInput>({ ready: false, unknown: true })
        : deps.fetchChest().catch((): WelcomeChestInput => ({ ready: false, unknown: true })),
    ]);

    const view = buildWelcomeScreenView(
      deps.platform,
      newsState,
      discord,
      chest,
      { ready: connectionReady, offline: deps.platform.offline },
      armoryEnabled,
      readLastSeenReleaseId(),
    );
    paintDiscordStrip(view.showDiscordStrip);
    paintChestTile(view.showChestTile);
    paintArmoryCard(view.showArmoryCard);
  }

  function hide(): void {
    root.hidden = true;
  }

  function destroy(): void {
    root.removeEventListener('keydown', onKeydown);
    armoryCard?.dismiss();
    armoryCard = null;
  }

  paintVersion('');

  return { show, hide, setConnectionReady, destroy };
}

/** Reads and clears the one-shot Armory-open intent (call once the HUD/store exist). */
export function takeArmoryOpenIntent(storage?: Storage): boolean {
  return consumeArmoryOpenIntent(storageOrSession(storage));
}
