// dispatch7 notification helper — thin Supabase wrapper
// Inserts into dispatch7.notifications (schema set in supabase.ts client config).
// Call notify() to fire a notification; markSessionRead() to bulk-mark read
// when the next user message arrives in a session (called from ws.ts onMessage).

import { supabase } from './supabase.js';

export type NotifyOptions = {
  source:       'COWORK' | 'DISPATCH' | 'D7';
  project?:     string;
  session_id?:  string;
  type:         'popup' | 'txt' | 'ntfy' | 'alert';
  category?:    'd7_status' | 'legal' | 'money' | 'devops' | 'merge' | 'deploy' | 'deadline';
  title:        string;
  body:         string;
  priority?:    'P0' | 'P1' | 'P2' | 'info';
  related_pr?:  number;
  related_case?: string;
  metadata?:    Record<string, unknown>;
};

/**
 * notify — insert a single notification row into dispatch7.notifications.
 * Fire-and-forget safe: errors are logged but never thrown.
 */
export async function notify(opts: NotifyOptions): Promise<void> {
  const { error } = await supabase.from('notifications').insert({
    source:       opts.source,
    project:      opts.project      ?? 'D7',
    session_id:   opts.session_id,
    type:         opts.type,
    category:     opts.category,
    title:        opts.title,
    body:         opts.body,
    priority:     opts.priority     ?? 'info',
    related_pr:   opts.related_pr,
    related_case: opts.related_case,
    metadata:     opts.metadata     ?? {},
  });
  if (error) {
    console.error('[notify] Failed to insert notification:', error.message);
  }
}

/**
 * markSessionRead — bulk-mark all unread notifications for a session as read.
 * Called at the top of ws.ts onMessage so arriving user messages auto-clear
 * the notification badge for that session.
 * Errors are swallowed — this must never block the WS handler.
 */
export async function markSessionRead(session_id: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('session_id', session_id)
    .is('read_at', null);

  if (error) {
    console.warn('[markSessionRead] Failed to mark notifications read:', error.message);
  }
}
