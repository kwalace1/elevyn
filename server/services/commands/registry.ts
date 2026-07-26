import type {
  CommandDefinition,
  CommandExecutionResult,
} from '../../../src/types/index.js';

export interface CommandContext {
  args: Record<string, unknown>;
}

export interface CommandHandler extends CommandDefinition {
  execute(ctx: CommandContext): Promise<CommandExecutionResult>;
}

/**
 * Registry-based command system.
 * Never hardcode command branching in the brain — register handlers instead.
 * This scales to unlimited commands without rewriting the OS core.
 */
export class CommandRegistry {
  private handlers = new Map<string, CommandHandler>();

  register(handler: CommandHandler): void {
    if (this.handlers.has(handler.id)) {
      throw new Error(`Command already registered: ${handler.id}`);
    }
    this.handlers.set(handler.id, handler);
  }

  get(id: string): CommandHandler | undefined {
    return this.handlers.get(id);
  }

  list(): CommandDefinition[] {
    return [...this.handlers.values()].map(({ execute: _e, ...def }) => def);
  }

  async execute(
    commandId: string,
    args: Record<string, unknown> = {},
  ): Promise<CommandExecutionResult> {
    const handler = this.handlers.get(commandId);
    if (!handler) {
      return { success: false, message: `Unknown command: ${commandId}` };
    }
    try {
      return await handler.execute({ args });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Command failed';
      return { success: false, message };
    }
  }
}
