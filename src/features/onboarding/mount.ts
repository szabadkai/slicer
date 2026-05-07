/**
 * Onboarding feature entry point.
 * Called from app-shell/mount.ts after all panels are wired.
 */
import type { AppContext } from '@core/types';
import { injectOnboardingStyles } from './styles';
import { mountWelcomeModal } from './welcome-modal';
import { mountTour } from './tour';
import { mountChecklist } from './checklist';

export function mountOnboarding(ctx: AppContext): void {
  injectOnboardingStyles();
  mountTour(ctx);
  mountChecklist(ctx);

  // Show welcome modal — it internally checks hasSeenWelcome so it's a no-op
  // on repeat visits. Pass a callback so the tour engine is ready before start.
  mountWelcomeModal(ctx, () => {
    // tour already started via startTour() inside welcome-modal; nothing extra needed
  });
}
