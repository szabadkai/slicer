/**
 * Feature mount for primitive boolean cutting.
 * Standard mount(root, ctx) entry point.
 */
import type { AppContext } from '@core/types';
import { mountPrimitiveBooleanPanel } from './panel';
import { registerBooleanHandlers } from './handlers';

export function mountPrimitiveBoolean(ctx: AppContext): () => void {
  const disposePanel = mountPrimitiveBooleanPanel(ctx);
  const disposeHandlers = registerBooleanHandlers(ctx);

  return () => {
    disposePanel();
    disposeHandlers();
  };
}
