import type { SendEmailInput } from "./email";
import { sendEmail } from "./email";

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 250;
const queue: SendEmailInput[] = [];
let isDraining = false;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function drainQueue(): Promise<void> {
  if (isDraining) return;
  isDraining = true;
  try {
    while (queue.length > 0) {
      const batch = queue.splice(0, BATCH_SIZE);
      await Promise.all(batch.map((email) => sendEmail(email)));
      if (queue.length > 0) await delay(BATCH_DELAY_MS);
    }
  } finally {
    isDraining = false;
    if (queue.length > 0) void drainQueue();
  }
}

export function enqueueEmails(emails: SendEmailInput[]): void {
  if (emails.length === 0) return;
  queue.push(...emails);
  void drainQueue();
}
