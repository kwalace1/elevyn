import { CommandRegistry } from './registry.js';
import { closeAppCommand, openAppCommand } from './handlers/apps.js';
import {
  lockComputerCommand,
  runAppleScriptCommand,
  runTerminalCommand,
  sleepComputerCommand,
} from './handlers/system.js';

export function createCommandRegistry(): CommandRegistry {
  const registry = new CommandRegistry();
  registry.register(openAppCommand);
  registry.register(closeAppCommand);
  registry.register(lockComputerCommand);
  registry.register(sleepComputerCommand);
  registry.register(runAppleScriptCommand);
  registry.register(runTerminalCommand);
  return registry;
}
