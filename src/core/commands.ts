import type { CommandMap, CommandName, CommandHandler, CommandBus } from './types';

export function createCommandBus(): CommandBus {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();

  function dispatch<T extends CommandName>(command: T, payload: CommandMap[T]): void {
    const set = handlers.get(command);
    if (set) {
      for (const handler of set) {
        handler(payload);
      }
    }
  }

  function on<T extends CommandName>(command: T, handler: CommandHandler<T>): () => void {
    let set = handlers.get(command);
    if (!set) {
      set = new Set();
      handlers.set(command, set);
    }
    set.add(handler as (payload: unknown) => void);
    return () => {
      set.delete(handler as (payload: unknown) => void);
    };
  }

  return { dispatch, on };
}

export const commands = createCommandBus();
