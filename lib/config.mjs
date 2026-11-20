function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function snowflake(env, name, optional = false) {
  if (optional && !env[name]?.trim()) return undefined;
  const value = required(env, name);
  if (!/^[1-9]\d{16,19}$/.test(value) || BigInt(value) > 18446744073709551615n) {
    throw new Error(`${name} must be a Discord snowflake ID.`);
  }
  return value;
}

export function readDiscordConfig(env = process.env, { registration = false } = {}) {
  const config = {
    token: required(env, 'DISCORD_BOT_TOKEN'),
    clientId: snowflake(env, 'DISCORD_CLIENT_ID'),
    guildId: snowflake(env, 'DISCORD_GUILD_ID', true),
  };
  if (!registration) config.channelId = snowflake(env, 'DISCORD_CHANNEL_ID');
  return config;
}

export function readConfig(env = process.env) {
  const discord = readDiscordConfig(env);
  const secret = required(env, 'GITHUB_WEBHOOK_SECRET');
  if (secret.length < 32) throw new Error('GITHUB_WEBHOOK_SECRET must contain at least 32 characters.');
  const organization = env.GITHUB_ORGANIZATION?.trim() || 'hyperlattice';
  if (!/^[a-z\d-]+$/i.test(organization) || organization.length > 39) {
    throw new Error('GITHUB_ORGANIZATION must be a GitHub organization login.');
  }
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  return { ...discord, secret, organization, port, directory: env.DATA_DIR?.trim() || './data' };
}
