import * as ping from './ping.mjs';
import * as status from './status.mjs';
import * as github from './github.mjs';
import * as help from './help.mjs';

// Add new command modules here; registration and /help use the same definitions.
export const commands = new Map([ping, status, github, help].map(command => [command.data.name, command]));
