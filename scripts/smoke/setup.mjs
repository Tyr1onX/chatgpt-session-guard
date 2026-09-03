import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { buildDebugExtension, launchSmokeBrowser, verifyDebugBuild } from './browser.mjs';
import { conversationIdFromUrl, getOrCreateChatPage } from './chatgpt.mjs';
import { saveSmokeConfig } from './config.mjs';
import { initializeDedicatedProfile } from './profile-guard.mjs';

const root = process.cwd();
const rl = createInterface({ input, output });
let context;

try {
  const paths = await initializeDedicatedProfile(root);
  const identity = buildDebugExtension(root);
  await verifyDebugBuild({ root, distDir: paths.distDir, expectedBuildId: identity.buildId });

  const launched = await launchSmokeBrowser({ root, headed: true });
  context = launched.context;
  const page = await getOrCreateChatPage(context);
  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 });

  output.write(`\nDedicated smoke profile: ${paths.profileDir}\n`);
  output.write('This browser is isolated from your daily Chrome profile.\n');
  output.write('Log in to ChatGPT in this dedicated browser, then open one existing long conversation.\n');
  await rl.question('When that long conversation is open, press Enter here: ');

  const longConversationId = conversationIdFromUrl(page.url());
  if (!longConversationId) throw new Error('LONG_CONVERSATION_NOT_SELECTED: open a /c/<id> conversation before continuing');

  const switchConversationIds = [];
  for (let index = 0; index < 2; index += 1) {
    const answer = await rl.question('Optional: open another existing conversation for SPA switching, then press Enter; type s to finish: ');
    if (answer.trim().toLowerCase() === 's') break;
    const current = conversationIdFromUrl(page.url());
    if (current && current !== longConversationId && !switchConversationIds.includes(current)) {
      switchConversationIds.push(current);
      output.write('Bound one SPA switch sample locally.\n');
    } else {
      output.write('No new conversation detected; continuing without adding a sample.\n');
    }
  }

  await saveSmokeConfig({ schemaVersion: 1, longConversationId, switchConversationIds }, root);
  output.write(`Smoke setup complete. Local config: ${paths.configPath}\n`);
  output.write('Authentication remains only inside the dedicated persistent browser profile.\n');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  rl.close();
  if (context) await context.close();
}
