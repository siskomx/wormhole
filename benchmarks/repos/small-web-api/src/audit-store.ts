export type AuditEvent = {
  idempotencyKey: string;
  actorId: string;
  type: string;
  createdAt: string;
};

const events = new Map<string, AuditEvent>();

export function saveAuditEvent(event: AuditEvent): AuditEvent {
  const existing = events.get(event.idempotencyKey);
  if (existing) {
    return existing;
  }
  events.set(event.idempotencyKey, event);
  return event;
}
