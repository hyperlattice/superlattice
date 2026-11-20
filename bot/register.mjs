import { pathToFileURL } from 'node:url';
import { REST, Routes, InteractionContextType, ApplicationIntegrationType } from 'discord.js';
import { commands } from './commands/index.mjs';
import { readDiscordConfig } from '../lib/config.mjs';

export async function registerCommands(config, rest = new REST({ version: '10', timeout: 15_000 }).setToken(config.token), { clear = false } = {}) {
  const route = config.guildId
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);
  const body = clear ? [] : [...commands.values()].map(command => {
    const definition = command.data.toJSON();
    if (!config.guildId) {
      definition.contexts = [InteractionContextType.Guild];
      definition.integration_types = [ApplicationIntegrationType.GuildInstall];
    }
    return definition;
  });
  // Bulk overwrite updates definitions by name and removes obsolete commands in this scope.
  await rest.put(route, { body });
  return body.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = readDiscordConfig(process.env, { registration: true });
    const count = await registerCommands(config, undefined, { clear: process.argv.includes('--clear') });
    console.log(`Registered ${count} commands (${config.guildId ? 'guild' : 'global'} scope).`);
  } catch {
    console.error('Command registration failed. Check Discord token, application ID, guild ID and access.');
    process.exitCode = 1;
  }
}
